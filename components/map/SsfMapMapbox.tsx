/**
 * Mapbox map for the map tab: kriging heatmap, sensor circles, selection callout, zoom.
 * Tap handling debounces panel vs sensor vs map presses; parent owns selection and map chrome.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Mapbox from '@rnmapbox/maps';
import type { FeatureCollection, Point } from 'geojson';
import { Animated, LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { CurrentKrigingRow } from '../../lib/shell/supabase';
import { SSF_BBOX } from '../../lib/map/mapRegionFromData';
import { pm25BreakpointCategory, pm25ToAqi } from '../../lib/shell/airQualityBreakpoints';
import type { MapRegion } from '../../lib/map/mapRegionFromData';
import {
  findSensorNear,
  isValidSensorIndex,
  normalizeSensorIndex,
  SENSOR_FEATURE_HIT_KM,
  SENSOR_MAP_HIT_KM,
  sensorDetailFromPoint,
  type SensorPoint,
} from '../../lib/map/sensorTypes';
import { KrigingHeatmapLayer } from './KrigingHeatmapLayer';

/** Passed to onSelectCoordinate so the screen can place callouts and detect sensor taps. */
export type MapSelectDetail = {
  screenPointX?: number | null;
  screenPointY?: number | null;
  sensorIndex?: number | string;
  sensorSource?: string;
  sensorName?: string | null;
};

/** Map tab surface props; parent owns selection state and callout content. */
export type SsfMapProps = {
  sensors: SensorPoint[];
  kriging: CurrentKrigingRow[];
  mapRegion: MapRegion;
  selected: { latitude: number; longitude: number } | null;
  /** Saved reminder pin (same coords as global reminder in the panel). */
  reminderLocation?: { latitude: number; longitude: number } | null;
  onSelectCoordinate: (lat: number, lon: number, detail: MapSelectDetail) => void;
  selectedCallout?: ReactNode;
  selectedCalloutPlacement?: 'above' | 'below';
  selectedCalloutShiftX?: number;
  /** Screen-owned panel touch lock (shared with AqiPanel onPanelTouchStart). */
  onPanelTouch?: () => void;
  isPanelTouchLocked?: () => boolean;
  /** Fired when zoom limits change so the screen can drive MapScaleActions. */
  onZoomStateChange?: (state: { canZoomIn: boolean; canZoomOut: boolean }) => void;
};

/** Imperative API for alert focus, post-selection camera fly-to, and zoom. */
export type SsfMapHandle = {
  focusCoordinate: (lat: number, lon: number, zoomLevel?: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

/** Camera zoom when flying to a saved alert pin or post-selection focus. */
const NOTIFICATION_FOCUS_ZOOM = 14;

const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
if (mapboxToken) {
  Mapbox.setAccessToken(mapboxToken);
}

/** Zoom limits for MapScaleActions and Camera; synced via onCameraChanged. */
const DEFAULT_ZOOM_LEVEL = 12;
const MIN_ZOOM_FACTOR = 0.5;
const MAX_ZOOM_FACTOR = 3;
const MIN_ZOOM_LEVEL = DEFAULT_ZOOM_LEVEL * MIN_ZOOM_FACTOR;
const MAX_ZOOM_LEVEL = DEFAULT_ZOOM_LEVEL * MAX_ZOOM_FACTOR;
const ZOOM_STEP = 1;
/** Ignore MapView onPress right after ShapeSource sensor press (both fire in sequence). */
const SENSOR_TAP_MAP_GUARD_MS = 250;
const CALLOUT_CARD_WIDTH = 300;
const CALLOUT_ARROW_HALF_WIDTH = 8;
/** Arrow may slide along the panel edge but stays at least this far from the panel sides. */
const CALLOUT_ARROW_EDGE_INSET = 20;
const REMINDER_BELL_PATH =
  'M42.2174 32.922V21.7756C42.2174 20.4935 42.0235 19.2188 41.6423 17.9946C37.9321 6.07937 21.0679 6.07937 17.3577 17.9946C16.9765 19.2188 16.7826 20.4935 16.7826 21.7756V32.922C16.7826 34.01 16.3743 35.0585 15.6383 35.8599L11.5394 40.3236C10.9506 40.9648 11.4054 42 12.2759 42H46.7241C47.5946 42 48.0494 40.9648 47.4606 40.3236L43.3617 35.8599C42.6257 35.0585 42.2174 34.01 42.2174 32.922Z';

/** Saved reminder pin artwork (matches panel bell styling). */
function ReminderBellIcon() {
  return (
    <Svg width={30} height={30} viewBox="0 0 60 60">
      <Circle cx={29.5} cy={45.5} r={6.5} fill="#F66D1E" stroke="#AA2C1E" strokeWidth={4} />
      <Path
        d={REMINDER_BELL_PATH}
        fill="#F66D1E"
        stroke="#AA2C1E"
        strokeWidth={4}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Mapbox-backed map tab surface; Expo Go uses the no-op fallback in SsfMap.tsx. */
export const SsfMap = forwardRef<SsfMapHandle, SsfMapProps>(function SsfMap(
  {
    sensors,
    kriging,
    mapRegion,
    selected,
    reminderLocation = null,
    onSelectCoordinate,
    selectedCallout = null,
    selectedCalloutPlacement = 'above',
    selectedCalloutShiftX = 0,
    onPanelTouch,
    isPanelTouchLocked,
    onZoomStateChange,
  },
  ref,
) {
  const mapLayoutReadyRef = useRef(false);
  const [mapLayoutReady, setMapLayoutReady] = useState(false);
  const cameraRef = useRef<Mapbox.Camera>(null);
  const lastSensorTapMsRef = useRef(0);
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM_LEVEL);
  const calloutScale = useRef(new Animated.Value(0.92)).current;
  const calloutOpacity = useRef(new Animated.Value(0)).current;
  const [animatedSelected, setAnimatedSelected] = useState(selected);
  const [animatedCallout, setAnimatedCallout] = useState<ReactNode>(selectedCallout);
  const [animatedPlacement, setAnimatedPlacement] = useState<'above' | 'below'>(selectedCalloutPlacement);
  const [animatedShiftX, setAnimatedShiftX] = useState(selectedCalloutShiftX);
  const prevSelectedCoordKeyRef = useRef<string | null>(
    selected ? `${selected.latitude.toFixed(6)}:${selected.longitude.toFixed(6)}` : null,
  );
  const mapSensors = useMemo(
    () => sensors.filter((s) => isValidSensorIndex(s.sensorIndex)),
    [sensors],
  );
  const sensorGeoJson = useMemo(() => {
    const shape: FeatureCollection<
      Point,
      { sensor_index: number | string; source: string; name: string | null; pm25: number; aqi: number; color: string }
    > = {
      type: 'FeatureCollection',
      features: mapSensors.map((s) => ({
        type: 'Feature' as const,
        id: `s-${s.source}-${s.sensorIndex}`,
        geometry: {
          type: 'Point' as const,
          coordinates: [s.longitude, s.latitude],
        },
        properties: {
          sensor_index: s.sensorIndex,
          source: s.source,
          name: s.name ?? null,
          pm25: s.pm25,
          aqi: pm25ToAqi(s.pm25) ?? 0,
          color: pm25BreakpointCategory(s.pm25).bg,
        },
      })),
    };
    return shape;
  }, [mapSensors]);

  /** Prefer exact feature id from ShapeSource; fall back to proximity search. */
  const resolveSensorAt = useCallback(
    (
      lat: number,
      lon: number,
      featureProps?: { sensor_index?: unknown; source?: unknown; name?: unknown },
      maxKm = SENSOR_FEATURE_HIT_KM,
    ) => {
      const parsedIndex = featureProps ? normalizeSensorIndex(featureProps.sensor_index) : null;
      if (parsedIndex != null) {
        const source =
          typeof featureProps?.source === 'string' ? featureProps.source : undefined;
        const byIndex =
          mapSensors.find(
            (s) =>
              s.sensorIndex === parsedIndex && (source == null || s.source === source),
          ) ?? mapSensors.find((s) => s.sensorIndex === parsedIndex);
        if (byIndex) return sensorDetailFromPoint(byIndex);
      }
      const near = findSensorNear(lat, lon, mapSensors, maxKm);
      return near ? sensorDetailFromPoint(near) : undefined;
    },
    [mapSensors],
  );

  const selectedGeoJson = useMemo(() => {
    if (!selected) return null;
    const shape: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [selected.longitude, selected.latitude],
          },
          properties: {},
        },
      ],
    };
    return shape;
  }, [selected]);

  const handlePress = useCallback(
    (
      lat: number,
      lon: number,
      pageX: number | null,
      pageY: number | null,
      sensorDetail?: { sensorIndex?: number | string; sensorSource?: string; sensorName?: string | null },
    ) => {
      onSelectCoordinate(lat, lon, {
        screenPointX: pageX,
        screenPointY: pageY,
        ...sensorDetail,
      });
    },
    [onSelectCoordinate],
  );

  const panelTouchLocked = useCallback(() => isPanelTouchLocked?.() ?? false, [isPanelTouchLocked]);

  const handleMapPress = useCallback(
    (event: any) => {
      if (panelTouchLocked()) return;
      if (Date.now() - lastSensorTapMsRef.current < SENSOR_TAP_MAP_GUARD_MS) return;
      const coords = event?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return;
      const [lon, lat] = coords;
      const maybePageX = (event?.properties as { screenPointX?: number } | undefined)?.screenPointX ?? null;
      const maybePageY = (event?.properties as { screenPointY?: number } | undefined)?.screenPointY ?? null;
      const sensorDetail = resolveSensorAt(lat, lon, undefined, SENSOR_MAP_HIT_KM);
      if (sensorDetail) lastSensorTapMsRef.current = Date.now();
      handlePress(lat, lon, maybePageX, maybePageY, sensorDetail);
    },
    [handlePress, panelTouchLocked, resolveSensorAt],
  );

  const handleSensorPress = useCallback(
    (event: any) => {
      if (panelTouchLocked()) return;
      const feature = event.features?.[0];
      const coords = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
      if (!coords || coords.length < 2) return;
      const [lon, lat] = coords;
      const sensorDetail = resolveSensorAt(lat, lon, feature?.properties, SENSOR_FEATURE_HIT_KM);
      if (!sensorDetail) return;
      const pressPoint = (event as { point?: { x?: number; y?: number } }).point;
      const maybePageX =
        typeof pressPoint?.x === 'number' && Number.isFinite(pressPoint.x) ? pressPoint.x : null;
      const maybePageY =
        typeof pressPoint?.y === 'number' && Number.isFinite(pressPoint.y) ? pressPoint.y : null;
      lastSensorTapMsRef.current = Date.now();
      handlePress(lat, lon, maybePageX, maybePageY, sensorDetail);
    },
    [handlePress, panelTouchLocked, resolveSensorAt],
  );

  const handleReminderPress = useCallback(() => {
    if (panelTouchLocked()) return;
    if (!reminderLocation) return;
    handlePress(reminderLocation.latitude, reminderLocation.longitude, null, null);
  }, [handlePress, panelTouchLocked, reminderLocation]);

  const notifyPanelTouch = useCallback(() => {
    onPanelTouch?.();
  }, [onPanelTouch]);

  // Slide callout arrow along card edge so it still points at the pin when panel is shifted.
  const calloutLayout = useMemo(() => {
    const panelShiftX = animatedShiftX;
    const pinXInPanel = CALLOUT_CARD_WIDTH / 2 - panelShiftX;
    const arrowMin = CALLOUT_ARROW_EDGE_INSET + CALLOUT_ARROW_HALF_WIDTH;
    const arrowMax = CALLOUT_CARD_WIDTH - CALLOUT_ARROW_EDGE_INSET - CALLOUT_ARROW_HALF_WIDTH;
    const arrowCenterX = Math.min(arrowMax, Math.max(arrowMin, pinXInPanel));
    const anchorX = Math.min(0.95, Math.max(0.05, pinXInPanel / CALLOUT_CARD_WIDTH));
    return {
      anchorX,
      arrowLeft: arrowCenterX - CALLOUT_ARROW_HALF_WIDTH,
    };
  }, [animatedShiftX]);

  const canZoomIn = zoomLevel < MAX_ZOOM_LEVEL - 0.05;
  const canZoomOut = zoomLevel > MIN_ZOOM_LEVEL + 0.05;

  useEffect(() => {
    onZoomStateChange?.({ canZoomIn, canZoomOut });
  }, [canZoomIn, canZoomOut, onZoomStateChange]);

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

  useImperativeHandle(
    ref,
    () => ({
      focusCoordinate(lat: number, lon: number, zoom = NOTIFICATION_FOCUS_ZOOM) {
        const clamped = Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, zoom));
        setZoomLevel(clamped);
        cameraRef.current?.setCamera({
          centerCoordinate: [lon, lat],
          zoomLevel: clamped,
          animationDuration: 700,
          animationMode: 'flyTo',
        });
      },
      zoomIn,
      zoomOut,
    }),
    [zoomIn, zoomOut],
  );

  const handleCameraChanged = useCallback((event: { properties?: { zoom?: number } }) => {
    const z = event.properties?.zoom;
    if (typeof z === 'number' && Number.isFinite(z)) {
      setZoomLevel(z);
    }
  }, []);

  // Defer MapView mount until layout is non-zero (avoids zero-size Mapbox init on some devices).
  const handleWrapLayout = useCallback((event: LayoutChangeEvent) => {
    if (mapLayoutReadyRef.current) return;
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      mapLayoutReadyRef.current = true;
      setMapLayoutReady(true);
    }
  }, []);

  useEffect(() => {
    const selectedCoordKey = selected
      ? `${selected.latitude.toFixed(6)}:${selected.longitude.toFixed(6)}`
      : null;
    const didOpen = prevSelectedCoordKeyRef.current == null && selectedCoordKey != null;
    const didClose = prevSelectedCoordKeyRef.current != null && selectedCoordKey == null;
    const didMove =
      prevSelectedCoordKeyRef.current != null &&
      selectedCoordKey != null &&
      prevSelectedCoordKeyRef.current !== selectedCoordKey;
    prevSelectedCoordKeyRef.current = selectedCoordKey;

    if (selected) {
      setAnimatedSelected(selected);
      setAnimatedCallout(selectedCallout);
      setAnimatedPlacement(selectedCalloutPlacement);
      setAnimatedShiftX(selectedCalloutShiftX);
      if (didOpen || didMove) {
        calloutScale.stopAnimation();
        calloutOpacity.stopAnimation();
        calloutScale.setValue(0.92);
        calloutOpacity.setValue(0);
        Animated.parallel([
          Animated.spring(calloutScale, {
            toValue: 1,
            stiffness: 220,
            damping: 16,
            mass: 0.7,
            useNativeDriver: true,
          }),
          Animated.timing(calloutOpacity, {
            toValue: 1,
            duration: 180,
            useNativeDriver: true,
          }),
        ]).start();
      } else {
        calloutScale.setValue(1);
        calloutOpacity.setValue(1);
      }
      return;
    }
    // Close path: keep MarkerView mounted until fade-out finishes (animatedSelected lags selected).
    if (!didClose || !animatedSelected) return;
    calloutScale.stopAnimation();
    calloutOpacity.stopAnimation();
    Animated.parallel([
      Animated.timing(calloutScale, {
        toValue: 0.94,
        duration: 140,
        useNativeDriver: true,
      }),
      Animated.timing(calloutOpacity, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished) return;
      setAnimatedSelected(null);
      setAnimatedCallout(null);
    });
  }, [
    animatedSelected,
    calloutOpacity,
    calloutScale,
    selected,
  ]);

  useEffect(() => {
    if (!selected) return;
    setAnimatedCallout(selectedCallout);
    setAnimatedPlacement(selectedCalloutPlacement);
    setAnimatedShiftX(selectedCalloutShiftX);
  }, [selected, selectedCallout, selectedCalloutPlacement, selectedCalloutShiftX]);

  return (
    <View style={styles.wrap} onLayout={handleWrapLayout}>
      {mapLayoutReady ? (
      <Mapbox.MapView
        style={styles.map}
        styleURL={Mapbox.StyleURL.Street}
        compassEnabled={false}
        logoEnabled={false}
        attributionEnabled={false}
        scaleBarEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        onPress={handleMapPress}
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

        <KrigingHeatmapLayer kriging={kriging} mapRegion={mapRegion} sensors={sensors} />

        <Mapbox.ShapeSource id="sensors" shape={sensorGeoJson} onPress={handleSensorPress} hitbox={{ width: 28, height: 28 }}>
          <Mapbox.CircleLayer
            id="sensor-points"
            style={{
              circleRadius: 7,
              circleColor: ['get', 'color'],
              circleStrokeWidth: 1,
              circleStrokeColor: '#ffffff',
            }}
          />
        </Mapbox.ShapeSource>

        {selectedGeoJson ? (
          <Mapbox.ShapeSource id="selected-point" shape={selectedGeoJson}>
            <Mapbox.CircleLayer
              id="selected-point-layer"
              style={{
                circleRadius: 9,
                circleColor: 'rgba(255,255,255,0)',
                circleStrokeWidth: 3,
                circleStrokeColor: '#0f172a',
              }}
            />
          </Mapbox.ShapeSource>
        ) : null}
        {animatedSelected && animatedCallout ? (
          <Mapbox.MarkerView
            id="selected-callout"
            coordinate={[animatedSelected.longitude, animatedSelected.latitude]}
            anchor={{
              x: calloutLayout.anchorX,
              y: animatedPlacement === 'above' ? 1 : 0,
            }}
          >
            <Animated.View
              style={[
                styles.calloutWrap,
                animatedPlacement === 'above' ? styles.calloutWrapAbove : styles.calloutWrapBelow,
                {
                  opacity: calloutOpacity,
                  transform: [{ scale: calloutScale }],
                },
              ]}
              pointerEvents="box-none"
              onStartShouldSetResponderCapture={() => {
                notifyPanelTouch();
                return false;
              }}
              onMoveShouldSetResponderCapture={() => {
                notifyPanelTouch();
                return false;
              }}
            >
              {animatedPlacement === 'below' ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.calloutArrowUp,
                    styles.calloutArrowPositioned,
                    { left: calloutLayout.arrowLeft },
                  ]}
                />
              ) : null}
              <View
                pointerEvents="auto"
                style={styles.calloutCardShift}
                onStartShouldSetResponderCapture={() => {
                  notifyPanelTouch();
                  return false;
                }}
                onMoveShouldSetResponderCapture={() => {
                  notifyPanelTouch();
                  return false;
                }}
              >
                <View style={styles.calloutCard}>{animatedCallout}</View>
              </View>
              {animatedPlacement === 'above' ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.calloutArrowDown,
                    styles.calloutArrowPositioned,
                    { left: calloutLayout.arrowLeft },
                  ]}
                />
              ) : null}
            </Animated.View>
          </Mapbox.MarkerView>
        ) : null}

        {reminderLocation ? (
          <Mapbox.PointAnnotation
            id="reminder-point-annotation"
            coordinate={[reminderLocation.longitude, reminderLocation.latitude]}
            onSelected={handleReminderPress}
          >
            <Pressable onPress={handleReminderPress} hitSlop={14} style={styles.reminderIconWrap}>
              <ReminderBellIcon />
            </Pressable>
          </Mapbox.PointAnnotation>
        ) : null}
      </Mapbox.MapView>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0, width: '100%', alignSelf: 'stretch', backgroundColor: '#dbeafe' },
  map: { flex: 1 },
  reminderIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  calloutWrap: {
    position: 'relative',
    width: CALLOUT_CARD_WIDTH,
    alignItems: 'stretch',
    overflow: 'visible',
  },
  calloutCardShift: {
    width: CALLOUT_CARD_WIDTH,
  },
  calloutArrowPositioned: {
    position: 'absolute',
    zIndex: 2,
  },
  calloutWrapAbove: {
    marginBottom: 18,
    paddingBottom: 10,
  },
  calloutWrapBelow: {
    marginTop: 18,
    paddingTop: 10,
  },
  calloutCard: {
    width: CALLOUT_CARD_WIDTH,
    borderRadius: 14,
    overflow: 'hidden',
  },
  calloutArrowDown: {
    bottom: 0,
    marginTop: -1,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(255,255,255,0.92)',
  },
  calloutArrowUp: {
    top: 0,
    marginBottom: -1,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'rgba(255,255,255,0.92)',
  },
});
