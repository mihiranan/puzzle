export type Camera = {
  lon: number;
  lat: number;
  zoom: number;
};

export const INITIAL_CAMERA: Camera = {
  lon: 6,
  lat: 10,
  zoom: 2.58,
};

export function pixelsPerDegree(zoom: number): number {
  return (256 * 2 ** zoom) / 360;
}

export function project(
  lon: number,
  lat: number,
  camera: Camera,
  width: number,
  height: number,
): { x: number; y: number } {
  const scale = pixelsPerDegree(camera.zoom);
  return {
    x: (lon - camera.lon) * scale + width / 2,
    y: (camera.lat - lat) * scale + height / 2,
  };
}

export function unproject(
  x: number,
  y: number,
  camera: Camera,
  width: number,
  height: number,
): { lon: number; lat: number } {
  const scale = pixelsPerDegree(camera.zoom);
  return {
    lon: camera.lon + (x - width / 2) / scale,
    lat: camera.lat - (y - height / 2) / scale,
  };
}

export function clampCamera(camera: Camera): Camera {
  return {
    lon: Math.max(-170, Math.min(170, camera.lon)),
    lat: Math.max(-70, Math.min(75, camera.lat)),
    zoom: Math.max(1, Math.min(14, camera.zoom)),
  };
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
