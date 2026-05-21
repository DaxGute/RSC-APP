import type { CurrentKrigingRow } from './database.types';
import { recomputeKrigingFromSensors } from './recomputeKriging';
import type { SensorPoint } from './sensorTypes';

export const HEATMAP_GRID_STEPS = 40;
export const EXPECTED_GRID_CELLS = HEATMAP_GRID_STEPS * HEATMAP_GRID_STEPS;

export type ResolveHeatmapGridInput = {
  kriging: CurrentKrigingRow[];
  sensors: SensorPoint[];
};

/**
 * Same grid resolution and source priority as `KrigingHeatmapLayer` on the main map.
 */
export function resolveHeatmapGridRows({
  kriging,
  sensors,
}: ResolveHeatmapGridInput): CurrentKrigingRow[] {
  const time = sensors[0]?.time ?? new Date().toISOString();
  const recomputed =
    sensors.length > 0
      ? recomputeKrigingFromSensors(sensors, time, {
          latSteps: HEATMAP_GRID_STEPS,
          lonSteps: HEATMAP_GRID_STEPS,
        })
      : [];
  return recomputed.length >= EXPECTED_GRID_CELLS
    ? recomputed.slice(0, EXPECTED_GRID_CELLS)
    : kriging;
}
