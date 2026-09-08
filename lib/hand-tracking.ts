import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { detectGestures, InteractionCommand } from "./gestures";

let handLandmarker: HandLandmarker | null = null;
let videoElement: HTMLVideoElement | null = null;
let runningMode: "IMAGE" | "VIDEO" = "VIDEO";
let lastVideoTime = -1;
let isTracking = false;
let animationFrameId: number;

type CommandCallback = (cmd: InteractionCommand | null) => void;
let onCommand: CommandCallback | null = null;

export async function initializeHandTracking(videoEl: HTMLVideoElement, callback: CommandCallback) {
  videoElement = videoEl;
  onCommand = callback;

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
      delegate: "GPU"
    },
    runningMode: runningMode,
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
}

export async function startCamera() {
  if (!videoElement) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" },
    audio: false
  });
  videoElement.srcObject = stream;
  return new Promise<void>((resolve) => {
    videoElement!.onloadedmetadata = () => {
      videoElement!.play();
      resolve();
    };
  });
}

export function startTracking() {
  if (isTracking || !handLandmarker || !videoElement) return;
  isTracking = true;
  predictWebcam();
}

export function stopTracking() {
  isTracking = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
}

async function predictWebcam() {
  if (!isTracking || !videoElement || !handLandmarker) return;

  const startTimeMs = performance.now();
  if (lastVideoTime !== videoElement.currentTime) {
    lastVideoTime = videoElement.currentTime;
    const results = handLandmarker.detectForVideo(videoElement, startTimeMs);
    
    if (results.landmarks) {
      const command = detectGestures(results.landmarks as any);
      if (onCommand) {
        onCommand(command);
      }
    } else if (onCommand) {
        onCommand(null);
    }
  }

  animationFrameId = requestAnimationFrame(predictWebcam);
}
