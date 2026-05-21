import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  InteractionManager,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Mapbox from '@rnmapbox/maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KrigingHeatmapLayer } from './KrigingHeatmapLayer';
import { WindArrowLayer } from './WindArrowLayer';
import type { CurrentKrigingRow } from '../lib/database.types';
import { SSF_BBOX } from '../lib/constants/ssf';
import {
  fetchForecastWindGrid,
  windGridSliceAtMinutes,
  type ForecastWindGridByTime,
} from '../lib/forecastWindGrid';
import { buildHistoricalAnalogLibrary } from '../lib/modeling/buildHistoricalAnalogLibrary';
import {
  formatAnalogTimestamp,
  horizonLabelForStepIndex,
  MIN_USABLE_ANALOG_LIBRARY,
  type AnalogProjectionQuality,
} from '../lib/modeling/analogProjectionMetrics';
import {
  generateAnalogProjectionFrames,
  type ProjectionFrame,
} from '../lib/modeling/generateAnalogProjectionFrames';
import { createSmoothLoadProgress } from '../lib/modeling/smoothLoadProgress';
import type { MapRegion } from '../lib/mapRegionFromData';
import {
  formatProjectionHeader,
  minutesAheadForStep,
  PROJECTION_FRAME_COUNT,
  PROJECTION_FUTURE_STEPS,
  PROJECTION_MAJOR_LABELS,
  PROJECTION_MAJOR_STEP_INDICES,
} from '../lib/projectionTimeLabels';
import { ROOT_TAB_BAR_TOP_RADIUS } from '../lib/constants/appLayout';
import { EXPECTED_GRID_CELLS, resolveHeatmapGridRows } from '../lib/resolveHeatmapGrid';
import type { SensorPoint } from '../lib/sensorTypes';

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

const DEFAULT_ZOOM_LEVEL = 12;
const MIN_ZOOM_LEVEL = DEFAULT_ZOOM_LEVEL * 0.5;
const MAX_ZOOM_LEVEL = DEFAULT_ZOOM_LEVEL * 3;

const MODEL_BLURB =
  'Compares today’s pollution and wind to similar past days, then blends how those situations changed over the next few hours.';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function ModelProjectionMap({
  visible,
  onClose,
  mapKriging,
  mapSensors,
  mapRegion,
  timelineTimesAsc: _timelineTimesAsc = [],
  viewingLive: _viewingLive = true,
}: ModelProjectionMapProps) {
  const insets = useSafeAreaInsets();
  const [selectedStep, setSelectedStep] = useState(0);
  const [windData, setWindData] = useState<ForecastWindGridByTime | null>(null);
  const [windAvailable, setWindAvailable] = useState(false);
  const [windErrorMessage, setWindErrorMessage] = useState<string | null>(null);
  const [precomputedFrames, setPrecomputedFrames] = useState<ProjectionFrame[] | null>(null);
  const [analogQuality, setAnalogQuality] = useState<AnalogProjectionQuality | null>(null);
  const [qualityPanelOpen, setQualityPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadMessage, setLoadMessage] = useState('Preparing projection…');
  const [mapLayoutReady, setMapLayoutReady] = useState(false);
  const [mapMountReady, setMapMountReady] = useState(false);
  const frozenBaseRef = useRef<FrozenProjectionBase | null>(null);
  const prevVisibleRef = useRef(false);

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

  const nowGrid = useMemo(() => {
    if (baseKriging.length >= EXPECTED_GRID_CELLS) return baseKriging;
    return resolveHeatmapGridRows({ kriging: baseKriging, sensors: baseSensors });
  }, [baseKriging, baseSensors]);

  const heatmapAvailable = nowGrid.length > 0;
  const maxStep = PROJECTION_FRAME_COUNT - 1;

  useEffect(() => {
    if (!visible) {
      setMapLayoutReady(false);
      return;
    }

    setSelectedStep(0);
    setWindData(null);
    setPrecomputedFrames(null);
    setAnalogQuality(null);
    setQualityPanelOpen(false);
    setWindAvailable(false);
    setWindErrorMessage(null);
    setLoadProgress(0);
    setLoadMessage('Preparing projection…');

    if (!heatmapAvailable) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const smooth = createSmoothLoadProgress((display, msg) => {
      if (cancelled) return;
      setLoadProgress(display);
      setLoadMessage(msg);
    }, { estimatedMs: 16_000 });

    smooth.setTarget(0.03, 'Starting…');

    void (async () => {
      let windReady = false;
      let libraryProgress = 0;
      let libraryMessage = 'Loading sensor history…';

      const syncParallelProgress = () => {
        const windSlice = windReady ? 0.08 : 0;
        const libSlice = libraryProgress * 0.82;
        smooth.setTarget(0.08 + windSlice + libSlice, libraryMessage);
      };

      const [wind, libraryResult] = await Promise.all([
        fetchForecastWindGrid().then((w) => {
          windReady = true;
          syncParallelProgress();
          return w;
        }),
        buildHistoricalAnalogLibrary(Date.now(), (p, message) => {
          libraryProgress = p;
          libraryMessage = message;
          syncParallelProgress();
        }),
      ]);
      if (cancelled) {
        smooth.stop();
        return;
      }

      setWindData(wind);
      setWindAvailable(wind.available);
      setWindErrorMessage(wind.available ? null : (wind.errorMessage ?? 'Wind data unavailable'));

      smooth.setTarget(0.94, 'Computing forecast frames…');

      const { frames, quality } = generateAnalogProjectionFrames({
        nowGrid,
        wind,
        library: libraryResult.library,
        debugMode: 'blend',
      });

      if (cancelled) {
        smooth.stop();
        return;
      }
      setPrecomputedFrames(frames.length > 0 ? frames : null);
      setAnalogQuality(quality);

      smooth.finish('Ready', () => {
        if (cancelled) return;
        setLoadProgress(1);
        setLoading(false);
      });
    })();

    return () => {
      cancelled = true;
      smooth.stop();
    };
  }, [visible, heatmapAvailable, nowGrid]);

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

  const activeFrame = useMemo(() => {
    if (!heatmapAvailable || !precomputedFrames) return null;
    return precomputedFrames[clamp(selectedStep, 0, precomputedFrames.length - 1)] ?? null;
  }, [precomputedFrames, selectedStep, heatmapAvailable]);

  const displayGrid = activeFrame?.grid ?? nowGrid;
  const uncertainty = activeFrame?.uncertaintyOverlay ?? 0;
  const displayOpacity = Math.max(0.5, (activeFrame?.opacityScale ?? 1) * (1 - uncertainty * 0.55));
  const minutesAhead = activeFrame?.minutesAhead ?? minutesAheadForStep(selectedStep);
  const loadProgressDisplay = Math.max(0.04, Math.min(1, loadProgress));
  const projectionHeader = formatProjectionHeader(minutesAhead);
  const maxSelectableStep =
    precomputedFrames && precomputedFrames.length > 1 ? precomputedFrames.length - 1 : 0;
  const stepNavEnabled = heatmapAvailable && !loading && maxSelectableStep > 0;

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

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

  if (!visible) return null;

  return (
    <View style={styles.overlay} accessibilityViewIsModal>
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) + 4 }]}>
          <View style={styles.headerTextCol}>
            <Text style={styles.title}>Historical analog PM₂.₅ projection</Text>
            <Text style={styles.subtitle}>{MODEL_BLURB}</Text>
            {!loading && analogQuality ? (
              <Text style={styles.meta}>
                {analogQuality.librarySampleCount} usable analog
                {analogQuality.librarySampleCount === 1 ? '' : 's'}
                {analogQuality.meanTopKDistance != null
                  ? ` · avg match ${analogQuality.meanTopKDistance.toFixed(0)}`
                  : ''}
                {analogQuality.usedWeakFallback ? ' · trend blend' : ''}
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

        {heatmapAvailable && !loading && analogQuality ? (
          <Pressable
            onPress={() => setQualityPanelOpen((o) => !o)}
            style={({ pressed }) => [styles.qualityPanelToggle, pressed && styles.qualityPanelTogglePressed]}
            accessibilityRole="button"
            accessibilityState={{ expanded: qualityPanelOpen }}
            accessibilityLabel="Analog match quality details"
          >
            <View style={styles.qualityPanelToggleRow}>
              <Ionicons
                name={qualityPanelOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color="#475569"
              />
              <Text style={styles.qualityPanelToggleText}>Analog quality</Text>
              {uncertainty > 0.12 ? (
                <Text style={styles.qualityUncertaintyBadge}>
                  {Math.round(uncertainty * 100)}% uncertain
                </Text>
              ) : null}
            </View>
            {qualityPanelOpen ? (
              <View style={styles.qualityPanelBody}>
                <Text style={styles.qualityLine}>
                  Library: {analogQuality.librarySampleCount} samples
                  {analogQuality.librarySampleCount < MIN_USABLE_ANALOG_LIBRARY
                    ? ` (below ${MIN_USABLE_ANALOG_LIBRARY})`
                    : ''}
                </Text>
                <Text style={styles.qualityLine}>
                  Top-{analogQuality.topKCount} match
                  {analogQuality.meanTopKDistance != null
                    ? ` · avg distance ${analogQuality.meanTopKDistance.toFixed(1)}`
                    : ''}
                  {analogQuality.bestTopKDistance != null
                    ? ` · best ${analogQuality.bestTopKDistance.toFixed(1)}`
                    : ''}
                </Text>
                <Text style={styles.qualityLine}>
                  Weak fallback weight: {(analogQuality.weakFallbackWeight * 100).toFixed(0)}%
                </Text>
                <Text style={styles.qualitySectionLabel}>Top analog timestamps</Text>
                {analogQuality.topAnalogTimestamps.length === 0 ? (
                  <Text style={styles.qualityMuted}>None</Text>
                ) : (
                  analogQuality.topAnalogTimestamps.map((iso) => (
                    <Text key={iso} style={styles.qualityMuted}>
                      {formatAnalogTimestamp(iso)}
                    </Text>
                  ))
                )}
                <Text style={styles.qualitySectionLabel}>Future deltas (library / top-K)</Text>
                {Array.from({ length: PROJECTION_FUTURE_STEPS }, (_, i) => {
                  const libN = analogQuality.horizonLibraryValidCounts[i] ?? 0;
                  const topN = analogQuality.horizonTopKValidCounts[i] ?? 0;
                  const enoughLib = libN >= MIN_USABLE_ANALOG_LIBRARY;
                  const enoughTop = topN >= Math.max(3, Math.floor(analogQuality.topKCount * 0.5));
                  return (
                    <Text key={`horizon-${i}`} style={styles.qualityLine}>
                      {horizonLabelForStepIndex(i + 1)}: {libN} library / {topN} top-K
                      {enoughLib && enoughTop ? ' ✓' : ' · thin'}
                    </Text>
                  );
                })}
              </View>
            ) : null}
          </Pressable>
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
            >
              <Mapbox.Camera
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
        </View>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
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
                size={18}
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
                size={18}
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
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    elevation: 40,
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
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: 0.1,
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
  qualityPanelToggle: {
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  qualityPanelTogglePressed: {
    opacity: 0.9,
  },
  qualityPanelToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  qualityPanelToggleText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  qualityUncertaintyBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1e40af',
  },
  qualityPanelBody: {
    marginTop: 10,
    gap: 4,
  },
  qualitySectionLabel: {
    marginTop: 6,
    fontSize: 11,
    fontWeight: '800',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  qualityLine: {
    fontSize: 11,
    lineHeight: 16,
    color: '#334155',
    fontWeight: '500',
  },
  qualityMuted: {
    fontSize: 11,
    lineHeight: 16,
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
    paddingHorizontal: 14,
    paddingTop: 12,
    backgroundColor: '#f8fafc',
    borderTopWidth: 1,
    borderTopColor: '#dbe5f2',
    gap: 10,
  },
  stepNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  stepNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minHeight: 40,
    paddingHorizontal: 10,
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
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
  },
  stepNavBtnTextDisabled: {
    color: '#94a3b8',
  },
  stepNavCenter: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: '#1e40af',
  },
  tickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tickBtn: {
    paddingHorizontal: 2,
    paddingVertical: 4,
    borderRadius: 8,
    minWidth: 28,
    alignItems: 'center',
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
    fontSize: 11,
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
