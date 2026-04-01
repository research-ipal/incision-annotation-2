const participantIdInput = document.getElementById("participantIdInput");
const participantIdStatus = document.getElementById("participantIdStatus");
const clipLabel = document.getElementById("clipLabel");
const replayBtn = document.getElementById("replayBtn");
const video = document.getElementById("caseVideo");
const finalFrameCanvas = document.getElementById("finalFrame");
const annotationCanvas = document.getElementById("annotationCanvas");
const canvasContainer = document.getElementById("canvasContainer");
const clearLineBtn = document.getElementById("clearLineBtn");
const videoStatus = document.getElementById("videoStatus");
const annotationStatus = document.getElementById("annotationStatus");
const submitAnnotationBtn = document.getElementById("submitAnnotationBtn");
const submissionStatus = document.getElementById("submissionStatus");

const overlayCtx = finalFrameCanvas.getContext("2d");
const annotationCtx = annotationCanvas.getContext("2d");

let frameCaptured = false;
let activeLine = null;
let pointerDown = false;
let capturedFrameTimeValue = 0;

// ---------------- FIXED CANVAS RESIZE ----------------
function resizeCanvases(width, height) {
  finalFrameCanvas.width = width;
  finalFrameCanvas.height = height;

  annotationCanvas.width = width;
  annotationCanvas.height = height;

  finalFrameCanvas.style.width = "100%";
  annotationCanvas.style.width = "100%";

  finalFrameCanvas.style.height = "auto";
  annotationCanvas.style.height = "auto";
}

// ---------------- FIXED FRAME CAPTURE ----------------
function captureFrameImage(source, frameTimeValue) {
  if (!source.videoWidth || !source.videoHeight) return false;

  const firstCapture = !frameCaptured;

  resizeCanvases(source.videoWidth, source.videoHeight);

  // Draw base frame
  overlayCtx.clearRect(0, 0, finalFrameCanvas.width, finalFrameCanvas.height);
  overlayCtx.drawImage(source, 0, 0, finalFrameCanvas.width, finalFrameCanvas.height);

  // Clear annotation layer
  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

  frameCaptured = true;

  canvasContainer.hidden = false;
  finalFrameCanvas.hidden = false;

  annotationStatus.textContent = "Final frame ready. Draw your incision.";

  if (firstCapture) {
    videoStatus.textContent = "Final frame captured.";
  }

  replayBtn.disabled = false;

  const numericTime = Number(
    ((frameTimeValue ?? source.currentTime ?? 0) || 0).toFixed(3)
  );
  capturedFrameTimeValue = Number.isFinite(numericTime) ? numericTime : 0;

  redrawCanvas();
  return true;
}

// ---------------- DRAWING ----------------
function getPointerPosition(evt) {
  const rect = annotationCanvas.getBoundingClientRect();
  const touch = evt.touches?.[0] ?? evt.changedTouches?.[0];

  const clientX = evt.clientX ?? touch?.clientX ?? 0;
  const clientY = evt.clientY ?? touch?.clientY ?? 0;

  return {
    x: ((clientX - rect.left) / rect.width) * annotationCanvas.width,
    y: ((clientY - rect.top) / rect.height) * annotationCanvas.height,
  };
}

function redrawCanvas() {
  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

  if (!activeLine) return;

  annotationCtx.strokeStyle = "#38bdf8";
  annotationCtx.lineWidth = Math.max(4, annotationCanvas.width * 0.004);
  annotationCtx.lineCap = "round";

  annotationCtx.beginPath();
  annotationCtx.moveTo(activeLine.start.x, activeLine.start.y);
  annotationCtx.lineTo(activeLine.end.x, activeLine.end.y);
  annotationCtx.stroke();
}

function handlePointerDown(evt) {
  if (!frameCaptured) return;

  evt.preventDefault();
  pointerDown = true;

  const start = getPointerPosition(evt);
  activeLine = { start, end: start };

  redrawCanvas();
}

function handlePointerMove(evt) {
  if (!pointerDown || !activeLine) return;

  evt.preventDefault();
  activeLine.end = getPointerPosition(evt);
  redrawCanvas();
}

function handlePointerUp(evt) {
  if (!pointerDown || !activeLine) return;

  evt.preventDefault();
  pointerDown = false;

  activeLine.end = getPointerPosition(evt);
  redrawCanvas();

  clearLineBtn.disabled = false;
  submitAnnotationBtn.disabled = false;
}

// ---------------- VIDEO ----------------
video.addEventListener("loadeddata", () => {
  videoStatus.textContent = "Clip loaded.";
  video.play().catch(() => {});
});

video.addEventListener("timeupdate", () => {
  if (frameCaptured) return;

  if (!video.duration) return;

  if (video.duration - video.currentTime < 0.25) {
    captureFrameImage(video, video.duration);
  }
});

video.addEventListener("ended", () => {
  captureFrameImage(video, video.duration);
});

// ---------------- BUTTONS ----------------
clearLineBtn.addEventListener("click", () => {
  activeLine = null;
  redrawCanvas();
  clearLineBtn.disabled = true;
  submitAnnotationBtn.disabled = true;
});

replayBtn.addEventListener("click", () => {
  video.currentTime = 0;
  video.play();
});

// ---------------- POINTER EVENTS ----------------
annotationCanvas.addEventListener("pointerdown", handlePointerDown);
annotationCanvas.addEventListener("pointermove", handlePointerMove);
annotationCanvas.addEventListener("pointerup", handlePointerUp);
annotationCanvas.addEventListener("pointerleave", handlePointerUp);

// ---------------- INIT ----------------
video.src = window.ANNOTATION_CLIPS?.[0]?.src || "";
video.load();
