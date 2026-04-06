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
const toastTemplate = document.getElementById("toastTemplate");
const submitAnnotationBtn = document.getElementById("submitAnnotationBtn");
const submissionStatus = document.getElementById("submissionStatus");
const clipProgress = document.getElementById("clipProgress");
const confidenceSection = document.getElementById("confidenceSection");
const confidenceInput = document.getElementById("confidenceInput");
const submitConfidenceBtn = document.getElementById("submitConfidenceBtn");
const completionCard = document.getElementById("completionCard");

const submissionConfig = window.ANNOTATION_SUBMISSION || {};
const baseAdditionalFields = { ...(submissionConfig.additionalFields || {}) };
delete baseAdditionalFields.studyId;
delete baseAdditionalFields.participantId;
delete baseAdditionalFields.filenameHint;

let participantIdValue = "";

const overlayCtx = finalFrameCanvas.getContext("2d");
const annotationCtx = annotationCanvas.getContext("2d");

// --- STATE VARIABLES ---
let frameCaptured = false;
let finalFrameBuffered = false;
let currentClip = null;
let activeLine = null;
let expertLines = null;
let pointerDown = false;
let latestPayload = null;
let submissionInFlight = false;
let capturedFrameTimeValue = 0;
let currentClipIndex = 0;

// --- UTILITY ---

function showToast(message) {
  if (!toastTemplate) return;
  const toast = toastTemplate.content.firstElementChild.cloneNode(true);
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.classList.add("toast--visible");
  });
  setTimeout(() => toast.remove(), 2800);
}

function looksLikeLocalPath(value) {
  if (!value) return false;
  const lower = value.toLowerCase();
  return (
    lower.startsWith("file:") ||
    lower.startsWith("/users/") ||
    lower.startsWith("c:\\") ||
    lower.startsWith("\\\\")
  );
}

function looksLikeGithubBlob(value) {
  if (!value) return false;
  const lower = value.toLowerCase();
  return lower.includes("github.com") && lower.includes("/blob/");
}

// --- CLIP / EXPERT ANNOTATION MANAGEMENT ---

function getClips() {
  const clips = Array.isArray(window.ANNOTATION_CLIPS) ? [...window.ANNOTATION_CLIPS] : [];
  const params = new URLSearchParams(window.location.search);
  const videoParam = params.get("video");

  if (videoParam) {
    clips.unshift({
      id: "survey-param",
      label: "Embedded Clip",
      src: videoParam,
      poster: "",
    });
  }

  return clips;
}

async function loadExpertAnnotation(clipId, annotationType = "gt") {
  const basePath = annotationType === "mock" ? "mock-annotations/" : "expert-annotations/";
  const suffix = annotationType === "mock" ? "_mock.json" : "_gt.json";
  const jsonPath = `${basePath}${clipId}${suffix}`;

  try {
    const response = await fetch(jsonPath);
    if (!response.ok) {
      console.warn(`Annotation not found for clip: ${clipId}. Tried: ${jsonPath}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching annotation:", error);
    return null;
  }
}

async function loadClipByIndex(index) {
  const clips = getClips();

  if (index >= clips.length) {
    handleAllClipsCompleted();
    return;
  }

  const clip = clips[index];

  if (clipProgress) {
    clipProgress.textContent = `(Clip ${index + 1} of ${clips.length})`;
  }

  if (clipLabel) {
    clipLabel.textContent = clipProgress
      ? `${clip.label} ${clipProgress.textContent}`
      : clip.label;
  }

  if (index === clips.length - 1) {
    submitAnnotationBtn.textContent = "Submit & Finish";
  } else {
    submitAnnotationBtn.textContent = "Submit & Next Clip";
  }

  const src = clip.src;
  if (!src) {
    videoStatus.textContent = "Clip source missing.";
    return;
  }

  resetAnnotationState();

  currentClip = {
    id: clip.id,
    label: clip.label,
    src,
    poster: clip.poster || "",
    annotationType: clip.annotationType || "gt",
  };

  const clipIdBase = String(currentClip.id || "").replace(/_(mock|gt)$/, "");
  expertLines = await loadExpertAnnotation(clipIdBase, currentClip.annotationType);

  canvasContainer.hidden = true;
  video.removeAttribute("controls");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.crossOrigin = "anonymous";

  if (currentClip.poster) {
    video.setAttribute("poster", currentClip.poster);
  } else {
    video.removeAttribute("poster");
  }

  video.src = currentClip.src;
  video.load();
  videoStatus.textContent = "Loading clip…";
  replayBtn.disabled = true;
}

function handleAllClipsCompleted() {
  document.querySelectorAll(".card:not(#confidenceSection)").forEach((el) => {
    el.hidden = true;
  });
  if (confidenceSection) {
    confidenceSection.hidden = false;
  }
}

function resetAnnotationState() {
  frameCaptured = false;
  finalFrameBuffered = false;
  activeLine = null;
  expertLines = null;
  pointerDown = false;
  latestPayload = null;
  submissionInFlight = false;
  capturedFrameTimeValue = 0;

  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
  overlayCtx.clearRect(0, 0, finalFrameCanvas.width, finalFrameCanvas.height);

  annotationCanvas.style.backgroundImage = "";
  annotationStatus.textContent =
    "Final frame will appear below shortly. You can keep watching the clip while it prepares.";
  clearLineBtn.disabled = true;
  submitAnnotationBtn.disabled = true;

  if (submissionConfig.endpoint) {
    submissionStatus.textContent = participantIdValue
      ? "Draw the incision on the frozen frame to enable submission."
      : "Enter your email above before submitting.";
  } else {
    submissionStatus.textContent =
      "Investigator submission endpoint not configured. Update clip-config.js.";
  }
}

function handleVideoError() {
  let message = "Clip failed to load. ";

  if (currentClip?.src) {
    if (looksLikeLocalPath(currentClip.src)) {
      message += "Local file path detected (use HTTPS).";
    } else if (looksLikeGithubBlob(currentClip.src)) {
      message += "GitHub blob detected (use raw or pages URL).";
    } else {
      message += "Check URL.";
    }
  }

  videoStatus.textContent = message;
  showToast(message);
  replayBtn.disabled = true;
}

// --- FINAL FRAME CAPTURE LOGIC ---

function resizeCanvases(videoWidth, videoHeight) {
  const MAX_WIDTH = 1920;
  let width = videoWidth;
  let height = videoHeight;

  if (width > MAX_WIDTH) {
    const ratio = MAX_WIDTH / width;
    width = MAX_WIDTH;
    height = videoHeight * ratio;
  }

  finalFrameCanvas.width = width;
  finalFrameCanvas.height = height;
  annotationCanvas.width = width;
  annotationCanvas.height = height;
}

function bufferFrame(source) {
  if (!source.videoWidth || !source.videoHeight) return false;

  resizeCanvases(source.videoWidth, source.videoHeight);

  overlayCtx.clearRect(0, 0, finalFrameCanvas.width, finalFrameCanvas.height);
  overlayCtx.drawImage(source, 0, 0, finalFrameCanvas.width, finalFrameCanvas.height);

  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);
  annotationCanvas.style.backgroundImage = "";

  finalFrameBuffered = true;
  return true;
}

function revealCapturedFrame() {
  if (!finalFrameBuffered) return;

  frameCaptured = true;
  canvasContainer.hidden = false;

  finalFrameCanvas.style.display = "block";
  finalFrameCanvas.style.position = "absolute";
  finalFrameCanvas.style.top = "0";
  finalFrameCanvas.style.left = "0";
  finalFrameCanvas.style.zIndex = "1";

  annotationCanvas.style.position = "absolute";
  annotationCanvas.style.top = "0";
  annotationCanvas.style.left = "0";
  annotationCanvas.style.zIndex = "2";

  redrawCanvas();

  annotationStatus.textContent = expertLines
    ? "Final frame ready. Draw your incision line on top of the safety corridor."
    : "Final frame ready. Review the clip above and draw your incision when ready.";

  if (video.paused) {
    videoStatus.textContent = "Clip complete. The frozen frame below is ready for annotation.";
  } else {
    videoStatus.textContent = "Final frame captured below. You can keep watching or replay.";
  }

  replayBtn.disabled = false;

  const numericTime = Number((video.currentTime || 0).toFixed(3));
  capturedFrameTimeValue = Number.isFinite(numericTime) ? numericTime : 0;
}

function handleVideoTimeUpdate() {
  if (frameCaptured) return;

  const duration = Number.isFinite(video.duration) ? video.duration : null;
  if (!duration) return;

  const remaining = duration - video.currentTime;

  if (remaining <= 1.0) {
    bufferFrame(video);
  }
}

function handleVideoEnded() {
  if (frameCaptured) return;

  video.controls = true;
  video.setAttribute("controls", "");

  if (finalFrameBuffered) {
    revealCapturedFrame();
  } else {
    const target = Math.max(0, (video.duration || 0) - 0.1);
    videoStatus.textContent = "Capturing final frame...";

    const onSeeked = () => {
      if (bufferFrame(video)) {
        revealCapturedFrame();
      } else {
        videoStatus.textContent = "Could not capture frame. Please press Replay.";
      }
    };

    video.addEventListener("seeked", onSeeked, { once: true });
    video.currentTime = target;
  }
}

function handleVideoLoaded() {
  videoStatus.textContent = "Clip loaded. Tap play to begin.";
  video.controls = true;
  video.setAttribute("controls", "");
  video.play().catch(() => {
    try {
      video.pause();
    } catch (error) {}
    videoStatus.textContent = "Clip loaded. Press play to begin.";
  });
}

function handleVideoPlay() {
  videoStatus.textContent = frameCaptured
    ? "Replaying clip. The final frame remains available below."
    : "Watching clip…";
}

function handleReplay() {
  if (!currentClip) return;

  annotationStatus.textContent =
    "Final frame remains below. Review the clip again and adjust your line if needed.";

  activeLine = null;
  redrawCanvas();
  clearLineBtn.disabled = true;
  submitAnnotationBtn.disabled = true;

  if (submissionConfig.endpoint) {
    submissionStatus.textContent = participantIdValue
      ? "Draw the incision on the frozen frame to enable submission."
      : "Enter your email above before submitting.";
  } else {
    submissionStatus.textContent =
      "Investigator submission endpoint not configured. Update clip-config.js.";
  }

  updateSubmissionPayload();

  video.currentTime = 0;
  video.controls = true;
  video.setAttribute("controls", "");
  video.play().catch(() => {
    videoStatus.textContent = "Clip reset. Press play to watch again.";
  });
}

// --- DRAWING / OVERLAY LOGIC ---

function getPointerPosition(evt) {
  const rect = annotationCanvas.getBoundingClientRect();
  const touch = evt.touches?.[0] ?? evt.changedTouches?.[0] ?? null;
  const clientX = evt.clientX ?? touch?.clientX ?? 0;
  const clientY = evt.clientY ?? touch?.clientY ?? 0;

  const x = ((clientX - rect.left) / rect.width) * annotationCanvas.width;
  const y = ((clientY - rect.top) / rect.height) * annotationCanvas.height;
  return { x, y };
}

function normalizeFromPixels(pixels, referenceSize) {
  const width = referenceSize ? referenceSize.width : annotationCanvas.width;
  const height = referenceSize ? referenceSize.height : annotationCanvas.height;

  return {
    start: {
      x: pixels.start.x / width,
      y: pixels.start.y / height,
    },
    end: {
      x: pixels.end.x / width,
      y: pixels.end.y / height,
    },
  };
}

function redrawCanvas() {
  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

  if (expertLines && Array.isArray(expertLines.incisionDetails)) {
    const width = annotationCanvas.width;
    const height = annotationCanvas.height;

    annotationCtx.strokeStyle = "rgba(0, 255, 0, 0.7)";
    annotationCtx.lineWidth = Math.max(2, width * 0.005);
    annotationCtx.setLineDash([8, 6]);

    expertLines.incisionDetails.forEach((detail) => {
      const normalizedLine =
        detail.normalized ?? normalizeFromPixels(detail.pixels, expertLines.canvasSize);

      const startX = normalizedLine.start.x * width;
      const startY = normalizedLine.start.y * height;
      const endX = normalizedLine.end.x * width;
      const endY = normalizedLine.end.y * height;

      annotationCtx.beginPath();
      annotationCtx.moveTo(startX, startY);
      annotationCtx.lineTo(endX, endY);
      annotationCtx.stroke();
    });

    annotationCtx.setLineDash([]);
  }

  if (!activeLine) return;

  annotationCtx.strokeStyle = "#38bdf8";
  annotationCtx.lineWidth = Math.max(4, annotationCanvas.width * 0.004);
  annotationCtx.lineCap = "round";
  annotationCtx.beginPath();
  annotationCtx.moveTo(activeLine.start.x, activeLine.start.y);
  annotationCtx.lineTo(activeLine.end.x, activeLine.end.y);
  annotationCtx.stroke();

  annotationCtx.fillStyle = "#0ea5e9";
  annotationCtx.beginPath();
  annotationCtx.arc(
    activeLine.start.x,
    activeLine.start.y,
    annotationCtx.lineWidth,
    0,
    Math.PI * 2
  );
  annotationCtx.fill();

  annotationCtx.beginPath();
  annotationCtx.arc(
    activeLine.end.x,
    activeLine.end.y,
    annotationCtx.lineWidth,
    0,
    Math.PI * 2
  );
  annotationCtx.fill();
}

function normalizeLine(line) {
  return {
    start: {
      x: line.start.x / annotationCanvas.width,
      y: line.start.y / annotationCanvas.height,
    },
    end: {
      x: line.end.x / annotationCanvas.width,
      y: line.end.y / annotationCanvas.height,
    },
  };
}

function updateSubmissionPayload() {
  if (!activeLine || !frameCaptured || !currentClip) {
    latestPayload = null;
    submitAnnotationBtn.disabled = true;

    if (frameCaptured && submissionConfig.endpoint) {
      submissionStatus.textContent = participantIdValue
        ? "Draw the incision and release to submit."
        : "Enter your email above before submitting.";
    }
    return;
  }

  const normalizedLine = normalizeLine(activeLine);
  const lengthPixels = Math.hypot(
    activeLine.end.x - activeLine.start.x,
    activeLine.end.y - activeLine.start.y
  );

  const startPixels = {
    x: Number(activeLine.start.x.toFixed(2)),
    y: Number(activeLine.start.y.toFixed(2)),
  };

  const endPixels = {
    x: Number(activeLine.end.x.toFixed(2)),
    y: Number(activeLine.end.y.toFixed(2)),
  };

  const filenameHint = getFilenameHint();

  latestPayload = {
    clipId: currentClip.id,
    clipLabel: currentClip.label,
    videoSrc: currentClip.src,
    capturedFrameTime: capturedFrameTimeValue,
    incision: normalizedLine,
    incisionPixels: {
      start: startPixels,
      end: endPixels,
      length: Number(lengthPixels.toFixed(2)),
    },
    canvasSize: {
      width: annotationCanvas.width,
      height: annotationCanvas.height,
    },
    generatedAt: new Date().toISOString(),
    participantId: participantIdValue || "",
    filenameHint,
    expertAnnotation: expertLines
      ? {
          clipId: expertLines.clipId,
          incisions: Array.isArray(expertLines.incisionDetails)
            ? expertLines.incisionDetails.map((detail) => {
                return detail.normalized ??
                  normalizeFromPixels(detail.pixels, expertLines.canvasSize);
              })
            : [],
        }
      : null,
  };

  if (!submissionConfig.endpoint) {
    submitAnnotationBtn.disabled = true;
    submissionStatus.textContent =
      "Investigator submission endpoint not configured. Update clip-config.js.";
    return;
  }

  if (!participantIdValue) {
    submitAnnotationBtn.disabled = true;
    submissionStatus.textContent = "Enter your email above before submitting.";
    return;
  }

  if (!submissionInFlight) {
    submitAnnotationBtn.disabled = false;
  }

  submissionStatus.textContent = "Ready to submit. Tap the button to send your annotation.";
}

function handlePointerDown(evt) {
  if (!frameCaptured) {
    showToast("Final frame still loading. Please wait a moment before drawing.");
    return;
  }

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
  if (evt.type === "mouseleave") {
    pointerDown = false;
    return;
  }

  evt.preventDefault();
  pointerDown = false;
  activeLine.end = getPointerPosition(evt);
  redrawCanvas();
  clearLineBtn.disabled = false;
  annotationStatus.textContent = "Incision line recorded. Submit below.";
  updateSubmissionPayload();
}

function clearLine() {
  activeLine = null;
  pointerDown = false;
  redrawCanvas();
  annotationStatus.textContent = expertLines
    ? "Final frame ready. Draw your incision line on top of the safety corridor."
    : "Final frame ready. Draw your incision line.";
  clearLineBtn.disabled = true;
  updateSubmissionPayload();
}

// --- SUBMISSION LOGIC ---

async function submitAnnotation() {
  if (!latestPayload) {
    showToast("Draw the incision before submitting.");
    return false;
  }

  if (!submissionConfig.endpoint) {
    showToast("Submission endpoint missing. Update clip-config.js.");
    return false;
  }

  if (submissionInFlight) return false;

  submissionInFlight = true;
  submitAnnotationBtn.disabled = true;
  submissionStatus.textContent = "Submitting annotation…";

  const method = submissionConfig.method || "POST";
  const headers = { ...(submissionConfig.headers || {}) };

  let shouldSetDefaultContentType = true;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === "content-type") {
      shouldSetDefaultContentType = false;
      if (headers[key] === null) {
        delete headers[key];
      }
    }
  }

  if (shouldSetDefaultContentType) {
    headers["Content-Type"] = "application/json";
  }

  const filenameHint = getFilenameHint();
  const additionalFields = buildAdditionalFields(filenameHint);

  let bodyWrapper;
  if (submissionConfig.bodyWrapper === "none") {
    bodyWrapper = { ...additionalFields, ...latestPayload };
  } else {
    const key =
      typeof submissionConfig.bodyWrapper === "string" && submissionConfig.bodyWrapper
        ? submissionConfig.bodyWrapper
        : "annotation";
    bodyWrapper = { ...additionalFields, [key]: latestPayload };
  }

  try {
    const response = await fetch(submissionConfig.endpoint, {
      method,
      headers,
      body: JSON.stringify(bodyWrapper),
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    submissionStatus.textContent = "Annotation submitted.";
    showToast("Annotation sent.");
    return true;
  } catch (error) {
    submissionStatus.textContent = "Submission failed. Please try again.";
    submitAnnotationBtn.disabled = false;
    showToast("Unable to submit. Check connection.");
    console.error(error);
    return false;
  } finally {
    submissionInFlight = false;
  }
}

async function handleSubmitAndNext() {
  const success = await submitAnnotation();
  if (success) {
    currentClipIndex += 1;
    loadClipByIndex(currentClipIndex);
  }
}

function applyParticipantId(rawValue) {
  participantIdValue = (rawValue || "").trim();

  if (participantIdValue) {
    participantIdStatus.textContent =
      "Participant email recorded. Continue with the steps below.";
  } else {
    participantIdStatus.textContent =
      "Enter your email. This is required before submitting your annotation.";
  }

  updateSubmissionPayload();
}

function getFilenameHint() {
  const clipPart = currentClip?.id ? String(currentClip.id) : "annotation";
  if (participantIdValue) {
    return `${participantIdValue}_${clipPart}.json`;
  }
  return `${clipPart}.json`;
}

function buildAdditionalFields(filenameHint) {
  const fields = { ...baseAdditionalFields };
  const participantId = participantIdInput?.value.trim();

  const age = document.getElementById("ageInput")?.value.trim();
  const gender = document.getElementById("genderInput")?.value;
  const level_of_training = document.getElementById("levelInput")?.value;
  const specialty = document.getElementById("specialtyInput")?.value.trim();
  const years_of_practice = document.getElementById("yearsPracticeInput")?.value.trim();
  const familiarity = document.getElementById("familiarityInput")?.value;
  const fatigue = document.getElementById("fatigueInput")?.value;
  const confidence = document.getElementById("confidenceInput")?.value;

  if (participantId) {
    fields.participantId = participantId;
    fields.studyId = participantId;
  }
  if (filenameHint) fields.filenameHint = filenameHint;
  if (age) fields.age = age;
  if (gender) fields.gender = gender;
  if (level_of_training) fields.level_of_training = level_of_training;
  if (specialty) fields.specialty = specialty;
  if (years_of_practice) fields.years_of_practice = years_of_practice;
  if (familiarity) fields.familiarity = familiarity;
  if (fatigue) fields.fatigue = fatigue;
  if (confidence) fields.confidence = confidence;

  return fields;
}

// --- INITIAL SURVEY SUBMISSION ---

async function submitInitialSurveyAsCSV() {
  const endpoint = submissionConfig.endpoint;
  if (!endpoint) return;

  const participantId = document.getElementById("participantIdInput")?.value.trim() || "";
  const timestamp = new Date().toISOString();

  const header = [
    "participantId",
    "age",
    "gender",
    "level_of_training",
    "specialty",
    "years_of_practice",
    "familiarity",
    "fatigue",
    "generatedAt",
  ];

  const row = [
    participantId,
    document.getElementById("ageInput")?.value.trim() || "",
    document.getElementById("genderInput")?.value || "",
    document.getElementById("levelInput")?.value || "",
    document.getElementById("specialtyInput")?.value.trim() || "",
    document.getElementById("yearsPracticeInput")?.value.trim() || "",
    document.getElementById("familiarityInput")?.value || "",
    document.getElementById("fatigueInput")?.value || "",
    timestamp,
  ];

  const csvString = header.join(",") + "\n" + row.join(",");
  const filename = `survey_${participantId || "anon"}_${timestamp}.csv`;

  try {
    await fetch(endpoint, {
      method: submissionConfig.method || "POST",
      headers: submissionConfig.headers || { "Content-Type": "application/json" },
      body: JSON.stringify({ annotation: { filename, csv: csvString } }),
    });
  } catch (err) {
    console.error("Initial survey CSV failed", err);
  }
}

// --- EVENT LISTENERS ---

replayBtn.addEventListener("click", handleReplay);
video.addEventListener("loadeddata", handleVideoLoaded);
video.addEventListener("error", handleVideoError);
video.addEventListener("play", handleVideoPlay);
video.addEventListener("timeupdate", handleVideoTimeUpdate);
video.addEventListener("ended", handleVideoEnded);
clearLineBtn.addEventListener("click", clearLine);
submitAnnotationBtn.addEventListener("click", handleSubmitAndNext);

participantIdInput.addEventListener("input", (event) => {
  applyParticipantId(event.target.value);
});

annotationCanvas.style.touchAction = "none";

if (window.PointerEvent) {
  annotationCanvas.addEventListener("pointerdown", handlePointerDown, { passive: false });
  annotationCanvas.addEventListener("pointermove", handlePointerMove, { passive: false });
  annotationCanvas.addEventListener("pointerup", handlePointerUp, { passive: false });
  annotationCanvas.addEventListener("pointercancel", handlePointerUp, { passive: false });
  annotationCanvas.addEventListener("mouseleave", handlePointerUp, { passive: false });
} else {
  annotationCanvas.addEventListener("mousedown", handlePointerDown, { passive: false });
  annotationCanvas.addEventListener("mousemove", handlePointerMove, { passive: false });
  annotationCanvas.addEventListener("mouseup", handlePointerUp, { passive: false });
  annotationCanvas.addEventListener("mouseleave", handlePointerUp, { passive: false });
  annotationCanvas.addEventListener("touchstart", handlePointerDown, { passive: false });
  annotationCanvas.addEventListener("touchmove", handlePointerMove, { passive: false });
  annotationCanvas.addEventListener("touchend", handlePointerUp, { passive: false });
  annotationCanvas.addEventListener("touchcancel", handlePointerUp, { passive: false });
}

// --- INITIALIZATION ---

submitInitialSurveyAsCSV();
loadClipByIndex(0);
applyParticipantId(participantIdInput.value);

// --- CONFIDENCE SUBMISSION ---

if (submitConfidenceBtn) {
  submitConfidenceBtn.addEventListener("click", async () => {
    const confidenceValue = confidenceInput?.value;

    if (!confidenceValue) {
      showToast("Please select a confidence level before submitting.");
      return;
    }

    const participantId = participantIdInput.value.trim();
    const body = {
      participantId,
      confidenceFinal: confidenceValue,
      generatedAt: new Date().toISOString(),
    };

    try {
      const response = await fetch(submissionConfig.endpoint, {
        method: submissionConfig.method || "POST",
        headers: submissionConfig.headers || { "Content-Type": "application/json" },
        body: JSON.stringify({ annotation: body }),
      });

      if (!response.ok) throw new Error("Submission failed");

      showToast("Confidence submitted. Thank you!");
      if (confidenceSection) confidenceSection.hidden = true;
      if (completionCard) completionCard.hidden = false;
    } catch (err) {
      showToast("Could not submit. Try again.");
      console.error(err);
    }
  });
}
