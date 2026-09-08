import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";
import { detectGestures, InteractionCommand } from "./gestures";

let handLandmarker: HandLandmarker | null = null;
let videoElement: HTMLVideoElement | null = null;
let canvasElement: HTMLCanvasElement | null = null;
let canvasCtx: CanvasRenderingContext2D | null = null;
let runningMode: "IMAGE" | "VIDEO" = "VIDEO";
let lastVideoTime = -1;
let isTracking = false;
let animationFrameId: number;

type CommandCallback = (cmd: InteractionCommand | null) => void;
let onCommand: CommandCallback | null = null;

const HAND_CONNECTIONS = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index
  [5, 6], [6, 7], [7, 8],
  // Middle
  [9, 10], [10, 11], [11, 12],
  // Ring
  [13, 14], [14, 15], [15, 16],
  // Pinky
  [17, 18], [18, 19], [19, 20],
  // Palm Base
  [0, 5], [5, 9], [9, 13], [13, 17], [0, 17]
];

export async function initializeHandTracking(videoEl: HTMLVideoElement, canvasEl: HTMLCanvasElement, callback: CommandCallback) {
  videoElement = videoEl;
  canvasElement = canvasEl;
  canvasCtx = canvasEl.getContext("2d");
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
    minHandDetectionConfidence: 0.7,
    minHandPresenceConfidence: 0.7,
    minTrackingConfidence: 0.8
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
      if (canvasElement) {
        canvasElement.width = videoElement!.videoWidth;
        canvasElement.height = videoElement!.videoHeight;
      }
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

function distance(p1: any, p2: any) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function drawExoskeleton(landmarksList: any[]) {
  if (!canvasCtx || !canvasElement) return;
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  
  for (const landmarks of landmarksList) {
    // Draw bones
    canvasCtx.strokeStyle = "#00aaff"; // Blue color
    canvasCtx.lineCap = "round";
    canvasCtx.lineJoin = "round";
    canvasCtx.lineWidth = 4;
    for (const [start, end] of HAND_CONNECTIONS) {
      const p1 = landmarks[start];
      const p2 = landmarks[end];
      canvasCtx.beginPath();
      canvasCtx.moveTo(p1.x * canvasElement.width, p1.y * canvasElement.height);
      canvasCtx.lineTo(p2.x * canvasElement.width, p2.y * canvasElement.height);
      canvasCtx.stroke();
    }
    // Draw joints
    canvasCtx.fillStyle = "#ffffff";
    for (const point of landmarks) {
      canvasCtx.beginPath();
      canvasCtx.arc(point.x * canvasElement.width, point.y * canvasElement.height, 3, 0, 2 * Math.PI);
      canvasCtx.fill();
    }
  // Removed the red/pink dashed line logic
}

async function predictWebcam() {
  if (!isTracking || !videoElement || !handLandmarker) return;

  const startTimeMs = performance.now();
  if (lastVideoTime !== videoElement.currentTime) {
    lastVideoTime = videoElement.currentTime;
    const results = handLandmarker.detectForVideo(videoElement, startTimeMs);
    
    if (results.landmarks) {
      drawExoskeleton(results.landmarks);
      const command = detectGestures(results.landmarks as any);
      if (onCommand) {
        onCommand(command);
      }
    } else {
      if (canvasCtx && canvasElement) {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
      }
      if (onCommand) {
        onCommand(null);
      }
    }
  }

  animationFrameId = requestAnimationFrame(predictWebcam);
}
