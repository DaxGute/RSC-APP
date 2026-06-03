/**
 * Full-screen modal opened from the map tab Model button (App.tsx).
 * Analog PM2.5 projection + forecast wind over live kriging; freezes base snapshot on open.
 */
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  InteractionManager,
  LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppLanguage } from '../../../contexts/LanguageProvider';
import { KrigingHeatmapLayer } from '../KrigingHeatmapLayer';
import { MapScaleActions } from '../SsfMap';
import { WindArrowLayer } from './WindArrowLayer';
import type { CurrentKrigingRow } from '../../../lib/shell/supabase';
import { SSF_BBOX } from '../../../lib/map/mapRegionFromData';
import {
  fetchForecastWindGrid,
  windGridSliceAtMinutes,
  type ForecastWindGridByTime,
} from '../../../lib/map/projection/forecastWindGrid';
import {
  analogLibraryCacheKey,
  buildHistoricalAnalogLibrary,
  getCachedAnalogLibrary,
} from '../../../lib/map/projection/modeling/buildHistoricalAnalogLibrary';
import {
  formatAnalogTimestamp,
  horizonLabelForStepIndex,
  MIN_USABLE_ANALOG_LIBRARY,
  type AnalogProjectionQuality,
} from '../../../lib/map/projection/modeling/analogProjectionMetrics';
import {
  generateAnalogProjectionFrames,
  type ProjectionFrame,
} from '../../../lib/map/projection/modeling/generateAnalogProjectionFrames';
import {
  createPhaseLoadProgress,
  yieldToEventLoop,
} from '../../../lib/map/projection/modeling/phaseLoadProgress';
import type { MapRegion } from '../../../lib/map/mapRegionFromData';
import {
  formatProjectionHeader,
  minutesAheadForStep,
  modelProjectionContent,
  PROJECTION_FRAME_COUNT,
  PROJECTION_FUTURE_STEPS,
  PROJECTION_MAJOR_LABELS,
  PROJECTION_MAJOR_STEP_INDICES,
  type ModelProjectionContent,
} from '../../../lib/map/projection/modelProjectionContent';
import { resolveHeatmapGridRows } from '../../../lib/map/recomputeKriging';
import type { SensorPoint } from '../../../lib/map/sensorTypes';

/** Matches `App.tsx` tab bar — overlay sits above the tab bar. */
const ROOT_TAB_BAR_RESERVED_HEIGHT = 78;
const ROOT_TAB_BAR_TOP_RADIUS = 16;
/** Below language switch (190) and tab bar (200). */
const MODEL_PROJECTION_OVERLAY_Z_INDEX = 150;

/** Wired from App.tsx when the map tab Model button opens the projection overlay. */
export type ModelProjectionMapProps = {
  visible: boolean;
  onClose: () => void;
  mapKriging: CurrentKrigingRow[];
  mapSensors: SensorPoint[];
  mapRegion: MapRegion;
  timelineTimesAsc?: string[];
  viewingLive?: boolean;
};

/** Snapshot captured when the overlay opens; live map props are ignored until close. */
type FrozenProjectionBase = {
  kriging: CurrentKrigingRow[];
  sensors: SensorPoint[];
  timelineTimesAsc: string[];
  viewingLive: boolean;
};

/** Initial camera zoom; MapScaleActions step and min/max bounds derive from these. */
const DEFAULT_ZOOM_LEVEL = 12;
const MIN_ZOOM_FACTOR = 0.5;
const MAX_ZOOM_FACTOR = 3;
const MIN_ZOOM_LEVEL = DEFAULT_ZOOM_LEVEL * MIN_ZOOM_FACTOR;
const MAX_ZOOM_LEVEL = DEFAULT_ZOOM_LEVEL * MAX_ZOOM_FACTOR;
const ZOOM_STEP = 1;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/** Full-screen analog PM2.5 projection with forecast wind and hourly scrub controls. */
export function ModelProjectionMap({
  visible,
  onClose,
  mapKriging,
  mapSensors,
  mapRegion,
  timelineTimesAsc: _timelineTimesAsc = [],
  viewingLive: _viewingLive = true,
}: ModelProjectionMapProps) {
  const { language } = useAppLanguage();
  const content = modelProjectionContent[language];
  const insets = useSafeAreaInsets();
  const [selectedStep, setSelectedStep] = useState(0);
  const [windData, setWindData] = useState<ForecastWindGridByTime | null>(null);
  const [windAvailable, setWindAvailable] = useState(false);
  const [windErrorMessage, setWindErrorMessage] = useState<string | null>(null);
  const [precomputedFrames, setPrecomputedFrames] = useState<ProjectionFrame[] | null>(null);
  const [analogQuality, setAnalogQuality] = useState<AnalogProjectionQuality | null>(null);
  const [helpModalOpen, setHelpModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadMessage, setLoadMessage] = useState('Preparing projection…');
  const [mapLayoutReady, setMapLayoutReady] = useState(false);
  const [mapMountReady, setMapMountReady] = useState(false);
  const frozenBaseRef = useRef<FrozenProjectionBase | null>(null);
  const cameraRef = useRef<Mapbox.Camera>(null);
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM_LEVEL);
  const prevVisibleRef = useRef(false);
  const loadGenerationRef = useRef(0);

  /** Capture kriging/sensors when overlay opens; ignore live map updates until close. */
  if (visible !== prevVisibleRef.current) {
    if (visible) {
      frozenBaseRef.current = {
        kriging: mapKriging,
        sensors: mapSensors,
        timelineTimesAsc: _timelineTimesAsc,
        viewingLive: _viewingLive,
      };
    } else {
      frozenBaseRef.current = null;
    }
    prevVisibleRef.current = visible;
  }

  const baseKriging = frozenBaseRef.current?.kriging ?? mapKriging;
  const baseSensors = frozenBaseRef.current?.sensors ?? mapSensors;

  /** Match `KrigingHeatmapLayer` on the main map (recompute + slice to 40×40). */
  const nowGrid = useMemo(
    () => resolveHeatmapGridRows({ kriging: baseKriging, sensors: baseSensors }),
    [baseKriging, baseSensors],
  );

  const heatmapAvailable = nowGrid.length > 0;
  const maxStep = PROJECTION_FRAME_COUNT - 1;

  /** On open: fetch wind grid, build analog library, precompute projection frames. */
  useEffect(() => {
    if (!visible) {
      setMapLayoutReady(false);
      return;
    }

    const generation = ++loadGenerationRef.current;
    const gridForLoad = nowGrid;

    setSelectedStep(0);
    setWindData(null);
    setPrecomputedFrames(null);
    setAnalogQuality(null);
    setHelpModalOpen(false);
    setWindAvailable(false);
    setWindErrorMessage(null);
    setLoadProgress(0);
    setLoadMessage('Preparing current map…');

    if (!heatmapAvailable) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const progress = createPhaseLoadProgress((display, msg) => {
      if (cancelled) return;
      setLoadProgress(display);
      setLoadMessage(msg);
    });

    const nowMs = Date.now();
    const cacheKey = analogLibraryCacheKey(nowMs);
    const hasCachedLibrary = getCachedAnalogLibrary(cacheKey) != null;

    progress.setProgressImmediate(0.05, 'Preparing current map…');
    progress.setProgressImmediate(0.1, 'Preparing current map…');

    /** Maps analog-library build progress into the single overlay progress bar. */
    const mapLibraryProgress = (p: number, message: string) => {
      if (hasCachedLibrary) {
        progress.setProgress(0.25 + p * 0.1, message);
        return;
      }
      if (p <= 0.5) {
        const t = p / 0.5;
        progress.setProgress(0.25 + t * 0.3, message);
      } else {
        const t = (p - 0.5) / 0.5;
        progress.setProgress(0.55 + t * 0.2, message);
      }
    };

    void (async () => {
      progress.setProgress(0.12, 'Loading forecast wind…');

      const windPromise = fetchForecastWindGrid();
      const libraryPromise = buildHistoricalAnalogLibrary(nowMs, mapLibraryProgress);

      const wind = await windPromise;
      if (cancelled || loadGenerationRef.current !== generation) {
        progress.stop();
        return;
      }
      progress.setProgress(0.25, 'Loading forecast wind…');

      const libraryResult = await libraryPromise;
      if (cancelled || loadGenerationRef.current !== generation) {
        progress.stop();
        return;
      }
      progress.setProgress(
        0.75,
        libraryResult.fromCache ? 'Using cached analog library…' : 'Building analog library…',
      );

      setWindData(wind);
      setWindAvailable(wind.available);
      setWindErrorMessage(wind.available ? null : (wind.errorMessage ?? 'Wind data unavailable'));

      progress.setProgress(0.78, 'Finding similar past patterns…');
      await yieldToEventLoop();

      const { frames, quality } = generateAnalogProjectionFrames({
        nowGrid: gridForLoad,
        wind,
        library: libraryResult.library,
        nowMs,
      });

      if (cancelled || loadGenerationRef.current !== generation) {
        progress.stop();
        return;
      }

      progress.setProgress(0.9, 'Generating forecast frames…');
      setPrecomputedFrames(frames.length > 0 ? frames : null);
      setAnalogQuality(quality);

      progress.setProgress(0.98, 'Rendering projection…');
      await yieldToEventLoop();

      progress.finish('Rendering projection…', () => {
        if (cancelled || loadGenerationRef.current !== generation) return;
        setLoadProgress(1);
        setLoading(false);
      });
    })();

    return () => {
      cancelled = true;
      progress.stop();
    };
  }, [visible, heatmapAvailable, nowGrid]);

  /** Defer Mapbox mount until after transitions so layout and first paint stay smooth. */
  useEffect(() => {
    if (!visible) {
      setMapMountReady(false);
      setMapLayoutReady(false);
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => {
      setMapMountReady(true);
    });
    return () => task.cancel();
  }, [visible]);

  const handleMapWrapLayout = useCallback((e: LayoutChangeEvent) => {
    if (e.nativeEvent.layout.width > 0 && e.nativeEvent.layout.height > 0) {
      setMapLayoutReady(true);
    }
  }, []);

  /** Selected hourly analog frame, or null while loading / no heatmap. */
  const activeFrame = useMemo(() => {
    if (!heatmapAvailable || !precomputedFrames) return null;
    return precomputedFrames[clamp(selectedStep, 0, precomputedFrames.length - 1)] ?? null;
  }, [precomputedFrames, selectedStep, heatmapAvailable]);

  const displayGrid = activeFrame?.grid ?? nowGrid;
  const uncertainty = activeFrame?.uncertaintyOverlay ?? 0;
  /** Fade heatmap when analog uncertainty is high (floor keeps map readable). */
  const displayOpacity = Math.max(0.5, (activeFrame?.opacityScale ?? 1) * (1 - uncertainty * 0.55));
  const minutesAhead = activeFrame?.minutesAhead ?? minutesAheadForStep(selectedStep);
  const loadProgressDisplay = Math.max(0.04, Math.min(1, loadProgress));
  const projectionHeader = formatProjectionHeader(minutesAhead);
  const maxSelectableStep =
    precomputedFrames && precomputedFrames.length > 1 ? precomputedFrames.length - 1 : 0;
  const stepNavEnabled = heatmapAvailable && !loading && maxSelectableStep > 0;

  /** Android hardware back closes the overlay instead of leaving the app. */
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  /** Wind arrows for the selected forecast hour (slice of pre-fetched grid). */
  const windArrowPoints = useMemo(() => {
    if (!windData?.available) return [];
    return windGridSliceAtMinutes(windData.byTime, minutesAhead) ?? [];
  }, [windData, minutesAhead]);

  const handleMajorTickPress = useCallback(
    (stepIndex: number) => {
      setSelectedStep(clamp(stepIndex, 0, maxSelectableStep));
    },
    [maxSelectableStep],
  );

  const stepBack = useCallback(() => {
    setSelectedStep((s) => clamp(s - 1, 0, maxSelectableStep));
  }, [maxSelectableStep]);

  const stepForward = useCallback(() => {
    setSelectedStep((s) => clamp(s + 1, 0, maxSelectableStep));
  }, [maxSelectableStep]);

  const canZoomIn = zoomLevel < MAX_ZOOM_LEVEL - 0.05;
  const canZoomOut = zoomLevel > MIN_ZOOM_LEVEL + 0.05;

  const applyZoomDelta = useCallback(
    (delta: number) => {
      const next = Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, zoomLevel + delta));
      setZoomLevel(next);
      cameraRef.current?.setCamera({
        zoomLevel: next,
        animationDuration: 200,
        animationMode: 'easeTo',
      });
    },
    [zoomLevel],
  );

  const zoomIn = useCallback(() => applyZoomDelta(ZOOM_STEP), [applyZoomDelta]);
  const zoomOut = useCallback(() => applyZoomDelta(-ZOOM_STEP), [applyZoomDelta]);

  const handleCameraChanged = useCallback((event: { properties?: { zoom?: number } }) => {
    const z = event.properties?.zoom;
    if (typeof z === 'number' && Number.isFinite(z)) {
      setZoomLevel(z);
    }
  }, []);

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.root} pointerEvents="auto">
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) + 4 }]}>
          <View style={styles.headerTextCol}>
            <View style={styles.titleRow}>
              <View style={styles.experimentalBadge}>
                <Text style={styles.experimentalBadgeText}>{content.experimentalBadge}</Text>
              </View>
              <Text style={styles.title} numberOfLines={2}>
                {content.title}
              </Text>
              <Pressable
                onPress={() => setHelpModalOpen(true)}
                hitSlop={10}
                style={({ pressed }) => [styles.helpBtn, pressed && styles.helpBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel={content.helpBtnA11y}
              >
                <Ionicons name="help-circle-outline" size={22} color="#475569" />
              </Pressable>
            </View>
            <Text style={styles.subtitle}>{content.shortBlurb}</Text>
            {!loading && analogQuality ? (
              <Text style={styles.meta}>
                {analogQuality.topKCount} matches from {analogQuality.librarySampleCount} library
                samples
                {analogQuality.meanTopKDistance != null
                  ? ` · avg distance ${analogQuality.meanTopKDistance.toFixed(0)}`
                  : ''}
                {analogQuality.usedWeakFallback ? ' · includes recent-trend blend' : ''}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.closeBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Close model projection"
          >
            <Ionicons name="close" size={22} color="#334155" />
          </Pressable>
        </View>

        {!heatmapAvailable ? (
          <View style={styles.unavailableBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color="#475569" />
            <Text style={styles.unavailableText}>Current heatmap unavailable.</Text>
          </View>
        ) : null}

        {heatmapAvailable && !windAvailable && !loading ? (
          <View style={styles.fallbackBanner}>
            <Ionicons name="information-circle-outline" size={16} color="#92400e" />
            <Text style={styles.fallbackText}>
              {__DEV__ && windErrorMessage
                ? `Wind correction unavailable: ${windErrorMessage}`
                : 'Wind correction unavailable. Analog projection only.'}
            </Text>
          </View>
        ) : null}

        {heatmapAvailable && !loading && analogQuality?.usedWeakFallback ? (
          <View style={styles.fallbackBanner}>
            <Ionicons name="stats-chart-outline" size={16} color="#92400e" />
            <Text style={styles.fallbackText}>
              Limited analog match — blending with recent trend (
              {Math.round(analogQuality.weakFallbackWeight * 100)}%).
            </Text>
          </View>
        ) : null}

        <View style={styles.mapBody} onLayout={handleMapWrapLayout}>
          {mapMountReady && mapLayoutReady ? (
            <Mapbox.MapView
              style={styles.map}
              styleURL={Mapbox.StyleURL.Street}
              compassEnabled={false}
              logoEnabled={false}
              attributionEnabled={false}
              scaleBarEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              scrollEnabled={!loading}
              zoomEnabled={!loading}
              onCameraChanged={handleCameraChanged}
            >
              <Mapbox.Camera
                ref={cameraRef}
                defaultSettings={{
                  centerCoordinate: [mapRegion.longitude, mapRegion.latitude],
                  zoomLevel: DEFAULT_ZOOM_LEVEL,
                }}
                maxBounds={{
                  ne: [SSF_BBOX.seLon, SSF_BBOX.nwLat],
                  sw: [SSF_BBOX.nwLon, SSF_BBOX.seLat],
                }}
                minZoomLevel={MIN_ZOOM_LEVEL}
                maxZoomLevel={MAX_ZOOM_LEVEL}
              />
              {displayGrid.length > 0 ? (
                <KrigingHeatmapLayer
                  gridOverride={displayGrid}
                  opacityScale={displayOpacity}
                  layerIdPrefix="model-projection"
                />
              ) : null}
              {!loading ? (
                <WindArrowLayer
                  key={`wind-${minutesAhead}`}
                  layerIdPrefix="model-projection"
                  points={windArrowPoints}
                  visible={windAvailable && windArrowPoints.length > 0}
                />
              ) : null}
            </Mapbox.MapView>
          ) : null}
          {loading ? (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <ActivityIndicator size="large" color="#475569" />
              <Text style={styles.loadingText}>{loadMessage}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${loadProgressDisplay * 100}%` }]} />
              </View>
              <Text style={styles.progressPct}>{Math.round(loadProgress * 100)}%</Text>
            </View>
          ) : null}
          {!loading ? (
            <MapScaleActions
              overlayTop={8}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              canZoomIn={canZoomIn}
              canZoomOut={canZoomOut}
            />
          ) : null}
        </View>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <View style={styles.stepNavRow}>
            <Pressable
              onPress={stepBack}
              disabled={!stepNavEnabled || selectedStep <= 0}
              style={({ pressed }) => [
                styles.stepNavBtn,
                (!stepNavEnabled || selectedStep <= 0) && styles.stepNavBtnDisabled,
                pressed && stepNavEnabled && selectedStep > 0 && styles.stepNavBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Previous hour"
            >
              <Ionicons
                name="chevron-back"
                size={20}
                color={!stepNavEnabled || selectedStep <= 0 ? '#94a3b8' : '#334155'}
              />
              <Text
                style={[
                  styles.stepNavBtnText,
                  (!stepNavEnabled || selectedStep <= 0) && styles.stepNavBtnTextDisabled,
                ]}
              >
                −1h
              </Text>
            </Pressable>
            <Text style={styles.stepNavCenter}>{projectionHeader}</Text>
            <Pressable
              onPress={stepForward}
              disabled={!stepNavEnabled || selectedStep >= maxSelectableStep}
              style={({ pressed }) => [
                styles.stepNavBtn,
                (!stepNavEnabled || selectedStep >= maxSelectableStep) &&
                  styles.stepNavBtnDisabled,
                pressed &&
                  stepNavEnabled &&
                  selectedStep < maxSelectableStep &&
                  styles.stepNavBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Next hour"
            >
              <Text
                style={[
                  styles.stepNavBtnText,
                  (!stepNavEnabled || selectedStep >= maxSelectableStep) &&
                    styles.stepNavBtnTextDisabled,
                ]}
              >
                +1h
              </Text>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={
                  !stepNavEnabled || selectedStep >= maxSelectableStep ? '#94a3b8' : '#334155'
                }
              />
            </Pressable>
          </View>
          <View style={styles.tickRow}>
            {PROJECTION_MAJOR_STEP_INDICES.map((stepIndex, idx) => (
              <Pressable
                key={`major-${stepIndex}`}
                onPress={() => handleMajorTickPress(stepIndex)}
                disabled={loading || stepIndex > maxSelectableStep}
                style={({ pressed }) => [
                  styles.tickBtn,
                  selectedStep === stepIndex && styles.tickBtnActive,
                  pressed && styles.tickBtnPressed,
                  (loading || stepIndex > maxSelectableStep) && styles.tickBtnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel={PROJECTION_MAJOR_LABELS[idx]}
                accessibilityState={{
                  selected: selectedStep === stepIndex,
                  disabled: loading || stepIndex > maxSelectableStep,
                }}
              >
                <Text
                  style={[
                    styles.tickLabel,
                    selectedStep === stepIndex && styles.tickLabelActive,
                    (loading || stepIndex > maxSelectableStep) && styles.tickLabelDisabled,
                  ]}
                >
                  {PROJECTION_MAJOR_LABELS[idx]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      <Modal
        visible={helpModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setHelpModalOpen(false)}
      >
        <View style={styles.helpModalRoot}>
          <Pressable
            style={styles.helpModalBackdrop}
            onPress={() => setHelpModalOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={content.helpCloseA11y}
          />
          <View style={styles.helpModalCard}>
            <View style={styles.helpModalHeader}>
              <Text style={styles.helpModalTitle}>{content.helpTitle}</Text>
              <Pressable
                onPress={() => setHelpModalOpen(false)}
                hitSlop={12}
                style={({ pressed }) => [styles.helpModalCloseBtn, pressed && styles.helpBtnPressed]}
                accessibilityRole="button"
                accessibilityLabel={content.helpCloseA11y}
              >
                <Ionicons name="close" size={22} color="#334155" />
              </Pressable>
            </View>
            <ScrollView
              style={styles.helpModalScroll}
              contentContainerStyle={styles.helpModalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {content.helpPipeline.map((paragraph) => (
                <Text key={paragraph.slice(0, 48)} style={styles.helpParagraph}>
                  {paragraph}
                </Text>
              ))}
              <Text style={styles.helpSectionLabel}>{content.helpMatchesHeading}</Text>
              {loading || !analogQuality ? (
                <Text style={styles.helpMuted}>{content.helpMatchesLoading}</Text>
              ) : (
                <ModelProjectionMatchDetails quality={analogQuality} content={content} />
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Help modal body: library size, top-K analogs, per-horizon valid counts. */
function ModelProjectionMatchDetails({
  quality,
  content,
}: {
  quality: AnalogProjectionQuality;
  content: ModelProjectionContent;
}) {
  const belowMin = quality.librarySampleCount < MIN_USABLE_ANALOG_LIBRARY;
  return (
    <View style={styles.helpMatchBlock}>
      <Text style={styles.helpLine}>
        {content.matchLibraryLine(quality.librarySampleCount, belowMin, MIN_USABLE_ANALOG_LIBRARY)}
      </Text>
      <Text style={styles.helpLine}>
        {content.matchTopKLine(
          quality.topKCount,
          quality.meanTopKDistance != null ? quality.meanTopKDistance.toFixed(1) : null,
          quality.bestTopKDistance != null ? quality.bestTopKDistance.toFixed(1) : null,
        )}
      </Text>
      <Text style={styles.helpLine}>
        {content.matchFallbackLine(
          (quality.weakFallbackWeight * 100).toFixed(0),
          quality.usedWeakFallback,
        )}
      </Text>
      <Text style={styles.helpSubsectionLabel}>{content.matchRankedHeading}</Text>
      {quality.topAnalogMatches.length === 0 ? (
        <Text style={styles.helpMuted}>{content.matchNoMatches}</Text>
      ) : (
        quality.topAnalogMatches.map((match, index) => (
          <Text key={`${match.time}-${index}`} style={styles.helpMatchRow}>
            {content.matchAnalogRow(
              index + 1,
              formatAnalogTimestamp(match.time, content.localeTag),
              match.distance.toFixed(1),
              `${(match.weight * 100).toFixed(1)}%`,
            )}
          </Text>
        ))
      )}
      <Text style={styles.helpSubsectionLabel}>{content.matchFutureHeading}</Text>
      {Array.from({ length: PROJECTION_FUTURE_STEPS }, (_, i) => {
        const libN = quality.horizonLibraryValidCounts[i] ?? 0;
        const topN = quality.horizonTopKValidCounts[i] ?? 0;
        const enoughLib = libN >= MIN_USABLE_ANALOG_LIBRARY;
        const enoughTop = topN >= Math.max(3, Math.floor(quality.topKCount * 0.5));
        return (
          <Text key={`horizon-${i}`} style={styles.helpLine}>
            {content.matchHorizonLine(
              horizonLabelForStepIndex(i + 1),
              libN,
              topN,
              enoughLib && enoughTop,
            )}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: ROOT_TAB_BAR_RESERVED_HEIGHT,
    zIndex: MODEL_PROJECTION_OVERLAY_Z_INDEX,
    elevation: MODEL_PROJECTION_OVERLAY_Z_INDEX,
    borderBottomLeftRadius: ROOT_TAB_BAR_TOP_RADIUS,
    borderBottomRightRadius: ROOT_TAB_BAR_TOP_RADIUS,
    overflow: 'hidden',
    backgroundColor: '#f1f5f9',
  },
  root: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 14,
    paddingBottom: 10,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: '#dbe5f2',
  },
  headerTextCol: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  experimentalBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fcd34d',
  },
  experimentalBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#92400e',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  title: {
    flex: 1,
    minWidth: 120,
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: 0.1,
  },
  helpBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e2e8f0',
  },
  helpBtnPressed: {
    opacity: 0.85,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: '#475569',
    fontWeight: '500',
  },
  meta: {
    fontSize: 11,
    lineHeight: 15,
    color: '#64748b',
    fontWeight: '600',
  },
  helpModalRoot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  helpModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  helpModalCard: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '82%',
    borderRadius: 16,
    paddingTop: 14,
    paddingBottom: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 12,
    zIndex: 2,
  },
  helpModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  helpModalTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '800',
    color: '#0f172a',
  },
  helpModalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  helpModalScroll: {
    flexGrow: 0,
  },
  helpModalScrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 10,
  },
  helpParagraph: {
    fontSize: 13,
    lineHeight: 19,
    color: '#334155',
    fontWeight: '500',
  },
  helpSectionLabel: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '800',
    color: '#0f172a',
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  helpSubsectionLabel: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  helpMatchBlock: {
    gap: 4,
  },
  helpLine: {
    fontSize: 12,
    lineHeight: 17,
    color: '#334155',
    fontWeight: '500',
  },
  helpMatchRow: {
    fontSize: 11,
    lineHeight: 16,
    color: '#475569',
    fontWeight: '500',
  },
  helpMuted: {
    fontSize: 12,
    lineHeight: 17,
    color: '#64748b',
    fontWeight: '500',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  closeBtnPressed: {
    opacity: 0.88,
  },
  unavailableBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  unavailableText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#475569',
    fontWeight: '600',
  },
  fallbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  fallbackText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#92400e',
    fontWeight: '600',
  },
  mapBody: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    backgroundColor: '#dbeafe',
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(241,245,249,0.72)',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  progressTrack: {
    width: 240,
    height: 9,
    borderRadius: 999,
    backgroundColor: '#cbd5e1',
    overflow: 'hidden',
    marginTop: 4,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#1e40af',
  },
  progressPct: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
  },
  footer: {
    flexShrink: 0,
    zIndex: 2,
    elevation: 2,
    paddingLeft: 44,
    paddingRight: 14,
    paddingTop: 10,
    backgroundColor: '#f8fafc',
    borderTopWidth: 1,
    borderTopColor: '#dbe5f2',
    gap: 8,
  },
  stepNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  stepNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minWidth: 84,
    minHeight: 32,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  stepNavBtnPressed: {
    opacity: 0.88,
    backgroundColor: '#f1f5f9',
  },
  stepNavBtnDisabled: {
    opacity: 0.5,
  },
  stepNavBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#334155',
  },
  stepNavBtnTextDisabled: {
    color: '#94a3b8',
  },
  stepNavCenter: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: '#1e40af',
  },
  tickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tickBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    minWidth: 28,
    minHeight: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12
  },
  tickBtnActive: {
    backgroundColor: '#e2e8f0',
  },
  tickBtnPressed: {
    opacity: 0.85,
  },
  tickBtnDisabled: {
    opacity: 0.4,
  },
  tickLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748b',
  },
  tickLabelActive: {
    color: '#0f172a',
  },
  tickLabelDisabled: {
    color: '#94a3b8',
  },
});
