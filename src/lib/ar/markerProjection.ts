// Where a point on the ground appears on the camera view, from the compass, the phone's tilt and the distance.
// The browser can't track the phone through the camera, so this is what places the AR marker.

// Rear cameras on phones cover roughly this much side to side; tuned on a real phone
export const AR_CAMERA_HFOV_DEG = 65;
// The grave is on the ground, about this far below the phone
export const AR_EYE_HEIGHT_M = 1.5;

export interface ProjectionInput {
  // Bearing to the target minus the phone heading, -180 to 180
  bearingDiffDeg: number;
  // Camera pitch, positive when it points above the horizon
  pitchDeg: number;
  distanceM: number;
  viewportWidth: number;
  viewportHeight: number;
  hFovDeg?: number;
  eyeHeightM?: number;
}

export interface MarkerProjection {
  x: number;
  y: number;
  // Marker size relative to its natural size
  scale: number;
  onScreen: boolean;
  // Direction from the screen centre to the target in screen degrees: 0 right, 90 down, -90 up, 180 left
  edgeAngleDeg: number;
  // Screen pixels per metre on the ground at the target's distance
  pxPerMeter: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function projectGroundTarget(input: ProjectionInput): MarkerProjection {
  const hFov = input.hFovDeg ?? AR_CAMERA_HFOV_DEG;
  const eyeHeight = input.eyeHeightM ?? AR_EYE_HEIGHT_M;
  const halfWidth = input.viewportWidth / 2;
  const halfHeight = input.viewportHeight / 2;
  const tanHalfH = Math.tan(toRad(hFov / 2));
  const tanHalfV = tanHalfH * (input.viewportHeight / input.viewportWidth);
  const distance = Math.max(0.5, input.distanceM);

  // Angle from the view centre down to the target: the camera's tilt plus the drop to the ground
  const depression = Math.atan2(eyeHeight, distance);
  const vertical = toRad(input.pitchDeg) + depression;
  const inFront = Math.abs(input.bearingDiffDeg) < 89 && Math.abs(toDeg(vertical)) < 89;

  // Beyond the camera's half-plane the tangent flips sign, so pin those far off the matching edge instead
  const xNorm = inFront ? Math.tan(toRad(input.bearingDiffDeg)) / tanHalfH : Math.sign(input.bearingDiffDeg || 1) * 2;
  const yNorm = inFront ? Math.tan(vertical) / tanHalfV : 2;
  const onScreen = inFront && Math.abs(xNorm) <= 1 && Math.abs(yNorm) <= 1;

  return {
    x: halfWidth + xNorm * halfWidth,
    y: halfHeight + yNorm * halfHeight,
    scale: clamp(8 / Math.max(1, input.distanceM), 0.5, 1.6),
    onScreen,
    edgeAngleDeg: toDeg(Math.atan2(yNorm, xNorm)),
    pxPerMeter: halfWidth / (tanHalfH * distance),
  };
}
