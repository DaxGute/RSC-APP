import { useMemo } from 'react';
import Mapbox from '@rnmapbox/maps';
import type { FeatureCollection, Point } from 'geojson';

import { windAdvectionAngleDeg, type WindGridPoint } from '../lib/forecastWindGrid';

type WindArrowLayerProps = {
  points: WindGridPoint[];
  visible: boolean;
};

type WindArrowProps = {
  speed: number;
  angleDeg: number;
};

export function WindArrowLayer({ points, visible }: WindArrowLayerProps) {
  const geoJson = useMemo(() => {
    const features = points
      .filter(
        (p) =>
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lon) &&
          Number.isFinite(p.uMs) &&
          Number.isFinite(p.vMs),
      )
      .map((p, idx) => ({
        type: 'Feature' as const,
        id: `wind-arrow-${idx}`,
        geometry: {
          type: 'Point' as const,
          coordinates: [p.lon, p.lat],
        },
        properties: {
          speed: Math.max(0, p.windSpeedMps),
          angleDeg: windAdvectionAngleDeg(p.uMs, p.vMs),
        } satisfies WindArrowProps,
      }));

    return {
      type: 'FeatureCollection',
      features,
    } as FeatureCollection<Point, WindArrowProps>;
  }, [points]);

  if (!visible || geoJson.features.length === 0) return null;

  return (
    <Mapbox.ShapeSource id="wind-arrows" shape={geoJson} hitbox={{ width: 0, height: 0 }}>
      <Mapbox.SymbolLayer
        id="wind-arrows-layer"
        style={{
          textField: '↑',
          textSize: [
            'interpolate',
            ['linear'],
            ['get', 'speed'],
            0,
            18,
            3,
            20,
            8,
            24,
            14,
            28,
          ],
          textRotate: ['get', 'angleDeg'],
          textOpacity: [
            'interpolate',
            ['linear'],
            ['get', 'speed'],
            0,
            0.78,
            2,
            0.86,
            6,
            0.92,
            12,
            0.96,
          ],
          textColor: '#0f172a',
          textHaloColor: 'rgba(255,255,255,0.95)',
          textHaloWidth: 2,
          textAllowOverlap: true,
          textIgnorePlacement: true,
          textPitchAlignment: 'map',
          textRotationAlignment: 'map',
          textAnchor: 'center',
        }}
      />
    </Mapbox.ShapeSource>
  );
}
