export type InteractionCommand =
  | { type: "CURSOR"; x: number; y: number; active: boolean }
  | { type: "SELECT"; x: number; y: number }
  | { type: "ROTATE"; dx: number; dy: number }
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
    return distance(tip, wrist) > distance(pip, wrist);
  };

  if (landmarksList.length >= 2) {
    const hand1 = landmarksList[0];
    const hand2 = landmarksList[1];
    
    // Check if both hands are pinching
    const h1Pinch = distance(hand1[4], hand1[8]) < 0.05;
    const h2Pinch = distance(hand2[4], hand2[8]) < 0.05;

    if (h1Pinch && h2Pinch) {
      // Zoom amount based on distance between the two hands' index fingers
      const d = distance(hand1[8], hand2[8]);
      return { type: "ZOOM", amount: d };
    }

    // Check if both hands are fists (all fingers curled except thumb which doesn't matter much)
    const h1Fist = !isExtended(hand1[8], hand1[6], hand1[0]) && !isExtended(hand1[12], hand1[10], hand1[0]) && !isExtended(hand1[16], hand1[14], hand1[0]) && !isExtended(hand1[20], hand1[18], hand1[0]);
    const h2Fist = !isExtended(hand2[8], hand2[6], hand2[0]) && !isExtended(hand2[12], hand2[10], hand2[0]) && !isExtended(hand2[16], hand2[14], hand2[0]) && !isExtended(hand2[20], hand2[18], hand2[0]);
    if (h1Fist && h2Fist) {
      // Return ROTATE command. Use hand1's index knuckle for dragging coordinates
      return { type: "ROTATE", dx: hand1[6].x, dy: hand1[6].y };
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

  // Cylindrical / Fist (all curled) for PAN
  if (!indexExt && !middleExt && !ringExt && !pinkyExt) {
    return { type: "PAN", dx: indexPIP.x, dy: indexPIP.y };
  }

  return null;
}
