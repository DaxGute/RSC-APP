/** Animated wind arrows on ModelProjectionMap; burst pulses along mean downwind direction. */
import { useEffect, useMemo, useState } from 'react';
import Mapbox from '@rnmapbox/maps';
import type { FeatureCollection, Point } from 'geojson';

import { windAdvectionAngleDeg, type WindGridPoint } from '../../../lib/map/projection/forecastWindGrid';

/** Forecast wind grid slice for one projection step; rendered as Mapbox symbol layer. */
type WindArrowLayerProps = {
  points: WindGridPoint[];
  visible: boolean;
  layerIdPrefix?: string;
};

type WindArrowProps = {
  angleDeg: number;
  opacity: number;
  finalTextSize: number;
};

const TICK_INTERVAL_MS = 50;
/** Full animation cycle (burst + wait). */
const CYCLE_TICKS = 90;
/** Ticks for one downwind pulse; remainder of cycle is quiet. */
const BURST_TICKS = 70;
const WAVE_PROJECTION_SCALE = 100;
/** Gaussian half-width along the burst path (projection units). */
const PULSE_WIDTH = 1.2;
const WAVE_BASE = 0.1;
const WAVE_OPACITY_MIN = 0.1;
const WAVE_OPACITY_SWING = 0.9;
const WAVE_SIZE_SWING = 0.5;

/**
 * One traveling pulse during burst, then baseline until the next cycle.
 * @param burstT 0..1 progress through the burst window
 */
function burstWaveAtProjection(
  projection: number,
  burstT: number,
  travelMin: number,
  travelSpan: number,
): number {
  const envelope = Math.sin(burstT * Math.PI);
  const travelPhase = travelMin - PULSE_WIDTH + burstT * (travelSpan + 2 * PULSE_WIDTH);
  const dist = projection - travelPhase;
  const pulse = Math.exp(-0.5 * (dist / PULSE_WIDTH) ** 2);
  return WAVE_BASE + (1 - WAVE_BASE) * pulse * envelope;
}

type MeanWindField = {
  avgU: number;
  avgV: number;
  /** Unit vector: direction air moves (east, north). */
  flowEast: number;
  flowNorth: number;
};

/** Arithmetic mean of u/v over every valid grid point (true vector average). */
function computeMeanWindField(points: WindGridPoint[]): MeanWindField {
  let sumU = 0;
  let sumV = 0;
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    sumU += points[i].uMs;
    sumV += points[i].vMs;
  }
  const avgU = sumU / n;
  const avgV = sumV / n;
  const mag = Math.hypot(avgU, avgV);
  if (mag < 1e-6) {
    return { avgU: 0, avgV: 0, flowEast: 0, flowNorth: 1 };
  }
  return { avgU, avgV, flowEast: avgU / mag, flowNorth: avgV / mag };
}

/** Centroid for projecting each arrow onto the mean downwind axis (burst travel line). */
function computeGridCentroid(points: WindGridPoint[]): { lon: number; lat: number } {
  let sumLon = 0;
  let sumLat = 0;
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    sumLon += points[i].lon;
    sumLat += points[i].lat;
  }
  return { lon: sumLon / n, lat: sumLat / n };
}

/** Piecewise scale: arrow glyph size grows with wind speed (m/s). */
function baseSizeFromSpeed(speedMps: number): number {
  const s = Math.max(0, speedMps);
  if (s <= 2) return 10 + (s / 2) * 4;
  if (s <= 5) return 14 + ((s - 2) / 3) * 6;
  if (s <= 10) return 20 + ((s - 5) / 5) * 6;
  return 26;
}

/** Mapbox SymbolLayer of ↑ glyphs; opacity/size pulse along mean flow during burst window. */
export function WindArrowLayer({
  points,
  visible,
  layerIdPrefix = 'wind',
}: WindArrowLayerProps) {
  const sourceId = `${layerIdPrefix}-wind-arrows`;
  const layerId = `${layerIdPrefix}-wind-arrows-layer`;

  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!visible || points.length === 0) return;
    const id = setInterval(() => {
      setTick((t) => (t + 1) % CYCLE_TICKS);
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [visible, points.length]);

  /** Rebuild GeoJSON each tick so burst wave opacity/size animate on the map. */
  const geoJson = useMemo(() => {
    const validPoints = points.filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lon) &&
        Number.isFinite(p.uMs) &&
        Number.isFinite(p.vMs),
    );

    if (validPoints.length === 0) {
      return {
        type: 'FeatureCollection',
        features: [],
      } as FeatureCollection<Point, WindArrowProps>;
    }

    const { flowEast, flowNorth } = computeMeanWindField(validPoints);
    const centroid = computeGridCentroid(validPoints);
    const cosLat = Math.cos((centroid.lat * Math.PI) / 180);

    const tickInCycle = tick % CYCLE_TICKS;
    const inBurst = tickInCycle < BURST_TICKS;
    const burstT = inBurst ? tickInCycle / BURST_TICKS : 0;

    const projected = validPoints.map((p) => {
      const east = (p.lon - centroid.lon) * cosLat;
      const north = p.lat - centroid.lat;
      return (east * flowEast + north * flowNorth) * WAVE_PROJECTION_SCALE;
    });
    const travelMin = Math.min(...projected);
    const travelMax = Math.max(...projected);
    const travelSpan = Math.max(travelMax - travelMin, 1);

    const features = validPoints.map((p, i) => {
      const wave = inBurst
        ? burstWaveAtProjection(projected[i], burstT, travelMin, travelSpan)
        : WAVE_BASE;
      const baseSize = baseSizeFromSpeed(p.windSpeedMps);

      return {
        type: 'Feature' as const,
        id: `wind-arrow-${p.lat.toFixed(6)}-${p.lon.toFixed(6)}`,
        geometry: {
          type: 'Point' as const,
          coordinates: [p.lon, p.lat],
        },
        properties: {
          angleDeg: windAdvectionAngleDeg(p.uMs, p.vMs),
          opacity: visible ? WAVE_OPACITY_MIN + WAVE_OPACITY_SWING * wave : 0,
          finalTextSize: baseSize * (1 + WAVE_SIZE_SWING * wave),
        } satisfies WindArrowProps,
      };
    });

    return {
      type: 'FeatureCollection',
      features,
    } as FeatureCollection<Point, WindArrowProps>;
  }, [points, tick, visible]);

  if (!visible || geoJson.features.length === 0) return null;

  return (
    <Mapbox.ShapeSource id={sourceId} shape={geoJson} hitbox={{ width: 0, height: 0 }}>
      <Mapbox.SymbolLayer
        id={layerId}
        style={{
          textField: '↑',
          textRotate: ['get', 'angleDeg'],
          textSize: ['get', 'finalTextSize'],
          textOpacity: ['get', 'opacity'],
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
