import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  buildWindGridCaption,
  downsampleWindGridPoints,
  fetchForecastWindGrid,
  windGridSliceAtMinutes,
  type ForecastWindGridByTime,
} from '../lib/forecastWindGrid';
import {
  generateProjectionFrameAtStep,
  type ProjectionDebugMode,
} from '../lib/generateWindAdjustedFrames';
import type { TrendHistoryGrids } from '../lib/projectionTrendHistory';
import type { MapRegion } from '../lib/mapRegionFromData';
import {
  formatProjectionHeader,
  minutesAheadForStep,
  PROJECTION_FRAME_COUNT,
  PROJECTION_MAJOR_LABELS,
  PROJECTION_MAJOR_STEP_INDICES,
} from '../lib/projectionTimeLabels';
import { fetchProjectionTrendHistory } from '../lib/projectionTrendHistory';
import { ROOT_TAB_BAR_TOP_RADIUS } from '../lib/constants/appLayout';
import { EXPECTED_GRID_CELLS, resolveHeatmapGridRows } from '../lib/resolveHeatmapGrid';
import type { SensorPoint } from '../lib/sensorTypes';

export type ModelProjectionMapProps = {
  visible: boolean;
  onClose: () => void;
  mapKriging: CurrentKrigingRow[];
  mapSensors: SensorPoint[];
  mapRegion: MapRegion;
  /** Pipeline times for trend lookback (~10/20/30 min). */
  timelineTimesAsc?: string[];
  viewingLive?: boolean;
};

const DEFAULT_ZOOM_LEVEL = 12;
const MIN_ZOOM_LEVEL = DEFAULT_ZOOM_LEVEL * 0.5;
const MAX_ZOOM_LEVEL = DEFAULT_ZOOM_LEVEL * 3;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function ModelProjectionMap({
  visible,
  onClose,
  mapKriging,
  mapSensors,
  mapRegion,
  timelineTimesAsc = [],
  viewingLive = true,
}: ModelProjectionMapProps) {
  const insets = useSafeAreaInsets();
  const [selectedStep, setSelectedStep] = useState(0);
  const [windData, setWindData] = useState<ForecastWindGridByTime | null>(null);
  const [windAvailable, setWindAvailable] = useState(false);
  const [windErrorMessage, setWindErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapLayoutReady, setMapLayoutReady] = useState(false);
  const [mapMountReady, setMapMountReady] = useState(false);
  const [trendHistory, setTrendHistory] = useState<TrendHistoryGrids | null>(null);
  const [debugMode, setDebugMode] = useState<ProjectionDebugMode>('blend');

  const nowGrid = useMemo(() => {
    if (mapKriging.length >= EXPECTED_GRID_CELLS) return mapKriging;
    return resolveHeatmapGridRows({ kriging: mapKriging, sensors: mapSensors });
  }, [mapKriging, mapSensors]);

  const heatmapAvailable = nowGrid.length > 0;
  const maxStep = PROJECTION_FRAME_COUNT - 1;

  useEffect(() => {
    if (!visible) {
      setMapLayoutReady(false);
      return;
    }

    setSelectedStep(0);
    setWindData(null);
    setTrendHistory(null);
    setWindAvailable(false);
    setWindErrorMessage(null);
    setDebugMode('blend');

    if (!heatmapAvailable) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const wind = await fetchForecastWindGrid();
      if (cancelled) return;
      setWindData(wind);
      setWindAvailable(wind.available);
      setWindErrorMessage(wind.available ? null : (wind.errorMessage ?? 'Wind data unavailable'));
      setLoading(false);

      if (viewingLive && timelineTimesAsc.length > 0) {
        const history = await fetchProjectionTrendHistory(timelineTimesAsc);
        if (!cancelled) setTrendHistory(history);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, heatmapAvailable, timelineTimesAsc, viewingLive]);

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
    if (!heatmapAvailable) return null;
    return generateProjectionFrameAtStep(
      nowGrid,
      selectedStep,
      windData,
      trendHistory,
      debugMode,
    );
  }, [nowGrid, selectedStep, windData, trendHistory, debugMode, heatmapAvailable]);

  const displayGrid = activeFrame?.grid ?? nowGrid;
  const displayOpacity = activeFrame?.opacityScale ?? 1;
  const uncertaintyOverlay = activeFrame?.uncertaintyOverlay ?? 0;
  const minutesAhead = activeFrame?.minutesAhead ?? minutesAheadForStep(selectedStep);
  const projectionHeader = formatProjectionHeader(minutesAhead);
  const maxSelectableStep = windAvailable ? maxStep : 0;
  const stepNavEnabled = heatmapAvailable && !loading && maxSelectableStep > 0;

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const windCaption = useMemo(() => {
    if (!windData) {
      return 'Wind: Open-Meteo 10 m grid (forecast_wind_grid)';
    }
    return buildWindGridCaption(windData, mapRegion.latitude, mapRegion.longitude, minutesAhead);
  }, [windData, mapRegion.latitude, mapRegion.longitude, minutesAhead]);

  const windArrowPoints = useMemo(() => {
    if (!windData?.available) return [];
    const slice = windGridSliceAtMinutes(windData.byTime, minutesAhead);
    if (!slice?.length) return [];
    return downsampleWindGridPoints(slice);
  }, [windData, minutesAhead]);

  const debugLabel =
    debugMode === 'now' ? 'Debug: Now only' : debugMode === 'wind-only' ? 'Debug: Wind-shifted only' : 'Debug: Final blend';

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
            <Text style={styles.title}>Experimental persistence + wind-adjusted PM2.5 projection</Text>
            <Text style={styles.projectionTime}>{projectionHeader}</Text>
            <Text style={styles.caption}>
              Blend weights increase trend and wind toward +5h. Uncertainty overlay increases
              over time; concentrations stay anchored to observations.
            </Text>
            <Text style={styles.windCaption}>{windCaption}</Text>
            {__DEV__ ? (
              <View style={styles.debugRow}>
                <Text style={styles.debugLabel}>{debugLabel}</Text>
                <View style={styles.debugPills}>
                  {(
                    [
                      ['now', 'Now'],
                      ['wind-only', 'Wind only'],
                      ['blend', 'Blend'],
                    ] as const
                  ).map(([mode, label]) => (
                    <Pressable
                      key={mode}
                      onPress={() => setDebugMode(mode)}
                      style={[
                        styles.debugPill,
                        debugMode === mode && styles.debugPillActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.debugPillText,
                          debugMode === mode && styles.debugPillTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
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
                ? `Wind projection unavailable: ${windErrorMessage}`
                : 'Wind projection unavailable. Showing current conditions only.'}
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
              <WindArrowLayer
                points={windArrowPoints}
                visible={windAvailable && windArrowPoints.length > 0}
              />
            </Mapbox.MapView>
          ) : null}
          {loading ? (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <ActivityIndicator size="large" color="#475569" />
              <Text style={styles.loadingText}>Building projection…</Text>
            </View>
          ) : null}
          {uncertaintyOverlay > 0 ? (
            <View
              pointerEvents="none"
              style={[styles.uncertaintyVeil, { opacity: uncertaintyOverlay }]}
            />
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
              accessibilityLabel="Previous 10 minutes"
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
                −10m
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
              accessibilityLabel="Next 10 minutes"
            >
              <Text
                style={[
                  styles.stepNavBtnText,
                  (!stepNavEnabled || selectedStep >= maxSelectableStep) &&
                    styles.stepNavBtnTextDisabled,
                ]}
              >
                +10m
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
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.doneBtn, pressed && styles.doneBtnPressed]}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text style={styles.doneBtnText}>Done</Text>
          </Pressable>
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
  projectionTime: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1e40af',
    letterSpacing: 0.1,
  },
  caption: {
    fontSize: 12,
    lineHeight: 17,
    color: '#64748b',
  },
  windCaption: {
    fontSize: 11,
    lineHeight: 16,
    color: '#475569',
    marginTop: 2,
  },
  debugRow: {
    marginTop: 6,
    gap: 6,
  },
  debugLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
  },
  debugPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  debugPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  debugPillActive: {
    borderColor: '#1e40af',
    backgroundColor: '#dbeafe',
  },
  debugPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748b',
  },
  debugPillTextActive: {
    color: '#1e3a8a',
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
  uncertaintyVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#e2e8f0',
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
    fontSize: 12,
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
  doneBtn: {
    minHeight: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e40af',
  },
  doneBtnPressed: {
    opacity: 0.9,
  },
  doneBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 0.2,
  },
});
