import { useMemo } from 'react';
import Mapbox from '@rnmapbox/maps';
import { contours, type ContourMultiPolygon } from 'd3-contour';
import type { FeatureCollection, MultiPolygon } from 'geojson';

import type { CurrentKrigingRow } from '../lib/database.types';
import { PM25_AQI_BOUNDS } from '../lib/pm25ColorScale';
import { resolveHeatmapGridRows } from '../lib/resolveHeatmapGrid';
import type { MapRegion } from '../lib/mapRegionFromData';
import type { SensorPoint } from '../lib/sensorTypes';

type KrigingHeatmapLayerProps = {
  kriging?: CurrentKrigingRow[];
  mapRegion?: MapRegion;
  sensors?: SensorPoint[];
  /** When set with rows, renders this grid directly (no recompute from props). */
  gridOverride?: CurrentKrigingRow[];
  /** Scales fill/line opacity for forecast uncertainty (default 1). */
  opacityScale?: number;
  /** Prefix for Mapbox source/layer ids when multiple maps are mounted. */
  layerIdPrefix?: string;
};

const BIN_COLORS = ['#00e400', '#ffff00', '#ff7e00', '#ff0000', '#8f3f97', '#7e0023', '#4a001a'];
const BIN_CONTOUR_THRESHOLDS = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
const BIN_UPPER_BOUNDS = PM25_AQI_BOUNDS.slice(1);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pm25BinIndex(pm25: number): number {
  for (let i = 0; i < BIN_UPPER_BOUNDS.length; i++) {
    if (pm25 <= BIN_UPPER_BOUNDS[i]) return i;
  }
  return BIN_UPPER_BOUNDS.length;
}

export function KrigingHeatmapLayer({
  kriging = [],
  mapRegion: _mapRegion,
  sensors = [],
  gridOverride,
  opacityScale = 1,
  layerIdPrefix = 'kriging',
}: KrigingHeatmapLayerProps) {
  const binnedGeoJson = useMemo(
    () => {
      const gridRows =
        gridOverride != null && gridOverride.length > 0
          ? gridOverride
          : resolveHeatmapGridRows({ kriging, sensors });
      const validRows = gridRows.filter(
        (r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && Number.isFinite(r.pm25),
      );
      if (validRows.length === 0) {
        return {
          type: 'FeatureCollection',
          features: [],
        } as FeatureCollection<MultiPolygon, { bin: number; color: string; level: number }>;
      }

      const byLat = new Map<number, Map<number, number>>();
      for (const row of validRows) {
        let lonMap = byLat.get(row.latitude);
        if (!lonMap) {
          lonMap = new Map<number, number>();
          byLat.set(row.latitude, lonMap);
        }
        lonMap.set(row.longitude, row.pm25 as number);
      }

      const latAsc = Array.from(byLat.keys()).sort((a, b) => a - b);
      if (latAsc.length < 2) {
        return {
          type: 'FeatureCollection',
          features: [],
        } as FeatureCollection<MultiPolygon, { bin: number; color: string; level: number }>;
      }
      const lonAsc = Array.from(byLat.get(latAsc[0])?.keys() ?? []).sort((a, b) => a - b);
      if (lonAsc.length < 2) {
        return {
          type: 'FeatureCollection',
          features: [],
        } as FeatureCollection<MultiPolygon, { bin: number; color: string; level: number }>;
      }

      const n = lonAsc.length;
      const m = latAsc.length;
      const minLon = lonAsc[0];
      const maxLon = lonAsc[n - 1];
      const minLat = latAsc[0];
      const maxLat = latAsc[m - 1];
      if (!(maxLon > minLon) || !(maxLat > minLat)) {
        return {
          type: 'FeatureCollection',
          features: [],
        } as FeatureCollection<MultiPolygon, { bin: number; color: string; level: number }>;
      }

      const values: number[] = [];
      for (let y = 0; y < m; y++) {
        const lat = latAsc[m - 1 - y];
        const lonMap = byLat.get(lat);
        for (let x = 0; x < n; x++) {
          const lon = lonAsc[x];
          const pm = lonMap?.get(lon);
          values.push(pm == null ? 0 : pm25BinIndex(pm));
        }
      }

      const contourGen = contours().size([n, m]).thresholds(BIN_CONTOUR_THRESHOLDS);
      const contourFeatures = contourGen(values);
      const shape: FeatureCollection<MultiPolygon, { bin: number; color: string; level: number }> = {
        type: 'FeatureCollection',
        features: [
          ...contourFeatures.map((feature: ContourMultiPolygon, idx: number) => {
            const level = Number(feature.value);
            const safeBin = clamp(Math.round(level + 0.5), 1, BIN_COLORS.length - 1);
            const projected = feature.coordinates.map((poly: number[][][]) =>
              poly.map((ring: number[][]) =>
                ring.map(([x, y]: number[]) => {
                  const lon = minLon + (x / (n - 1)) * (maxLon - minLon);
                  const lat = maxLat - (y / (m - 1)) * (maxLat - minLat);
                  return [lon, lat] as [number, number];
                }),
              ),
            );
            return {
              type: 'Feature' as const,
              id: `${layerIdPrefix}-kband-${idx}`,
              geometry: {
                type: 'MultiPolygon' as const,
                coordinates: projected,
              },
              properties: {
                bin: safeBin,
                color: BIN_COLORS[safeBin],
                level,
              },
            };
          }),
        ],
      };
      return shape;
    },
    [gridOverride, kriging, layerIdPrefix, sensors],
  );

  const fillOpacity = 0.3 * opacityScale;
  const lineSoftOpacity = 0.2 * opacityScale;
  const lineOpacity = 0.34 * opacityScale;

  if (binnedGeoJson.features.length === 0) return null;

  const sourceId =
    layerIdPrefix === 'model-projection' ? 'model-projection-source' : `${layerIdPrefix}-heat-source`;
  const fillId =
    layerIdPrefix === 'model-projection' ? 'model-projection-fill-layer' : `${layerIdPrefix}-binned-fill-layer`;
  const lineSoftId =
    layerIdPrefix === 'model-projection'
      ? 'model-projection-line-soft-layer'
      : `${layerIdPrefix}-binned-line-soft-layer`;
  const lineId =
    layerIdPrefix === 'model-projection' ? 'model-projection-line-layer' : `${layerIdPrefix}-binned-line-layer`;

  return (
    <Mapbox.ShapeSource id={sourceId} shape={binnedGeoJson}>
      <Mapbox.FillLayer
        id={fillId}
        style={{
          fillSortKey: ['get', 'bin'],
          fillColor: ['get', 'color'],
          fillOpacity,
          fillAntialias: true,
        }}
      />
      <Mapbox.LineLayer
        id={lineSoftId}
        style={{
          lineColor: ['get', 'color'],
          lineOpacity: lineSoftOpacity,
          lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 1.4, 14, 2.3],
          lineBlur: 1.2,
          lineJoin: 'round',
          lineCap: 'round',
        }}
      />
      <Mapbox.LineLayer
        id={lineId}
        style={{
          lineColor: ['get', 'color'],
          lineOpacity,
          lineWidth: ['interpolate', ['linear'], ['zoom'], 10, 0.35, 14, 0.78],
          lineBlur: 0.25,
          lineJoin: 'round',
          lineCap: 'round',
        }}
      />
    </Mapbox.ShapeSource>
  );
}
