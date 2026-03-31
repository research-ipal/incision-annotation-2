/* ================================================================  
   Cholecystectomy Incision Annotation – Phase 02  
   Fully mobile-safe  ·  Reads clips from clips.csv  
   ================================================================ */  
(function () {  
  "use strict";

  // ────────────────────────────────────────────────────────────  
  // CONFIG — adjust these to match your setup  
  // ────────────────────────────────────────────────────────────  
  const CLIPS_CSV_PATH  = "clips.csv";          // path to the CSV / data file  
  const SUBMIT_ENDPOINT = "/api/annotations";   // backend URL  
  const MAX_CANVAS_DIM  = 2048;                 // keeps iOS GPU happy

  // ────────────────────────────────────────────────────────────  
  // DOM REFERENCES  
  // ────────────────────────────────────────────────────────────  
  const $ = (id) => document.getElementById(id);

  const emailInput     = $("emailInput");  
  const fatigueSelect  = $("fatigueSelect");  
  const clipVideo      = $("clipVideo");  
  const videoOverlay   = $("videoOverlay");  
  const btnReplay      = $("btnReplay");  
  const clipProgress   = $("clipProgress");  
  const clipProgressBar = $("clipProgressBar");  
  const frameCanvas    = $("frameCanvas");  
  const ctx            = frameCanvas.getContext("2d", { willReadFrequently: true });  
  const canvasWrap     = $("canvasWrap");  
  const statusAnnotate = $("statusAnnotate");  
  const btnClear       = $("btnClear");  
  const statusSubmit   = $("statusSubmit");  
  const btnSubmit      = $("btnSubmit");  
  const cardConfidence = $("cardConfidence");  
  const btnConfidence  = $("btnConfidence");  
  const cardDone       = $("cardDone");  
  const cardDetails    = $("cardDetails");  
  const cardVideo      = $("cardVideo");  
  const cardAnnotate   = $("cardAnnotate");  
  const cardSubmit     = $("cardSubmit");  
  const cardError      = $("cardError");  
  const errorMessage   = $("errorMessage");

  // ────────────────────────────────────────────────────────────  
  // STATE  
  // ────────────────────────────────────────────────────────────  
  let clipList          = [];      // array of clip URLs for this participant  
  let currentClipIndex  = 0;  
  let frameCaptured     = false;  
  let lastCapturedFrame = null;    // ImageData backup (survives iOS purge)  
  let lineStart         = null;    // { x, y } normalised 0-1  
  let lineEnd           = null;  
  let isDrawing         = false;  
  let hasLine           = false;

  // ────────────────────────────────────────────────────────────  
  // CSV / CLIP LOADING  
  // ────────────────────────────────────────────────────────────

  /**  
   * Parse the clips file.  Supports several common formats:  
   *  
   *  A) One URL per line  
   *       clips/clip01.mp4  
   *       clips/clip02.mp4  
   *  
   *  B) CSV with header — columns like:  
   *       participant,clip_url  
   *       user@example.com,clips/clip01.mp4  
   *  
   *  C) CSV with clip columns:  
   *       participant,clip1,clip2,clip3  
   *       user@example.com,clips/a.mp4,clips/b.mp4,clips/c.mp4  
   *  
   * Returns an array of URL strings.  
   */  
  function parseClipsFile(text, email) {  
    const lines = text  
      .split(/\r?\n/)  
      .map(l => l.trim())  
      .filter(l => l.length > 0 && !l.startsWith("#"));

    if (lines.length === 0) return [];

    // Detect whether first line looks like a header  
    const firstLine = lines[0].toLowerCase();  
    const hasHeader = /participant|email|clip|url|video/i.test(firstLine);

    // ── Format A: plain list of URLs (no commas, or single-column) ──  
    const isPlainList = !lines[0].includes(",") && !hasHeader;  
    if (isPlainList) {  
      return lines.filter(l => /\.(mp4|webm|mov|m4v|ogg)/i.test(l));  
    }

    // ── CSV formats ──  
    const rows   = lines.map(l => l.split(",").map(c => c.trim()));  
    const header = hasHeader ? rows.shift() : null;

    if (!header) {  
      // No header — treat every cell that looks like a URL as a clip  
      const urls = [];  
      rows.forEach(row => row.forEach(cell => {  
        if (/\.(mp4|webm|mov|m4v|ogg)/i.test(cell)) urls.push(cell);  
      }));  
      return urls;  
    }

    // ── With header: find email/participant column and clip columns ──  
    const hdrLower = header.map(h => h.toLowerCase());

    const emailCol = hdrLower.findIndex(h =>  
      /email|participant|user/i.test(h)  
    );

    // Clip columns = everything that isn't the email column, OR columns named clip/url/video  
    const clipCols = [];  
    hdrLower.forEach((h, i) => {  
      if (i === emailCol) return;  
      // Accept columns named clip*, url*, video*, or just numbered  
      clipCols.push(i);  
    });

    // If we have an email column, try to find the participant's row  
    if (emailCol >= 0 && email) {  
      const normalEmail = email.toLowerCase().trim();  
      const participantRow = rows.find(r =>  
        r[emailCol] && r[emailCol].toLowerCase().trim() === normalEmail  
      );  
      if (participantRow) {  
        return clipCols  
          .map(i => participantRow[i])  
          .filter(c => c && c.length > 0 && c !== "-" && c !== "N/A");  
      }  
      // Email not found — return empty; caller will show an error  
      return [];  
    }

    // No email column — collect all clip URLs from all rows  
    const urls = [];  
    rows.forEach(row => {  
      clipCols.forEach(i => {  
        const cell = row[i];  
        if (cell && cell.length > 0 && /\.(mp4|webm|mov|m4v|ogg)/i.test(cell)) {  
          urls.push(cell);  
        }  
      });  
    });  
    return urls;  
  }

  async function fetchClipList(email) {  
    try {  
      const resp = await fetch(CLIPS_CSV_PATH, { cache: "no-cache" });  
      if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${CLIPS_CSV_PATH}`);  
      const text = await resp.text();  
      const clips = parseClipsFile(text, email);  
      return clips;  
    } catch (err) {  
      console.error("[fetchClipList]", err);  
      throw err;  
    }  
  }

  // ────────────────────────────────────────────────────────────  
  // CANVAS HELPERS  
  // ────────────────────────────────────────────────────────────

  function sizeCanvas(srcW, srcH) {  
    let w = srcW, h = srcH;  
    if (w > MAX_CANVAS_DIM || h > MAX_CANVAS_DIM) {  
      const s = Math.min(MAX_CANVAS_DIM / w, MAX_CANVAS_DIM / h);  
      w = Math.floor(w * s);  
      h = Math.floor(h * s);  
    }  
    // Avoid zero dimensions  
    frameCanvas.width  = Math.max(w, 1);  
    frameCanvas.height = Math.max(h, 1);  
  }

  function redrawCanvas() {  
    if (!lastCapturedFrame) return;  
    ctx.putImageData(lastCapturedFrame, 0, 0);  
    if (lineStart && lineEnd) drawLineOnCanvas(lineStart, lineEnd);  
  }

  function drawLineOnCanvas(start, end) {  
    const w = frameCanvas.width, h = frameCanvas.height;  
    ctx.save();  
    ctx.strokeStyle = "#00ff66";  
    ctx.lineWidth   = Math.max(2, Math.round(w / 180));  
    ctx.lineCap     = "round";  
    ctx.shadowColor = "rgba(0,0,0,.55)";  
    ctx.shadowBlur  = 5;  
    ctx.beginPath();  
    ctx.moveTo(start.x * w, start.y * h);  
    ctx.lineTo(end.x * w,   end.y * h);  
    ctx.stroke();  
    ctx.restore();  
  }

  function canvasCoords(e) {  
    const r = frameCanvas.getBoundingClientRect();  
    const cx = e.touches ? e.touches[0].clientX : e.clientX;  
    const cy = e.touches ? e.touches[0].clientY : e.clientY;  
    return {  
      x: Math.max(0, Math.min(1, (cx - r.left) / r.width)),  
      y: Math.max(0, Math.min(1, (cy - r.top)  / r.height))  
    };  
  }

  function canvasCoordsEnd(e) {  
    const r  = frameCanvas.getBoundingClientRect();  
    const cx = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;  
    const cy = e.changedTouches ? e.changedTouches[0].clientY : e.clientY;  
    return {  
      x: Math.max(0, Math.min(1, (cx - r.left) / r.width)),  
      y: Math.max(0, Math.min(1, (cy - r.top)  / r.height))  
    };  
  }

  // ────────────────────────────────────────────────────────────  
  // FRAME CAPTURE (the heart of the mobile fix)  
  // ────────────────────────────────────────────────────────────

  function captureFrame() {  
    if (frameCaptured) return;  
    const vw = clipVideo.videoWidth  || 640;  
    const vh = clipVideo.videoHeight || 360;  
    sizeCanvas(vw, vh);

    try {  
      ctx.drawImage(clipVideo, 0, 0, frameCanvas.width, frameCanvas.height);

      // Verify we actually got pixels (not a blank frame)  
      const sample = ctx.getImageData(  
        Math.floor(frameCanvas.width / 2),  
        Math.floor(frameCanvas.height / 2),  
        1, 1  
      ).data;  
      const isBlank = (sample[0] === 0 && sample[1] === 0 &&  
                       sample[2] === 0 && sample[3] === 0);

      if (isBlank) {  
        console.warn("[capture] got blank frame — will retry");  
        return; // don't set frameCaptured; timeupdate will retry  
      }

      // Save full ImageData as backup (iOS can purge the canvas buffer)  
      lastCapturedFrame = ctx.getImageData(0, 0, frameCanvas.width, frameCanvas.height);  
      frameCaptured = true;

      statusAnnotate.textContent = "✓ Final frame captured. Draw your incision line.";  
      statusAnnotate.className   = "status-bar success";  
      btnClear.disabled = false;

      console.log("[capture] frame saved", frameCanvas.width, "×", frameCanvas.height);  
    } catch (err) {  
      console.warn("[capture] drawImage failed:", err);  
    }  
  }

  /**  
   * Fallback capture: if drawImage from video keeps failing (iOS),  
   * create an off-screen <canvas>, seek video, and try there.  
   */  
  function fallbackCapture() {  
    if (frameCaptured) return;  
    console.log("[fallback] attempting OffscreenCanvas / temp canvas capture");

    const vw = clipVideo.videoWidth  || 640;  
    const vh = clipVideo.videoHeight || 360;  
    sizeCanvas(vw, vh);

    const tmp = document.createElement("canvas");  
    tmp.width  = frameCanvas.width;  
    tmp.height = frameCanvas.height;  
    const tmpCtx = tmp.getContext("2d");

    try {  
      tmpCtx.drawImage(clipVideo, 0, 0, tmp.width, tmp.height);  
      const imgData = tmpCtx.getImageData(0, 0, tmp.width, tmp.height);

      const sample = imgData.data;  
      let nonZero = false;  
      for (let i = 0; i < Math.min(sample.length, 400); i += 4) {  
        if (sample[i] || sample[i+1] || sample[i+2]) { nonZero = true; break; }  
      }

      if (nonZero) {  
        ctx.putImageData(imgData, 0, 0);  
        lastCapturedFrame = imgData;  
        frameCaptured = true;  
        statusAnnotate.textContent = "✓ Final frame captured. Draw your incision line.";  
        statusAnnotate.className   = "status-bar success";  
        btnClear.disabled = false;  
        console.log("[fallback] success");  
      }  
    } catch (err) {  
      console.warn("[fallback] failed:", err);  
    }  
  }

  // ────────────────────────────────────────────────────────────  
  // VIDEO LIFECYCLE  
  // ────────────────────────────────────────────────────────────

  function loadClip(index) {  
    if (index >= clipList.length) { showDone(); return; }

    frameCaptured     = false;  
    lastCapturedFrame = null;  
    lineStart = lineEnd = null;  
    hasLine = isDrawing = false;

    btnReplay.disabled = btnSubmit.disabled = btnClear.disabled = true;

    statusAnnotate.textContent = "The final frame appears below shortly.";  
    statusAnnotate.className   = "status-bar info";  
    statusSubmit.textContent   = "Draw the incision on the frozen frame to enable submission.";  
    statusSubmit.className     = "status-bar warn";

    ctx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);

    clipProgress.textContent   = `Clip ${index + 1} of ${clipList.length}`;  
    clipProgressBar.style.width = `${((index) / clipList.length) * 100}%`;

    videoOverlay.textContent = "Loading Clip…";  
    videoOverlay.classList.remove("hidden");

    clipVideo.removeAttribute("src");  
    clipVideo.load();                        // reset

    clipVideo.src = clipList[index];  
    clipVideo.load();  
  }

  // ── Video events ──

  clipVideo.addEventListener("loadedmetadata", () => {  
    console.log("[video] meta", clipVideo.videoWidth, "×", clipVideo.videoHeight,  
                "dur", clipVideo.duration);  
  });

  clipVideo.addEventListener("canplaythrough", function onReady() {  
    videoOverlay.classList.add("hidden");

    clipVideo.play().catch(() => {  
      // Autoplay blocked — show tap-to-play  
      videoOverlay.textContent = "▶ Tap to Play";  
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
   * FIX #1 — Continuously draw frames during playback.  
   * iOS Safari may release the decoded frame once the video is paused  
   * or ended, so the last successfully drawn frame acts as fallback.  
   * Throttled to ~4 fps to be gentle on low-end phones.  
   */  
  let lastDrawTime = 0;  
  clipVideo.addEventListener("timeupdate", () => {  
    if (frameCaptured) return;  
    const now = performance.now();  
    if (now - lastDrawTime < 250) return;  
    lastDrawTime = now;

    const vw = clipVideo.videoWidth  || 640;  
    const vh = clipVideo.videoHeight || 360;  
    if (frameCanvas.width < 2 || frameCanvas.height < 2) sizeCanvas(vw, vh);

    try {  
      ctx.drawImage(clipVideo, 0, 0, frameCanvas.width, frameCanvas.height);  
    } catch (_) {}

    /*  
     * FIX #2 — Freeze ~200 ms before the end so the decoded frame  
     * is still available in the video element's buffer.  
     */  
    if (clipVideo.duration && (clipVideo.duration - clipVideo.currentTime) < 0.25) {  
      clipVideo.pause();  
      // Small delay so browser finishes decoding  
      setTimeout(() => {  
        captureFrame();  
        if (!frameCaptured) fallbackCapture();  
      }, 120);  
    }  
  });

  clipVideo.addEventListener("pause", () => {  
    btnReplay.disabled = false;  
    if (!frameCaptured && clipVideo.currentTime > 0) {  
      setTimeout(() => {  
        captureFrame();  
        if (!frameCaptured) fallbackCapture();  
      }, 150);  
    }  
  });

  clipVideo.addEventListener("ended", () => {  
    btnReplay.disabled = false;  
    if (!frameCaptured) {  
      // Seek slightly back and try  
      try { clipVideo.currentTime = Math.max(0, clipVideo.duration - 0.08); } catch (_) {}  
      setTimeout(() => {  
        captureFrame();  
        if (!frameCaptured) {  
          // one more try after a longer delay  
          setTimeout(() => {  
            captureFrame();  
            if (!frameCaptured) fallbackCapture();  
            if (!frameCaptured) {  
              statusAnnotate.textContent = "⚠ Could not capture frame. Try replaying.";  
              statusAnnotate.className   = "status-bar error";  
            }  
          }, 500);  
        }  
      }, 200);  
    }  
  });

  clipVideo.addEventListener("error", () => {  
    videoOverlay.textContent = "❌ Failed to load clip";  
    videoOverlay.classList.remove("hidden");  
    console.error("[video] error", clipVideo.error);  
  });

  // ── Replay ──  
  btnReplay.addEventListener("click", () => {  
    frameCaptured     = false;  
    lastCapturedFrame = null;  
    lineStart = lineEnd = null;  
    hasLine = isDrawing = false;  
    btnSubmit.disabled = btnClear.disabled = true;

    statusAnnotate.textContent = "The final frame appears below shortly.";  
    statusAnnotate.className   = "status-bar info";  
    statusSubmit.textContent   = "Draw the incision on the frozen frame to enable submission.";  
    statusSubmit.className     = "status-bar warn";

    ctx.clearRect(0, 0, frameCanvas.width, frameCanvas.height);  
    clipVideo.currentTime = 0;  
    clipVideo.play().catch(() => {});  
  });

  // ────────────────────────────────────────────────────────────  
  // CANVAS DRAWING (mouse + touch)  
  // ────────────────────────────────────────────────────────────

  function onDown(e) {  
    if (!frameCaptured) return;  
    e.preventDefault();  
    isDrawing = true;  
    lineStart = canvasCoords(e);  
    lineEnd   = null;  
    hasLine   = false;  
    redrawCanvas();  
  }

  function onMove(e) {  
    if (!isDrawing) return;  
    e.preventDefault();  
    lineEnd = canvasCoords(e);  
    redrawCanvas();  
  }

  function onUp(e) {  
    if (!isDrawing) return;  
    e.preventDefault();  
    isDrawing = false;  
    lineEnd = canvasCoordsEnd(e);

    if (lineStart && lineEnd) {  
      const dx = lineEnd.x - lineStart.x;  
      const dy = lineEnd.y - lineStart.y;  
      if (Math.sqrt(dx * dx + dy * dy) > 0.01) {  
        hasLine = true;  
        btnSubmit.disabled = false;  
        statusSubmit.textContent = "✓ Annotation ready. You may submit.";  
        statusSubmit.className   = "status-bar success";  
      }  
    }  
    redrawCanvas();  
  }

  // Mouse  
  frameCanvas.addEventListener("mousedown",  onDown);  
  frameCanvas.addEventListener("mousemove",  onMove);  
  frameCanvas.addEventListener("mouseup",    onUp);  
  frameCanvas.addEventListener("mouseleave", e => { if (isDrawing) onUp(e); });

  // Touch — passive: false is CRITICAL so preventDefault works  
  frameCanvas.addEventListener("touchstart",  onDown, { passive: false });  
  frameCanvas.addEventListener("touchmove",   onMove, { passive: false });  
  frameCanvas.addEventListener("touchend",    onUp,   { passive: false });  
  frameCanvas.addEventListener("touchcancel", e => { if (isDrawing) onUp(e); });

  /*  
   * FIX #3 — Re-stamp canvas when iOS purges GPU memory  
   * (happens on background/tab switch/memory pressure).  
   */  
  document.addEventListener("visibilitychange", () => {  
    if (!document.hidden && lastCapturedFrame) {  
      requestAnimationFrame(() => redrawCanvas());  
    }  
  });

  window.addEventListener("resize", () => {  
    if (lastCapturedFrame) requestAnimationFrame(() => redrawCanvas());  
  });

  // Prevent pull-to-refresh while touching the canvas area  
  canvasWrap.addEventListener("touchmove", e => e.preventDefault(), { passive: false });

  // ── Clear ──  
  btnClear.addEventListener("click", () => {  
    lineStart = lineEnd = null;  
    hasLine = isDrawing = false;  
    btnSubmit.disabled = true;  
    statusSubmit.textContent = "Draw the incision on the frozen frame to enable submission.";  
    statusSubmit.className   = "status-bar warn";  
    redrawCanvas();  
  });

  // ────────────────────────────────────────────────────────────  
  // SUBMIT  
  // ────────────────────────────────────────────────────────────

  btnSubmit.addEventListener("click", async () => {  
    const email   = emailInput.value.trim();  
    const fatigue = fatigueSelect.value;

    if (!email)   { alert("Please enter your email."); emailInput.focus(); return; }  
    if (!fatigue) { alert("Please select your fatigue level."); return; }  
    if (!hasLine) { alert("Please draw an incision line first."); return; }

    btnSubmit.disabled    = true;  
    btnSubmit.innerHTML   = '<span class="spinner"></span> Sending…';

    const payload = {  
      email,  
      fatigue:    Number(fatigue),  
      clipIndex:  currentClipIndex,  
      clipUrl:    clipList[currentClipIndex],  
      line:       { start: lineStart, end: lineEnd },  
      canvasSize: { w: frameCanvas.width, h: frameCanvas.height },  
      frameImage: (() => { try { return frameCanvas.toDataURL("image/png"); } catch (_) { return null; } })(),  
      timestamp:  new Date().toISOString()  
    };

    try {  
      const res = await fetch(SUBMIT_ENDPOINT, {  
        method: "POST",  
        headers: { "Content-Type": "application/json" },  
        body: JSON.stringify(payload)  
      });  
      if (!res.ok) throw new Error(`Server ${res.status}`);  
      console.log("[submit] OK clip", currentClipIndex);  
    } catch (err) {  
      console.warn("[submit] network error — saving locally:", err);  
      try {  
        localStorage.setItem(`annot_${Date.now()}`, JSON.stringify(payload));  
      } catch (_) {}  
    }

    btnSubmit.innerHTML = "Submit to Investigator and Next Clip ➜";  
    cardConfidence.classList.remove("hidden");  
    cardConfidence.scrollIntoView({ behavior: "smooth" });  
  });

  // ────────────────────────────────────────────────────────────  
  // CONFIDENCE  
  // ────────────────────────────────────────────────────────────

  document.querySelectorAll('input[name="confidence"]').forEach(r => {  
    r.addEventListener("change", () => { btnConfidence.disabled = false; });  
  });

  btnConfidence.addEventListener("click", async () => {  
    const sel = document.querySelector('input[name="confidence"]:checked');  
    if (!sel) return;

    const payload = {  
      email:      emailInput.value.trim(),  
      clipIndex:  currentClipIndex,  
      clipUrl:    clipList[currentClipIndex],  
      confidence: Number(sel.value),  
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

    document.querySelectorAll('input[name="confidence"]').forEach(r => r.checked = false);  
    btnConfidence.disabled = true;  
    cardConfidence.classList.add("hidden");

    currentClipIndex++;  
    clipProgressBar.style.width = `${(currentClipIndex / clipList.length) * 100}%`;

    if (currentClipIndex < clipList.length) {  
      loadClip(currentClipIndex);  
      window.scrollTo({ top: 0, behavior: "smooth" });  
    } else {  
      showDone();  
    }  
  });

  // ────────────────────────────────────────────────────────────  
  // DONE / ERROR  
  // ────────────────────────────────────────────────────────────

  function showDone() {  
    [cardDetails, cardVideo, cardAnnotate, cardSubmit, cardConfidence].forEach(  
      c => c.classList.add("hidden")  
    );  
    clipProgressBar.style.width = "100%";  
    cardDone.classList.remove("hidden");  
  }

  function showError(msg) {  
    errorMessage.textContent = msg;  
    cardError.classList.remove("hidden");  
  }

  // ────────────────────────────────────────────────────────────  
  // BOOT  
  // ────────────────────────────────────────────────────────────

  async function init() {  
    clipProgress.textContent = "Loading clip list…";

    try {  
      // First try without email filter (gets all clips)  
      let clips = await fetchClipList(null);

      // If the CSV is participant-mapped, we'll need the email  
      if (clips.length === 0) {  
        const email = emailInput.value.trim();  
        if (email) {  
          clips = await fetchClipList(email);  
        }  
      }

      if (clips.length === 0) {  
        // Wait for email entry, then reload clip list  
        clipProgress.textContent = "Enter your email above, then clips will load.";  
        emailInput.addEventListener("change", async () => {  
          const email = emailInput.value.trim();  
          if (!email) return;  
          try {  
            clips = await fetchClipList(email);  
            if (clips.length === 0) {  
              showError("No clips found for this email. Please check and try again.");  
              return;  
            }  
            clipList = clips;  
            loadClip(0);  
          } catch (e) {  
            showError("Failed to load clips: " + e.message);  
          }  
        });  
        return;  
      }

      clipList = clips;  
      console.log("[init] loaded", clipList.length, "clips:", clipList);  
      loadClip(0);

    } catch (err) {  
      console.error("[init]", err);  
      showError("Failed to load clip list. Check that " + CLIPS_CSV_PATH + " is accessible.");  
    }  
  }

  init();  
})();  
