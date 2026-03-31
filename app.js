/* ================================================================  
   Cholecystectomy Incision Annotation – Phase 02  
   Mobile-safe app.js  
   ================================================================ */

(function () {  
  "use strict";

  // ── Configuration ────────────────────────────────────────────  
  // Replace / extend this array with your actual clip URLs.  
  const CLIP_URLS = [  
    "clips/clip01.mp4",  
    "clips/clip02.mp4",  
    "clips/clip03.mp4"  
  ];

  // Backend endpoint (adjust to your real API)  
  const SUBMIT_ENDPOINT = "/api/annotations";

  // Maximum canvas dimension (keeps iOS happy — 4096 is safe)  
  const MAX_CANVAS_DIM = 2048;

  // ── DOM refs ─────────────────────────────────────────────────  
  const emailInput     = document.getElementById("emailInput");  
  const fatigueSelect  = document.getElementById("fatigueSelect");

  const clipVideo      = document.getElementById("clipVideo");  
  const videoOverlay   = document.getElementById("videoOverlay");  
  const btnReplay      = document.getElementById("btnReplay");  
  const clipProgress   = document.getElementById("clipProgress");

  const frameCanvas    = document.getElementById("frameCanvas");  
  const ctx            = frameCanvas.getContext("2d", { willReadFrequently: true });  
  const canvasWrap     = document.getElementById("canvasWrap");  
  const statusAnnotate = document.getElementById("statusAnnotate");  
  const btnClear       = document.getElementById("btnClear");

  const statusSubmit   = document.getElementById("statusSubmit");  
  const btnSubmit      = document.getElementById("btnSubmit");

  const cardConfidence = document.getElementById("cardConfidence");  
  const btnConfidence  = document.getElementById("btnConfidence");

  const cardDone       = document.getElementById("cardDone");  
  const cardDetails    = document.getElementById("cardDetails");  
  const cardVideo      = document.getElementById("cardVideo");  
  const cardAnnotate   = document.getElementById("cardAnnotate");  
  const cardSubmit     = document.getElementById("cardSubmit");

  // ── State ────────────────────────────────────────────────────  
  let currentClipIndex = 0;  
  let frameCaptured    = false;  
  let lastCapturedFrame = null;   // ImageData backup for iOS recovery

  // Drawing state  
  let lineStart  = null;   // {x, y} normalised 0–1  
  let lineEnd    = null;  
  let isDrawing  = false;  
  let hasLine    = false;

  // ── Helpers ──────────────────────────────────────────────────

  /** Safe canvas sizing that respects mobile GPU limits */  
  function sizeCanvas(srcW, srcH) {  
    let w = srcW;  
    let h = srcH;  
    const maxPixels = MAX_CANVAS_DIM * MAX_CANVAS_DIM;

    if (w * h > maxPixels || w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM) {  
      const scale = Math.min(MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h);  
      w = Math.floor(w * scale);  
      h = Math.floor(h * scale);  
    }  
    frameCanvas.width  = w;  
    frameCanvas.height = h;  
  }

  /** Draw the stored frame + any annotation line */  
  function redrawCanvas() {  
    if (!lastCapturedFrame) return;

    // Put the saved image data back (handles iOS canvas purge)  
    ctx.putImageData(lastCapturedFrame, 0, 0);

    if (lineStart && lineEnd) {  
      drawLineOnCanvas(lineStart, lineEnd);  
    }  
  }

  /** Draw a line using normalised coords */  
  function drawLineOnCanvas(start, end) {  
    const w = frameCanvas.width;  
    const h = frameCanvas.height;

    ctx.save();  
    ctx.strokeStyle = "#00ff66";  
    ctx.lineWidth   = Math.max(2, Math.round(w / 200));  
    ctx.lineCap     = "round";  
    ctx.shadowColor = "rgba(0,0,0,.6)";  
    ctx.shadowBlur  = 4;

    ctx.beginPath();  
    ctx.moveTo(start.x * w, start.y * h);  
    ctx.lineTo(end.x * w,   end.y * h);  
    ctx.stroke();  
    ctx.restore();  
  }

  /** Get normalised coords from a pointer/touch event on the canvas */  
  function canvasCoords(e) {  
    const rect = frameCanvas.getBoundingClientRect();  
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;  
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;  
    return {  
      x: (clientX - rect.left) / rect.width,  
      y: (clientY - rect.top)  / rect.height  
    };  
  }

  /** Get coords from a touch-end (uses changedTouches) */  
  function canvasCoordsEnd(e) {  
    const rect = frameCanvas.getBoundingClientRect();  
    const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;  
    const clientY = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;  
    return {  
      x: (clientX - rect.left) / rect.width,  
      y: (clientY - rect.top)  / rect.height  
    };  
  }

  /** Capture the current video frame to canvas + backup ImageData */  
  function captureFrame() {  
    if (frameCaptured) return;           // already done

    const vw = clipVideo.videoWidth  || 640;  
    const vh = clipVideo.videoHeight || 360;  
    sizeCanvas(vw, vh);

    try {  
      ctx.drawImage(clipVideo, 0, 0, frameCanvas.width, frameCanvas.height);  
      lastCapturedFrame = ctx.getImageData(0, 0, frameCanvas.width, frameCanvas.height);  
      frameCaptured = true;

      statusAnnotate.textContent = "Final frame captured. Draw your incision line.";  
      statusAnnotate.className   = "status-bar success";  
      btnClear.disabled = false;

      console.log("[capture] frame saved", frameCanvas.width, "×", frameCanvas.height);  
    } catch (err) {  
      console.warn("[capture] drawImage failed, will retry:", err);  
    }  
  }

  // ── Video lifecycle ──────────────────────────────────────────

  function loadClip(index) {  
    if (index >= CLIP_URLS.length) {  
      showDone();  
      return;  
    }

    // Reset state  
    frameCaptured     = false;  
    lastCapturedFrame = null;  
    lineStart  = null;  
    lineEnd    = null;  
    hasLine    = false;  
    isDrawing  = false;

    btnReplay.disabled  = true;  
    btnSubmit.disabled  = true;  
    btnClear.disabled   = true;

    statusAnnotate.textContent = "The final frame appears below shortly.";  
    statusAnnotate.className   = "status-bar info";  
    statusSubmit.textContent   = "Draw the incision on the frozen frame to enable submission.";  
    statusSubmit.className     = "status-bar warn";

    ctx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);  
    clipProgress.textContent = `Clip ${index + 1} of ${CLIP_URLS.length}`;

    videoOverlay.textContent = "Loading Clip…";  
    videoOverlay.classList.remove("hidden");

    clipVideo.src = CLIP_URLS[index];  
    clipVideo.load();  
  }

  /* ── Video events ── */

  clipVideo.addEventListener("loadedmetadata", () => {  
    console.log("[video] metadata loaded",  
      clipVideo.videoWidth, "×", clipVideo.videoHeight,  
      "duration", clipVideo.duration);  
  });

  clipVideo.addEventListener("canplaythrough", () => {  
    videoOverlay.classList.add("hidden");  
    clipVideo.play().catch(err => {  
      console.warn("[video] autoplay blocked:", err);  
      videoOverlay.textContent = "Tap to play";  
      videoOverlay.classList.remove("hidden");  
      videoOverlay.style.pointerEvents = "auto";  
      videoOverlay.onclick = () => {  
        clipVideo.play();  
        videoOverlay.classList.add("hidden");  
        videoOverlay.style.pointerEvents = "none";  
        videoOverlay.onclick = null;  
      };  
    });  
  });

  /*  
   * KEY FIX #1 — Continuously capture frames during playback.  
   * On iOS Safari the decoded frame may be released once the video  
   * pauses or ends, so the LAST frame drawn here acts as our fallback.  
   * We throttle to ~4 fps to avoid performance issues on low-end devices.  
   */  
  let lastCaptureTime = 0;  
  clipVideo.addEventListener("timeupdate", () => {  
    const now = performance.now();  
    if (now - lastCaptureTime < 250) return;   // throttle  
    lastCaptureTime = now;

    if (frameCaptured) return;

    const vw = clipVideo.videoWidth  || 640;  
    const vh = clipVideo.videoHeight || 360;

    // Ensure canvas is sized  
    if (frameCanvas.width !== vw || frameCanvas.height !== vh) {  
      sizeCanvas(vw, vh);  
    }

    try {  
      ctx.drawImage(clipVideo, 0, 0, frameCanvas.width, frameCanvas.height);  
    } catch (_) { /* ignore occasional security errors */ }

    /*  
     * KEY FIX #2 — Freeze ~150 ms before the end so the frame  
     * is still decoded when we snapshot.  
     */  
    if (clipVideo.duration && clipVideo.duration - clipVideo.currentTime < 0.2) {  
      clipVideo.pause();  
      // Use a short timeout so the browser finishes decoding the frame  
      setTimeout(() => captureFrame(), 80);  
    }  
  });

  /*  
   * Fallback: if `timeupdate` didn't catch the end (e.g. very short clip)  
   */  
  clipVideo.addEventListener("pause", () => {  
    if (!frameCaptured && clipVideo.currentTime > 0) {  
      setTimeout(() => captureFrame(), 100);  
    }  
    btnReplay.disabled = false;  
  });

  clipVideo.addEventListener("ended", () => {  
    if (!frameCaptured) {  
      // Seek back slightly and capture  
      try {  
        clipVideo.currentTime = Math.max(0, clipVideo.duration - 0.05);  
      } catch (_) {}  
      setTimeout(() => captureFrame(), 150);  
    }  
    btnReplay.disabled = false;  
  });

  // ── Replay ───────────────────────────────────────────────────  
  btnReplay.addEventListener("click", () => {  
    // Reset annotation state  
    frameCaptured     = false;  
    lastCapturedFrame = null;  
    lineStart  = null;  
    lineEnd    = null;  
    hasLine    = false;

    btnSubmit.disabled = true;  
    btnClear.disabled  = true;

    statusAnnotate.textContent = "The final frame appears below shortly.";  
    statusAnnotate.className   = "status-bar info";  
    statusSubmit.textContent   = "Draw the incision on the frozen frame to enable submission.";  
    statusSubmit.className     = "status-bar warn";

    ctx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);

    clipVideo.currentTime = 0;  
    clipVideo.play().catch(() => {});  
  });

  // ── Canvas drawing (pointer + touch) ─────────────────────────

  function onPointerDown(e) {  
    if (!frameCaptured) return;  
    e.preventDefault();  
    isDrawing = true;  
    lineStart = canvasCoords(e);  
    lineEnd   = null;  
    hasLine   = false;  
    redrawCanvas();           // clear previous line  
  }

  function onPointerMove(e) {  
    if (!isDrawing) return;  
    e.preventDefault();  
    lineEnd = canvasCoords(e);  
    redrawCanvas();  
  }

  function onPointerUp(e) {  
    if (!isDrawing) return;  
    e.preventDefault();  
    isDrawing = false;  
    lineEnd = canvasCoordsEnd(e);

    // Require minimum length  
    if (lineStart && lineEnd) {  
      const dx = lineEnd.x - lineStart.x;  
      const dy = lineEnd.y - lineStart.y;  
      if (Math.sqrt(dx * dx + dy * dy) > 0.01) {  
        hasLine = true;  
        btnSubmit.disabled = false;  
        statusSubmit.textContent = "Annotation ready. You may submit.";  
        statusSubmit.className   = "status-bar success";  
      }  
    }  
    redrawCanvas();  
  }

  // Mouse events  
  frameCanvas.addEventListener("mousedown", onPointerDown);  
  frameCanvas.addEventListener("mousemove", onPointerMove);  
  frameCanvas.addEventListener("mouseup",   onPointerUp);  
  frameCanvas.addEventListener("mouseleave", (e) => { if (isDrawing) onPointerUp(e); });

  // Touch events (mobile)  
  frameCanvas.addEventListener("touchstart", onPointerDown, { passive: false });  
  frameCanvas.addEventListener("touchmove",  onPointerMove, { passive: false });  
  frameCanvas.addEventListener("touchend",   onPointerUp,   { passive: false });  
  frameCanvas.addEventListener("touchcancel", (e) => { if (isDrawing) onPointerUp(e); });

  /*  
   * KEY FIX #3 — iOS can purge GPU-backed canvases when memory is low  
   * or the page is backgrounded.  On visibility change we re-stamp.  
   */  
  document.addEventListener("visibilitychange", () => {  
    if (!document.hidden && lastCapturedFrame) {  
      requestAnimationFrame(() => redrawCanvas());  
    }  
  });

  // Also re-draw on resize (orientation change)  
  window.addEventListener("resize", () => {  
    if (lastCapturedFrame) {  
      requestAnimationFrame(() => redrawCanvas());  
    }  
  });

  // ── Clear ────────────────────────────────────────────────────  
  btnClear.addEventListener("click", () => {  
    lineStart = null;  
    lineEnd   = null;  
    hasLine   = false;  
    isDrawing = false;  
    btnSubmit.disabled = true;

    statusSubmit.textContent = "Draw the incision on the frozen frame to enable submission.";  
    statusSubmit.className   = "status-bar warn";

    redrawCanvas();  
  });

  // ── Submit ───────────────────────────────────────────────────  
  btnSubmit.addEventListener("click", async () => {  
    const email   = emailInput.value.trim();  
    const fatigue = fatigueSelect.value;

    if (!email) { alert("Please enter your email."); emailInput.focus(); return; }  
    if (!fatigue) { alert("Please select your fatigue level."); return; }  
    if (!hasLine) { alert("Please draw an incision line first."); return; }

    btnSubmit.disabled  = true;  
    btnSubmit.textContent = "Sending…";

    const payload = {  
      email,  
      fatigue:   Number(fatigue),  
      clipIndex: currentClipIndex,  
      clipUrl:   CLIP_URLS[currentClipIndex],  
      line: {  
        start: lineStart,  
        end:   lineEnd  
      },  
      canvasSize: {  
        w: frameCanvas.width,  
        h: frameCanvas.height  
      },  
      // Include a PNG data-URL of the annotated frame  
      frameImage: frameCanvas.toDataURL("image/png"),  
      timestamp: new Date().toISOString()  
    };

    try {  
      const res = await fetch(SUBMIT_ENDPOINT, {  
        method: "POST",  
        headers: { "Content-Type": "application/json" },  
        body: JSON.stringify(payload)  
      });

      if (!res.ok) throw new Error(`Server responded ${res.status}`);  
      console.log("[submit] success for clip", currentClipIndex);  
    } catch (err) {  
      console.warn("[submit] network send failed — storing locally:", err);  
      // Fallback: store in localStorage so data isn't lost  
      const key = `annotation_${Date.now()}`;  
      try { localStorage.setItem(key, JSON.stringify(payload)); } catch (_) {}  
    }

    btnSubmit.textContent = "Submit to Investigator and Next Clip ➜";

    // Show confidence card  
    cardConfidence.classList.remove("hidden");  
    cardConfidence.scrollIntoView({ behavior: "smooth" });  
  });

  // ── Confidence ───────────────────────────────────────────────  
  document.querySelectorAll('input[name="confidence"]').forEach(radio => {  
    radio.addEventListener("change", () => { btnConfidence.disabled = false; });  
  });

  btnConfidence.addEventListener("click", async () => {  
    const selected = document.querySelector('input[name="confidence"]:checked');  
    if (!selected) return;

    const payload = {  
      email:      emailInput.value.trim(),  
      clipIndex:  currentClipIndex,  
      confidence: Number(selected.value),  
      timestamp:  new Date().toISOString()  
    };

    try {  
      await fetch(SUBMIT_ENDPOINT, {  
        method: "POST",  
        headers: { "Content-Type": "application/json" },  
        body: JSON.stringify(payload)  
      });  
    } catch (err) {  
      console.warn("[confidence] network error:", err);  
      try { localStorage.setItem(`conf_${Date.now()}`, JSON.stringify(payload)); } catch (_) {}  
    }

    // Reset confidence radios  
    document.querySelectorAll('input[name="confidence"]').forEach(r => r.checked = false);  
    btnConfidence.disabled = true;  
    cardConfidence.classList.add("hidden");

    // Advance to next clip  
    currentClipIndex++;  
    if (currentClipIndex < CLIP_URLS.length) {  
      loadClip(currentClipIndex);  
      window.scrollTo({ top: 0, behavior: "smooth" });  
    } else {  
      showDone();  
    }  
  });

  // ── Done ─────────────────────────────────────────────────────  
  function showDone() {  
    cardDetails.classList.add("hidden");  
    cardVideo.classList.add("hidden");  
    cardAnnotate.classList.add("hidden");  
    cardSubmit.classList.add("hidden");  
    cardConfidence.classList.add("hidden");  
    cardDone.classList.remove("hidden");  
  }

  // ── Boot ─────────────────────────────────────────────────────  
  loadClip(0);  
})();  
