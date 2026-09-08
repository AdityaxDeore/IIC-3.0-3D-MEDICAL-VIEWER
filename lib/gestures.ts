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

  const landmarks = landmarksList[0];
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];

  const indexMCP = landmarks[5];
  const middleMCP = landmarks[9];
  const pinkyMCP = landmarks[17];
  const indexPIP = landmarks[6];
  const middlePIP = landmarks[10];
  const ringPIP = landmarks[14];
  const pinkyPIP = landmarks[18];

  const indexExt = isExtended(indexTip, indexPIP, wrist);
  const middleExt = isExtended(middleTip, middlePIP, wrist);
  const ringExt = isExtended(ringTip, ringPIP, wrist);
  const pinkyExt = isExtended(pinkyTip, pinkyPIP, wrist);

  const pinchDist = distance(thumbTip, indexTip);

  // Pinch (thumb + index together, other fingers down) -> select. Checked first.
  if (pinchDist < 0.05 && !middleExt && !ringExt && !pinkyExt) {
    return { type: "SELECT", x: indexTip.x, y: indexTip.y };
  }

  // Cylindrical grip (all four fingers curled round an imaginary cylinder,
  // thumb not touching the index) -> rotate / pivot about the model's feet.
  // Move the gripped hand to orbit; twist the wrist to spin.
  if (!indexExt && !middleExt && !ringExt && !pinkyExt && pinchDist > 0.08) {
    const palmX = (wrist.x + middleMCP.x) / 2;
    const palmY = (wrist.y + middleMCP.y) / 2;
    const roll = Math.atan2(pinkyMCP.y - indexMCP.y, pinkyMCP.x - indexMCP.x);
    return { type: "ROTATE", dx: palmX, dy: palmY, roll };
  }

  // One finger (index) extended -> on-screen cursor.
  if (indexExt && !middleExt && !ringExt && !pinkyExt) {
    return { type: "CURSOR", x: indexTip.x, y: indexTip.y, active: true };
  }

  return null;
}
