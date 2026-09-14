import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/dist/vision_bundle.mjs";

let cursor = document.createElement('div');
cursor.style.position = 'fixed';
cursor.style.width = '12px';
cursor.style.height = '12px';
cursor.style.borderRadius = '50%';
cursor.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
cursor.style.pointerEvents = 'none';
cursor.style.zIndex = '999999';
cursor.style.transition = 'background-color 0.1s, transform 0.1s';
cursor.style.display = 'none';
document.body.appendChild(cursor);

let video = document.createElement('video');
video.style.display = 'none';
video.autoplay = true;
video.playsInline = true;
document.body.appendChild(video);

let handLandmarker;
let lastVideoTime = -1;
let lastX = window.innerWidth / 2;
let lastY = window.innerHeight / 2;

function detectPinch(landmarks) {
  const thumbTip = landmarks[4];
  const indexTip = landmarks[8];
  const dist = Math.sqrt(Math.pow(thumbTip.x - indexTip.x, 2) + Math.pow(thumbTip.y - indexTip.y, 2) + Math.pow(thumbTip.z - indexTip.z, 2));
  return dist < 0.05;
}

async function init() {
  const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  handLandmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 1
  });

  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
  video.srcObject = stream;
  video.onloadeddata = () => {
    video.play();
    requestAnimationFrame(predict);
  };
}

let wasPinching = false;

function predict() {
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = handLandmarker.detectForVideo(video, performance.now());
    
    if (result.landmarks && result.landmarks.length > 0) {
      const landmarks = result.landmarks[0];
      const indexTip = landmarks[8];
      
      // Mirror the X coordinate for webcam
      const targetX = (1 - indexTip.x) * window.innerWidth;
      const targetY = indexTip.y * window.innerHeight;
      
      // Smoothing
      lastX = lastX * 0.35 + targetX * 0.65;
      lastY = lastY * 0.35 + targetY * 0.65;
      
      cursor.style.display = 'block';
      cursor.style.left = `${lastX - 6}px`;
      cursor.style.top = `${lastY - 6}px`;

      const isPinching = detectPinch(landmarks);
      
      cursor.style.backgroundColor = isPinching ? 'rgba(0, 150, 255, 0.9)' : 'rgba(255, 0, 0, 0.7)';
      cursor.style.transform = isPinching ? 'scale(1.3)' : 'scale(1)';

      const target = document.elementFromPoint(lastX, lastY) || document.body;
      
      const origSet = target.setPointerCapture;
      if(origSet) target.setPointerCapture = function(id) { try { origSet.call(this, id); } catch(e) {} };
      const origRel = target.releasePointerCapture;
      if(origRel) target.releasePointerCapture = function(id) { try { origRel.call(this, id); } catch(e) {} };

      target.dispatchEvent(new PointerEvent('pointermove', { clientX: lastX, clientY: lastY, bubbles: true }));

      if (isPinching && !wasPinching) {
        target.dispatchEvent(new PointerEvent('pointerdown', { clientX: lastX, clientY: lastY, button: 0, buttons: 1, bubbles: true }));
      } else if (!isPinching && wasPinching) {
        target.dispatchEvent(new PointerEvent('pointerup', { clientX: lastX, clientY: lastY, button: 0, buttons: 0, bubbles: true }));
        target.click(); // ensure click fires for legacy handlers
      }
      wasPinching = isPinching;
    }
  }
  requestAnimationFrame(predict);
}

init();
