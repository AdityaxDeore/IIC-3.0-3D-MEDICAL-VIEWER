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

  if (landmarksList.length === 2) {
    const hand1 = landmarksList[0];
    const hand2 = landmarksList[1];
    const d = distance(hand1[8], hand2[8]); // distance between index tips
    return { type: "ZOOM", amount: d };
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

  const isExtended = (tip: NormalizedLandmark, pip: NormalizedLandmark) => {
    return distance(tip, wrist) > distance(pip, wrist);
  };

  const indexExt = isExtended(indexTip, indexPIP);
  const middleExt = isExtended(middleTip, middlePIP);
  const ringExt = isExtended(ringTip, ringPIP);
  const pinkyExt = isExtended(pinkyTip, pinkyPIP);

  const pinchDist = distance(thumbTip, indexTip);
  const isPinching = pinchDist < 0.05 && indexExt;

  if (isPinching) {
    return { type: "SELECT", x: indexTip.x, y: indexTip.y };
  }

  if (indexExt && !middleExt && !ringExt && !pinkyExt) {
    return { type: "CURSOR", x: indexTip.x, y: indexTip.y, active: true };
  }

  if (indexExt && middleExt && ringExt && pinkyExt) {
    return { type: "ROTATE", dx: wrist.x, dy: wrist.y };
  }

  return null;
}
