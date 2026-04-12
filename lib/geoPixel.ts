/**
 * Linear equirectangular mapping from lat/lon to pixel coordinates.
 * Image is assumed to cover `bounds` exactly when stretched to width×height (contentFit fill).
 */

export type GeoBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

export function latLonToPixel(
  lat: number,
  lon: number,
  bounds: GeoBounds,
  width: number,
  height: number,
): { x: number; y: number } {
  const dLon = bounds.maxLon - bounds.minLon;
  const dLat = bounds.maxLat - bounds.minLat;
  if (!(dLon > 0) || !(dLat > 0) || !(width > 0) || !(height > 0)) {
    return { x: width / 2, y: height / 2 };
  }
  const x = ((lon - bounds.minLon) / dLon) * width;
  const y = ((bounds.maxLat - lat) / dLat) * height;
  return { x, y };
}

export function pixelToLatLon(
  px: number,
  py: number,
  bounds: GeoBounds,
  width: number,
  height: number,
): { lat: number; lon: number } {
  const dLon = bounds.maxLon - bounds.minLon;
  const dLat = bounds.maxLat - bounds.minLat;
  if (!(width > 0) || !(height > 0)) {
    return { lat: (bounds.minLat + bounds.maxLat) / 2, lon: (bounds.minLon + bounds.maxLon) / 2 };
  }
  const lon = bounds.minLon + (px / width) * dLon;
  const lat = bounds.maxLat - (py / height) * dLat;
  return { lat, lon };
}
