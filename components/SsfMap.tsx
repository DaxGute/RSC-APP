import { useCallback, useMemo, useRef } from 'react';
import Mapbox from '@rnmapbox/maps';
import type { FeatureCollection, Point } from 'geojson';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CurrentKrigingRow } from '../lib/database.types';
import { SSF_BBOX } from '../lib/constants/ssf';
import { pm25BreakpointCategory, pm25ToAqi } from '../lib/aqiUtils';
import type { MapRegion } from '../lib/mapRegionFromData';
import type { SensorPoint } from '../lib/sensorTypes';
import { KrigingHeatmapLayer } from './KrigingHeatmapLayer';

export type MapSelectDetail = {
  touchInBottomBand: boolean;
  sensorIndex?: number;
  sensorSource?: string;
  sensorName?: string | null;
};

export type SsfMapProps = {
  sensors: SensorPoint[];
  kriging: CurrentKrigingRow[];
  mapRegion: MapRegion;
  selected: { latitude: number; longitude: number } | null;
  /** Saved reminder pin (same coords as global reminder in the panel). */
  reminderLocation?: { latitude: number; longitude: number } | null;
  onSelectCoordinate: (lat: number, lon: number, detail: MapSelectDetail) => void;
};

const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
if (mapboxToken) {
  Mapbox.setAccessToken(mapboxToken);
}

const DEFAULT_ZOOM_LEVEL = 12;
const MIN_ZOOM_FACTOR = 0.5;
const MAX_ZOOM_FACTOR = 3;
const MIN_ZOOM_LEVEL = DEFAULT_ZOOM_LEVEL * MIN_ZOOM_FACTOR;
const MAX_ZOOM_LEVEL = DEFAULT_ZOOM_LEVEL * MAX_ZOOM_FACTOR;

export function SsfMap({
  sensors,
  kriging,
  mapRegion,
  selected,
  reminderLocation = null,
  onSelectCoordinate,
}: SsfMapProps) {
  const wrapRef = useRef<View>(null);
  const lastSensorTapMsRef = useRef(0);

  const sensorGeoJson = useMemo(() => {
    const shape: FeatureCollection<
      Point,
      { sensor_index: number; source: string; name: string | null; pm25: number; aqi: number; color: string }
    > = {
      type: 'FeatureCollection',
      features: sensors.map((s) => ({
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
  }, [sensors]);

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
      pageY: number | null,
      sensorDetail?: { sensorIndex?: number; sensorSource?: string; sensorName?: string | null },
    ) => {
      const finish = (touchInBottomBand: boolean) => {
        onSelectCoordinate(lat, lon, { touchInBottomBand, ...sensorDetail });
      };

      const wrap = wrapRef.current;
      if (wrap == null || typeof wrap.measureInWindow !== 'function') {
        finish(false);
        return;
      }

      wrap.measureInWindow((_x, y, _w, h) => {
        finish(pageY != null && h > 0 && pageY >= y + h * 0.8);
      });
    },
    [onSelectCoordinate],
  );

  const handleMapPress = useCallback(
    (event: any) => {
      // Prevent the immediate map click after a sensor click from overriding sensor selection.
      if (Date.now() - lastSensorTapMsRef.current < 250) return;
      const coords = event?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return;
      const [lon, lat] = coords;
      const maybePageY = (event?.properties as { screenPointY?: number } | undefined)?.screenPointY ?? null;
      handlePress(lat, lon, maybePageY);
    },
    [handlePress],
  );

  const handleSensorPress = useCallback(
    (event: any) => {
      const feature = event.features?.[0];
      const coords = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
      if (!coords || coords.length < 2) return;
      const [lon, lat] = coords;
      const rawSensorIndex = feature?.properties?.sensor_index;
      const sensorIndex =
        typeof rawSensorIndex === 'number'
          ? rawSensorIndex
          : typeof rawSensorIndex === 'string'
            ? Number.parseInt(rawSensorIndex, 10)
            : undefined;
      const sensorSource =
        typeof feature?.properties?.source === 'string' ? feature.properties.source : undefined;
      const sensorName =
        typeof feature?.properties?.name === 'string' ? feature.properties.name : null;
      const maybePageY =
        (event as unknown as { properties?: { screenPointY?: number } }).properties?.screenPointY ?? null;
      lastSensorTapMsRef.current = Date.now();
      handlePress(lat, lon, maybePageY, {
        sensorIndex: Number.isFinite(sensorIndex) ? sensorIndex : undefined,
        sensorSource,
        sensorName,
      });
    },
    [handlePress],
  );

  const handleReminderPress = useCallback(() => {
    if (!reminderLocation) return;
    handlePress(reminderLocation.latitude, reminderLocation.longitude, null);
  }, [handlePress, reminderLocation]);

  return (
    <View ref={wrapRef} style={styles.wrap}>
      <Mapbox.MapView
        style={styles.map}
        styleURL={Mapbox.StyleURL.Street}
        compassEnabled={false}
        logoEnabled={false}
        attributionEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        onPress={handleMapPress}
      >
        <Mapbox.Camera
          zoomLevel={DEFAULT_ZOOM_LEVEL}
          centerCoordinate={[mapRegion.longitude, mapRegion.latitude]}
          maxBounds={{
            ne: [SSF_BBOX.seLon, SSF_BBOX.nwLat],
            sw: [SSF_BBOX.nwLon, SSF_BBOX.seLat],
          }}
          minZoomLevel={MIN_ZOOM_LEVEL}
          maxZoomLevel={MAX_ZOOM_LEVEL}
        />

        <KrigingHeatmapLayer kriging={kriging} mapRegion={mapRegion} sensors={sensors} />

        <Mapbox.ShapeSource id="sensors" shape={sensorGeoJson} onPress={handleSensorPress}>
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

        {reminderLocation ? (
          <Mapbox.PointAnnotation
            id="reminder-point-annotation"
            coordinate={[reminderLocation.longitude, reminderLocation.latitude]}
            onSelected={handleReminderPress}
          >
            <Pressable onPress={handleReminderPress} hitSlop={14} style={styles.reminderIconWrap}>
              <Text style={styles.reminderIcon}>🔔</Text>
            </Pressable>
          </Mapbox.PointAnnotation>
        ) : null}
      </Mapbox.MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, minHeight: 0, width: '100%', alignSelf: 'stretch', backgroundColor: '#dbeafe' },
  map: { flex: 1 },
  reminderIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  reminderIcon: {
    fontSize: 24,
    lineHeight: 26,
    textShadowColor: 'rgba(15, 23, 42, 0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
