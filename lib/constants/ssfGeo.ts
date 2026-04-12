import { SSF_BBOX } from './ssf';
import type { GeoBounds } from '../geoPixel';

/** SSF bbox in min/max form (matches static map asset covering this area). */
export const SSF_GEO_BOUNDS: GeoBounds = {
  minLat: SSF_BBOX.seLat,
  maxLat: SSF_BBOX.nwLat,
  minLon: SSF_BBOX.nwLon,
  maxLon: SSF_BBOX.seLon,
};
