export type InteractionCommand =
  | { type: "CURSOR"; x: number; y: number; active: boolean }
  | { type: "SELECT"; x: number; y: number }
  | { type: "ROTATE"; dx: number; dy: number; roll: number }
  | { type: "ZOOM"; amount: number }
  | { type: "PAN"; dx: number; dy: number }
  | { type: "RESET" };

interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

function distance(p1: NormalizedLandmark, p2: NormalizedLandmark) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

export function detectGestures(landmarksList: NormalizedLandmark[][]): InteractionCommand | null {
  if (!landmarksList || landmarksList.length === 0) return null;

  const isExtended = (tip: NormalizedLandmark, pip: NormalizedLandmark, wrist: NormalizedLandmark) => {
    return distance(tip, wrist) > distance(pip, wrist) * 1.15;
  };

  const palmSpan = (h: NormalizedLandmark[]) => distance(h[5], h[17]) + distance(h[0], h[9]);

  // --- Two hands: pinch both, then change the gap between them to zoom ---
  if (landmarksList.length >= 2) {
    const a = landmarksList[0];
    const b = landmarksList[1];
    const aPinch = distance(a[4], a[8]) < 0.08;
    const bPinch = distance(b[4], b[8]) < 0.08;

    if (aPinch && bPinch) {
      // Distance between the two pinch points. Wider gap -> zoom in, narrower -> zoom out.
      const ax = (a[4].x + a[8].x) / 2, ay = (a[4].y + a[8].y) / 2;
      const bx = (b[4].x + b[8].x) / 2, by = (b[4].y + b[8].y) / 2;
      return { type: "ZOOM", amount: Math.hypot(ax - bx, ay - by) };
    }
  }

  // Drive single-hand gestures from the hand nearest the camera (largest span),
  // so a flickering second detection cannot swap the reference mid-gesture.
  const landmarks =
    landmarksList.length > 1
      ? [...landmarksList].sort((h1, h2) => palmSpan(h2) - palmSpan(h1))[0]
      : landmarksList[0];
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];

  const middleMCP = landmarks[9];
  const indexPIP = landmarks[6];
  const middlePIP = landmarks[10];
  const ringPIP = landmarks[14];
  const pinkyPIP = landmarks[18];

  const indexExt = isExtended(indexTip, indexPIP, wrist);
  const middleExt = isExtended(middleTip, middlePIP, wrist);
  const ringExt = isExtended(ringTip, ringPIP, wrist);
  const pinkyExt = isExtended(pinkyTip, pinkyPIP, wrist);

  // Pinch (thumb meets a still-pointing index, other fingers down) -> select.
  // Requiring the index to stay extended stops a closed fist reading as a click.
  if (indexExt && !middleExt && !ringExt && !pinkyExt && distance(thumbTip, indexTip) < 0.05) {
    return { type: "SELECT", x: indexTip.x, y: indexTip.y };
  }

  // Index + middle extended -> rotate / pivot. The fingertip-pair position
  // orbits the model; the direction the pair points (its angle in camera
  // space) spins it. Pivot is anchored at the model's feet on the consumer side.
  if (indexExt && middleExt && !ringExt && !pinkyExt) {
    const tipX = (indexTip.x + middleTip.x) / 2;
    const tipY = (indexTip.y + middleTip.y) / 2;
    const roll = Math.atan2(tipY - wrist.y, tipX - wrist.x);
    return { type: "ROTATE", dx: tipX, dy: tipY, roll };
  }

  // Any closed hand (all four fingers curled) -> pan / drag the model.
  if (!indexExt && !middleExt && !ringExt && !pinkyExt) {
    const palmX = (wrist.x + middleMCP.x) / 2;
    const palmY = (wrist.y + middleMCP.y) / 2;
    return { type: "PAN", dx: palmX, dy: palmY };
  }

  // One finger (index) extended -> on-screen cursor.
  if (indexExt && !middleExt && !ringExt && !pinkyExt) {
    return { type: "CURSOR", x: indexTip.x, y: indexTip.y, active: true };
  }

  return null;
}
