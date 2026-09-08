export type InteractionCommand =
  | { type: "CURSOR"; x: number; y: number; active: boolean }
  | { type: "SELECT"; x: number; y: number }
  | { type: "ROTATE"; dx: number; dy: number }
  | { type: "TWO_HAND_PINCH"; x1: number; y1: number; z1: number; x2: number; y2: number; z2: number }
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
    return distance(tip, wrist) > distance(pip, wrist);
  };

  if (landmarksList.length >= 2) {
    const hand1 = landmarksList[0];
    const hand2 = landmarksList[1];
    
    // Check if both hands are pinching
    const h1Pinch = distance(hand1[4], hand1[8]) < 0.05;
    const h2Pinch = distance(hand2[4], hand2[8]) < 0.05;

    if (h1Pinch && h2Pinch) {
      return { 
        type: "TWO_HAND_PINCH", 
        x1: hand1[8].x, y1: hand1[8].y, z1: hand1[8].z,
        x2: hand2[8].x, y2: hand2[8].y, z2: hand2[8].z
      };
    }
  }

  const landmarks = landmarksList[0];
  const wrist = landmarks[0];
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const ringTip = landmarks[16];
  const pinkyTip = landmarks[20];

  const indexPIP = landmarks[6];
  const middlePIP = landmarks[10];
  const ringPIP = landmarks[14];
  const pinkyPIP = landmarks[18];

  const indexExt = isExtended(indexTip, indexPIP, wrist);
  const middleExt = isExtended(middleTip, middlePIP, wrist);
  const ringExt = isExtended(ringTip, ringPIP, wrist);
  const pinkyExt = isExtended(pinkyTip, pinkyPIP, wrist);

  const pinchDist = distance(thumbTip, indexTip);
  const isPinching = pinchDist < 0.05 && !middleExt && !ringExt && !pinkyExt;

  if (isPinching) {
    return { type: "SELECT", x: indexTip.x, y: indexTip.y };
  }

  // Two fingers (Index + Middle) extended for ROTATE (acting like mouse button pressed)
  if (indexExt && middleExt && !ringExt && !pinkyExt) {
    return { type: "ROTATE", dx: indexTip.x, dy: indexTip.y };
  }

  // One finger (Index) extended for CURSOR (acting like normal mouse move)
  if (indexExt && !middleExt && !ringExt && !pinkyExt) {
    return { type: "CURSOR", x: indexTip.x, y: indexTip.y, active: true };
  }

  // Cylindrical / Fist (all curled) for PAN (or other action if desired, but user didn't specify. I'll map to PAN for completeness)
  if (!indexExt && !middleExt && !ringExt && !pinkyExt) {
    return { type: "PAN", dx: wrist.x, dy: wrist.y };
  }

  return null;
}
