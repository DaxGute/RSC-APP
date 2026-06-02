/**
 * Mapbox fill layers: PM2.5 kriging as d3 contour polygons colored by EPA breakpoints.
 * Grid matches AqiPanel / computeSsfSelection via resolveHeatmapGridRows + rowsToPm25Grid2D.
 */
import { useMemo } from 'react';
import Mapbox from '@rnmapbox/maps';
import { contours, type ContourMultiPolygon } from 'd3-contour';
import type { FeatureCollection, MultiPolygon } from 'geojson';

import type { CurrentKrigingRow } from '../../lib/database.types';
import { pm25BreakpointCategory } from '../../lib/aqiUtils';
import { PM25_CONTOUR_THRESHOLDS as pm25ContourThresholds } from '../../lib/airQualityBreakpoints';
import {
  gridXYToLonLat,
  pm25GridToContourFlat,
  rowsToPm25Grid2D,
} from '../../lib/modeling/gridMath';
import { resolveHeatmapGridRows } from '../../lib/resolveHeatmapGrid';
import type { MapRegion } from '../../lib/mapRegionFromData';
import type { SensorPoint } from '../../lib/sensorTypes';

/** Kriging grid input; optional gridOverride skips resolveHeatmapGridRows for projection maps. */
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

/** Mapbox fillSortKey: higher draws on top so worse PM2.5 bands stay visible. */
function sortKeyForThreshold(level: number): number {
  for (let i = pm25ContourThresholds.length - 1; i >= 0; i -= 1) {
    if (level >= pm25ContourThresholds[i]) return i + 2;
  }
  return 1;
}

/** Renders EPA-colored PM2.5 contour fills + soft/hard outline layers on a Mapbox map. */
export function KrigingHeatmapLayer({
  kriging = [],
  mapRegion: _mapRegion,
  sensors = [],
  gridOverride,
  opacityScale = 1,
  layerIdPrefix = 'kriging',
}: KrigingHeatmapLayerProps) {
  // Contour in grid index space, then project each ring vertex to lon/lat.
  const binnedGeoJson = useMemo(
    () => {
      const gridRows =
        gridOverride != null && gridOverride.length > 0
          ? gridOverride
          : resolveHeatmapGridRows({ kriging, sensors });
      const validRows = gridRows.filter(
        (r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && Number.isFinite(r.pm25),
      );
      const grid = rowsToPm25Grid2D(validRows);
      if (grid == null) {
        return {
          type: 'FeatureCollection',
          features: [],
        } as FeatureCollection<MultiPolygon, { sortKey: number; color: string; level: number }>;
      }

      const n = grid.lonAsc.length;
      const m = grid.latAsc.length;
      const values = pm25GridToContourFlat(grid);

      const contourGen = contours().size([n, m]).thresholds(pm25ContourThresholds);
      const contourFeatures = contourGen(values);
      const shape: FeatureCollection<MultiPolygon, { sortKey: number; color: string; level: number }> = {
        type: 'FeatureCollection',
        features: [
          ...contourFeatures.map((feature: ContourMultiPolygon, idx: number) => {
            const level = Number(feature.value);
            const color = pm25BreakpointCategory(level).bg.toLowerCase();
            const sortKey = sortKeyForThreshold(level);
            const projected = feature.coordinates.map((poly: number[][][]) =>
              poly.map((ring: number[][]) =>
                ring.map(([x, y]: number[]) => {
                  const { lon, lat } = gridXYToLonLat(x, y, grid);
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
                sortKey,
                color,
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

  // Model projection map uses fixed ids so it does not clash with the main map tab.
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
          fillSortKey: ['get', 'sortKey'],
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
