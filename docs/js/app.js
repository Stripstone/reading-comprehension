// ===================================
  // READING COMPREHENSION APP
  // ===================================
  
  // ===================================
  // APPLICATION STATE
  // ===================================
  
  const TIERS = [
    { min: TIER_MASTERFUL, name: 'Masterful', emoji: '🏛️' },
    { min: TIER_PROFICIENT, name: 'Proficient', emoji: '📜' },
    { min: TIER_COMPETENT, name: 'Competent', emoji: '📚' },
    { min: TIER_DEVELOPING, name: 'Developing', emoji: '🌱' },
    { min: 0, name: 'Fragmented', emoji: '🧩' }
  ];
  
  let pages = [];
  let pageData = []; // Stores: { text, consolidation, charCount, completedOnTime, isSandstone, rating }
  let timers = [];
  let intervals = [];
  let lastFocusedPageIndex = -1; // for keyboard navigation

  // Diagnostics (hidden panel): capture last AI request/response for bug-fixing
  let lastAIDiagnostics = null;

  let goalTime = DEFAULT_TIME_GOAL;
  let goalCharCount = DEFAULT_CHAR_GOAL;

  const sandSound = document.getElementById("sandSound");
  const stoneSound = document.getElementById("stoneSound");
  const rewardSound = document.getElementById("rewardSound");
  const compassSound = document.getElementById("compassSound");
  const pageTurnSound = document.getElementById("pageTurnSound");
  const evaluateSound = document.getElementById("evaluateSound");
  
  // Set initial volumes
  function loadSavedVolumes() {
    try {
      const raw = localStorage.getItem('rc_volumes');
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveVolumes(v) {
    try { localStorage.setItem('rc_volumes', JSON.stringify(v)); } catch (_) {}
  }

  const savedVol = loadSavedVolumes() || {};
  sandSound.volume = typeof savedVol.sand === 'number' ? savedVol.sand : SAND_VOLUME;
  stoneSound.volume = typeof savedVol.stone === 'number' ? savedVol.stone : STONE_VOLUME;
  rewardSound.volume = typeof savedVol.reward === 'number' ? savedVol.reward : REWARD_VOLUME;
  compassSound.volume = typeof savedVol.compass === 'number' ? savedVol.compass : COMPASS_VOLUME;
  pageTurnSound.volume = typeof savedVol.pageTurn === 'number' ? savedVol.pageTurn : PAGE_TURN_VOLUME;
  evaluateSound.volume = typeof savedVol.evaluate === 'number' ? savedVol.evaluate : EVALUATE_VOLUME;
  music.volume = typeof savedVol.music === 'number' ? savedVol.music : MUSIC_VOLUME;

  // Small helper used by the volume panel
  function setVolume(key, val) {
    const v = Math.max(0, Math.min(1, Number(val)));
    const cur = loadSavedVolumes() || {};
    cur[key] = v;
    saveVolumes(cur);
    if (key === 'sand') sandSound.volume = v;
    if (key === 'stone') stoneSound.volume = v;
    if (key === 'reward') rewardSound.volume = v;
    if (key === 'compass') compassSound.volume = v;
    if (key === 'pageTurn') pageTurnSound.volume = v;
    if (key === 'evaluate') evaluateSound.volume = v;
    if (key === 'music') music.volume = v;
  }
  
  // Set initial input values from constants
  document.getElementById("goalTimeInput").value = DEFAULT_TIME_GOAL;
  document.getElementById("goalCharInput").value = DEFAULT_CHAR_GOAL;

  
  // ===================================
  // 📚 BOOK IMPORT (manifest-based)
  // ===================================
  // Notes:
  // - Static hosts cannot list directories. We rely on a manifest at: assets/books/index.json
  // - Loading a selection fills #bulkInput, then calls addPages() (existing behavior preserved).

  function titleFromBookId(id) {
    if (!id) return "";
    let t = String(id);
    t = t.replace(/^BOOK[_-]*/i, "");
    t = t.replace(/[_-]+/g, " ");
    t = t.replace(/([a-z])([A-Z])/g, "$1 $2");
    return t.trim().replace(/\s+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  function splitIntoPages(raw) {
    const input = String(raw || "").trim();
    if (!input) return [];
    const out = [];
    input.split(/\n---\n|\n## Page\s+\d+/i).forEach(c => {
      const cleaned = c.split("\n").map(l => l.trim()).filter(l => l && !/^[#—]/.test(l));
      if (cleaned.length) out.push(cleaned.join(" "));
    });
    return out;
  }

  function parseChaptersFromMarkdown(raw) {
    const text = String(raw || "");
    const lines = text.split(/\r?\n/);

    const chapters = [];
    let current = null;

    function pushCurrent() {
      if (!current) return;
      const rawText = current.rawLines.join("\n").trim();
      if (rawText) chapters.push({ title: current.title, raw: rawText });
    }

    for (const line of lines) {
      // H1 headings define chapters
      const h1 = line.match(/^\s{0,3}#\s+(.*)\s*$/);
      if (h1) {
        pushCurrent();
        const title = (h1[1] || "").trim() || `Chapter ${chapters.length + 1}`;
        current = { title, rawLines: [] };
        continue;
      }

      // Everything else belongs to the current chapter (or implicit intro)
      if (!current) current = { title: "Introduction", rawLines: [] };
      current.rawLines.push(line);
    }

    pushCurrent();
    return chapters;
  }

  async function initBookImporter() {
    const sourceSel = document.getElementById("importSource");
    const bookControls = document.getElementById("bookControls");
    const textControls = document.getElementById("textControls");
    const bookSelect = document.getElementById("bookSelect");
    const chapterControls = document.getElementById("chapterControls");
    const chapterSelect = document.getElementById("chapterSelect");
    const pageControls = document.getElementById("pageControls");
    const pageStart = document.getElementById("pageStart");
    const pageEnd = document.getElementById("pageEnd");
    const loadBtn = document.getElementById("loadBookSelection");
    const bulkInput = document.getElementById("bulkInput");

    if (!sourceSel || !bookControls || !bookSelect || !chapterControls || !chapterSelect || !pageControls || !pageStart || !pageEnd || !loadBtn || !bulkInput) {
      console.warn("Book importer: missing required elements");
      return;
    }

    let manifest = [];
    let currentBookRaw = "";
    let hasExplicitChapters = false;

    // When chapters exist, we keep chapter pages in memory
    let chapterList = []; // {title, raw}
    let currentPages = []; // [{title, text}]
    let currentChapterIndex = null;

    function setSourceUI() {
      const isBook = sourceSel.value === "book";
      bookControls.style.display = isBook ? "flex" : "none";
      if (textControls) textControls.style.display = isBook ? "none" : "block";
    }

    function countExplicitH1(text) {
      const lines = String(text || "").split(/\r?\n/);
      let count = 0;
      for (const line of lines) if (/^\s{0,3}#\s+/.test(line)) count++;
      return count;
    }

    function parsePagesWithTitles(raw) {
      const text = String(raw || "");
      const lines = text.split(/\r?\n/);

      const pages = [];
      let cur = null;

      function push() {
        if (!cur) return;
        const cleaned = cur.lines
          .map(l => l.trim())
          .filter(l => l && !/^\s{0,3}#{1,6}\s+/.test(l) && !/^\s*[—-]{2,}\s*$/.test(l));

        const body = cleaned.join(" ").trim();
        if (body) pages.push({ title: cur.title, text: body });
      }

      for (const line of lines) {
        const h2 = line.match(/^\s{0,3}##\s+(.*)\s*$/);
        if (h2) {
          push();
          const title = (h2[1] || "").trim() || `Page ${pages.length + 1}`;
          cur = { title, lines: [] };
          continue;
        }
        if (!cur) cur = { title: "Page 1", lines: [] };
        cur.lines.push(line);
      }
      push();

      // Fallback: if no H2 pages were detected, try --- separators
      if (pages.length <= 1) {
        const blocks = String(raw || "").trim().split(/\n---\n/g);
        if (blocks.length > 1) {
          const out = [];
          blocks.forEach((blk, i) => {
            const cleaned = blk.split(/\r?\n/)
              .map(l => l.trim())
              .filter(l => l && !/^\s{0,3}#{1,6}\s+/.test(l) && !/^\s*[—-]{2,}\s*$/.test(l));
            const body = cleaned.join(" ").trim();
            if (body) out.push({ title: `Page ${out.length + 1}`, text: body });
          });
          return out.length ? out : pages;
        }
      }

      return pages;
    }

    function setSelectOptions(selectEl, options, placeholder) {
      selectEl.innerHTML = "";
      if (placeholder) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = placeholder;
        selectEl.appendChild(opt);
      }
      options.forEach((o) => {
        const opt = document.createElement("option");
        opt.value = String(o.value);
        opt.textContent = o.label;
        selectEl.appendChild(opt);
      });
    }

    function populatePagesSelect(pages) {
      currentPages = pages || [];
      if (!currentPages.length) {
        setSelectOptions(pageStart, [], "No pages detected");
        setSelectOptions(pageEnd, [], "No pages detected");
        return;
      }

      const opts = currentPages.map((p, idx) => ({
        value: idx,
        label: `${idx + 1}. ${p.title || `Page ${idx + 1}`}`
      }));

      setSelectOptions(pageStart, opts, "Start page…");
      setSelectOptions(pageEnd, opts, "End page…");

      // Default to full range
      pageStart.value = "0";
      pageEnd.value = String(currentPages.length - 1);
    }

    function getCurrentChapterRaw() {
      if (hasExplicitChapters && Number.isFinite(currentChapterIndex) && chapterList[currentChapterIndex]) {
        return chapterList[currentChapterIndex].raw;
      }
      return currentBookRaw;
    }

    function refreshChapterAndPagesUI() {
      // Chapters present?
      if (!hasExplicitChapters) {
        chapterControls.style.display = "none";
        currentChapterIndex = null;
        const pages = parsePagesWithTitles(currentBookRaw);
        populatePagesSelect(pages);
        return;
      }

      chapterControls.style.display = "flex";
      const chapOpts = chapterList.map((ch, idx) => ({ value: idx, label: ch.title || `Chapter ${idx + 1}` }));
      setSelectOptions(chapterSelect, chapOpts, "Select a chapter…");
      chapterSelect.value = "0";
      currentChapterIndex = 0;

      const pages = parsePagesWithTitles(getCurrentChapterRaw());
      populatePagesSelect(pages);
    }

    async function loadManifest() {
      const candidates = [
        "assets/books/index.json",
        "index.json"
      ];

      let lastErr = null;
      for (const path of candidates) {
        try {
          const res = await fetch(path, { cache: "no-cache" });
          if (!res.ok) throw new Error(`manifest fetch failed (${res.status}) at ${path}`);
          const data = await res.json();
          manifest = (Array.isArray(data) ? data : []).map((b) => {
            const id = b.id || b.name || "";
            const p = b.path || (id ? `assets/books/${id}.md` : "");
            const title = b.title || titleFromBookId(id) || id || "Untitled";
            return { id, title, path: p };
          }).filter(b => b.id && b.path);

          return;
        } catch (e) {
          lastErr = e;
        }
      }
      // Fallback for local file:// usage (fetch is often blocked). If an embedded manifest exists, use it.
      try {
        if (window.EMBED_MANIFEST && Array.isArray(window.EMBED_MANIFEST)) {
          const data = window.EMBED_MANIFEST;
          manifest = (Array.isArray(data) ? data : []).map((b) => {
            const id = b.id || b.name || "";
            const p = b.path || (id ? `assets/books/${id}.md` : "");
            const title = b.title || titleFromBookId(id) || id || "Untitled";
            return { id, title, path: p };
          }).filter(b => b.id && b.path);
          return;
        }
      } catch (_) {}
      throw lastErr || new Error("manifest fetch failed");
    }

    async function loadBook(id) {
      currentBookRaw = "";
      chapterList = [];
      hasExplicitChapters = false;
      currentChapterIndex = null;

      setSelectOptions(chapterSelect, [], "Loading…");
      setSelectOptions(pageStart, [], "Loading…");
      setSelectOptions(pageEnd, [], "Loading…");

      const entry = manifest.find(b => b.id === id);
      if (!entry) {
        setSelectOptions(chapterSelect, [], "Select a book first");
        setSelectOptions(pageStart, [], "Select a book first");
        setSelectOptions(pageEnd, [], "Select a book first");
        return;
      }

      try {
        const res = await fetch(entry.path, { cache: "no-cache" });
        if (!res.ok) throw new Error(`book fetch failed (${res.status}) at ${entry.path}`);
        currentBookRaw = await res.text();

        hasExplicitChapters = countExplicitH1(currentBookRaw) > 0;
        if (hasExplicitChapters) {
          chapterList = parseChaptersFromMarkdown(currentBookRaw);
        }

        refreshChapterAndPagesUI();
      } catch (e) {
        // Fallback for local file:// usage: try embedded books
        try {
          if (window.EMBED_BOOKS && typeof window.EMBED_BOOKS[id] === "string") {
            currentBookRaw = window.EMBED_BOOKS[id];
            hasExplicitChapters = countExplicitH1(currentBookRaw) > 0;
            if (hasExplicitChapters) {
              chapterList = parseChaptersFromMarkdown(currentBookRaw);
            }
            refreshChapterAndPagesUI();
            return;
          }
        } catch (_) {}

        setSelectOptions(chapterSelect, [], "Failed to load book");
        setSelectOptions(pageStart, [], "Failed to load book");
        setSelectOptions(pageEnd, [], "Failed to load book");
        console.error("Book load error:", e);
      }
    }

    function applySelectionToBulkInput(text) {
      bulkInput.value = String(text || "").trim();
      addPages();
    }

    // Events
    sourceSel.addEventListener("change", setSourceUI);
    setSourceUI();

    bookSelect.addEventListener("change", async () => {
      const id = bookSelect.value;
      if (!id) return;
      await loadBook(id);
    });

    chapterSelect.addEventListener("change", () => {
      const idx = parseInt(chapterSelect.value || "", 10);
      if (!Number.isFinite(idx)) return;
      currentChapterIndex = idx;
      const pages = parsePagesWithTitles(getCurrentChapterRaw());
      populatePagesSelect(pages);
    });

    // Keep end >= start
    pageStart.addEventListener("change", () => {
      const s = parseInt(pageStart.value || "0", 10);
      const e = parseInt(pageEnd.value || "0", 10);
      if (Number.isFinite(s) && Number.isFinite(e) && e < s) pageEnd.value = String(s);
    });
    pageEnd.addEventListener("change", () => {
      const s = parseInt(pageStart.value || "0", 10);
      const e = parseInt(pageEnd.value || "0", 10);
      if (Number.isFinite(s) && Number.isFinite(e) && e < s) pageStart.value = String(e);
    });

    loadBtn.addEventListener("click", () => {
      // Dual-purpose button: in Text mode, it just loads pages from the textarea.
      if (sourceSel.value === "text") {
        addPages();
        return;
      }

      // Book mode: load selected book/page slice into the textarea, then add pages.
      if (!currentBookRaw) return;
      if (!currentPages.length) return;

      const s = Math.max(0, parseInt(pageStart.value || "0", 10));
      const e = Math.max(s, parseInt(pageEnd.value || String(s), 10));

      const slice = currentPages
        .slice(s, e + 1)
        .map((p) => p.text)
        .filter(Boolean);
      // Keep delimiter in a single JS string line (prevents accidental raw-newline parse errors)
      applySelectionToBulkInput(slice.join("\n---\n"));
    });

    try {
      await loadManifest();
      // Populate book select
      bookSelect.innerHTML = "";
      if (manifest.length === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No books found";
        bookSelect.appendChild(opt);
        return;
      }
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select a book…";
      bookSelect.appendChild(placeholder);

      manifest.forEach((b) => {
        const opt = document.createElement("option");
        opt.value = b.id;
        opt.textContent = b.title;
        bookSelect.appendChild(opt);
      });
    } catch (e) {
      bookSelect.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Failed to load manifest";
      bookSelect.appendChild(opt);
      console.error("Book manifest load error:", e);
    }
  }



function addPages() {
    const input = document.getElementById("bulkInput").value.trim();
    goalTime = parseInt(document.getElementById("goalTimeInput").value);
    goalCharCount = parseInt(document.getElementById("goalCharInput").value);
    if (!input) return;

    // UX rule: whenever user generates new pages, start fresh (no leftover pages)
    if (pages.length > 0) resetSession({ confirm: false });

    input.split(/\n---\n|\n## Page\s+\d+/i).forEach(c => {
      const cleaned = c.split("\n").map(l => l.trim()).filter(l => l && !/^[# ]/.test(l));
      if (cleaned.length) {
        pages.push(cleaned.join(" "));
        pageData.push({
          text: cleaned.join(" "),
          consolidation: "",
          aiFeedbackRaw: "",
          charCount: 0,
          completedOnTime: true, // Assume true until sandstoned
          isSandstone: false,
          rating: 0
        });
      }
    });

    document.getElementById("bulkInput").value = "";
    render();
    checkSubmitButton();
  }

  function resetSession({ confirm = true } = {}) {
    if (confirm && !window.confirm("Clear all pages, consolidations, and timers?")) return false;
    pages = [];
    pageData = [];
    timers = [];
    intervals.forEach(i => clearInterval(i));
    intervals = [];
    sandSound.pause();
    document.getElementById("pages").innerHTML = "";
    document.getElementById("submitBtn").disabled = true;
    document.getElementById("verdictSection").style.display = "none";
    lastFocusedPageIndex = -1;
    return true;
  }

  function render() {
    const container = document.getElementById("pages");
    container.innerHTML = "";

    pages.forEach((text, i) => {
      timers[i] ??= 0;

      const page = document.createElement("div");
      page.className = "page";

      page.innerHTML = `
        <div class="page-header">Page ${i + 1}</div>
        <div class="page-text">${text}</div>
        <div class="page-header">Consolidation</div>

        <div class="sand-wrapper">
          <textarea placeholder="What was this page really about?"></textarea>
          <div class="sand-layer"></div>
        </div>

        <div class="info-row">
          <div class="counter-section">
            <div class="timer">Timer: ${timers[i]} / ${goalTime}</div>
            <div class="char-counter">Characters: <span class="char-count">0</span> / ${goalCharCount}</div>
          </div>

          <div class="evaluation-section">
            <div class="evaluation-label">Evaluation</div>
            <div class="stars locked" data-page="${i}">
              <span class="star" data-value="1">🧭</span>
              <span class="star" data-value="2">🧭</span>
              <span class="star" data-value="3">🧭</span>
              <span class="star" data-value="4">🧭</span>
              <span class="star" data-value="5">🧭</span>
            </div>
          </div>

          <div class="action-buttons">
            <button class="top-btn" onclick="goToNext(${i})">▶ Next</button>
            <button class="ai-btn" data-page="${i}" style="display: none;">▼ AI&nbsp;&nbsp;</button>
          </div>
        </div>
        
        <div class="ai-feedback" data-page="${i}" style="display: none;">
          <!-- AI feedback will be inserted here -->
        </div>
      `;

      const textarea = page.querySelector("textarea");
      const sand = page.querySelector(".sand-layer");
      const timerDiv = page.querySelector(".timer");
      const wrapper = page.querySelector(".sand-wrapper");
      const charCountSpan = page.querySelector(".char-count");
      const starsDiv = page.querySelector(".evaluation-section .stars");

      // Character tracking
      textarea.value = pageData[i].consolidation || "";
      charCountSpan.textContent = Math.min(pageData[i].charCount, goalCharCount);
      
      textarea.addEventListener("input", (e) => {
        const count = e.target.value.length;
        pageData[i].consolidation = e.target.value;
        pageData[i].charCount = count;
        charCountSpan.textContent = Math.min(count, goalCharCount);
        
        // Check if all pages have text to unlock compasses
        checkCompassUnlock();
      });

      // Timer events
      textarea.addEventListener("focus", () => {
        
        lastFocusedPageIndex = i;
// Scroll to show entire page card (passage + textarea) instead of centering on textarea
        const pageCard = textarea.closest('.page');
        pageCard.scrollIntoView({ 
          behavior: 'instant',
          block: 'start',
          inline: 'nearest'
        });
        
        // Page turn immersion: activate stripe if starting fresh
        if (pageData[i].charCount === 0) {
          page.classList.add('page-active');
          if (!allSoundsMuted) {
            pageTurnSound.currentTime = 0;
            pageTurnSound.play();
          }
        }
        startTimer(i, sand, timerDiv, wrapper, textarea);
      });
      
      textarea.addEventListener("blur", () => {
        // Deactivate page stripe when leaving
        page.classList.remove('page-active');
        stopTimer(i);
        checkCompassUnlock(); // Check if compasses should unlock when user leaves textarea
      });


      // Keyboard navigation (iPad + desktop)
      textarea.addEventListener("keydown", (e) => {
        // Enter: unfocus textarea (Shift+Enter remains normal newline behavior)
        // This makes iPad flow smoother: user can hit Enter to dismiss keyboard,
        // then press Enter again (global) to jump to next box or click AI.
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          // Prevent the global Enter handler from running in the same event.
          // (blur changes activeElement, which would otherwise trigger goToNext).
          e.stopPropagation();
          textarea.blur();
          return;
        }

        // Esc: unfocus textarea
        if (e.key === "Escape") {
          e.preventDefault();
          textarea.blur();
        }
      });

      // Compass click handlers
      const stars = starsDiv.querySelectorAll(".star");
      stars.forEach(star => {
        star.addEventListener("click", () => {
          if (starsDiv.classList.contains("locked")) return;
          const value = parseInt(star.dataset.value);
          setRating(i, value, stars);
        });
      });
      
      // AI button click handler
      const aiBtn = page.querySelector(".ai-btn");
      if (aiBtn) {
        aiBtn.addEventListener("click", () => evaluatePageWithAI(i));
      }
      
      // Restore previous rating if exists
      if (pageData[i].rating > 0) {
        const evalStars = starsDiv.querySelectorAll(".star");
        evalStars.forEach((star, starIdx) => {
          if (starIdx < pageData[i].rating) {
            star.classList.add("filled");
          }
        });
        // Stop animation since this page is already rated
        starsDiv.classList.add('rated');
      }
      
      // Restore sandstone state if applicable
      if (pageData[i].isSandstone) {
        wrapper.classList.add("sandstone");
        textarea.readOnly = true;
        const evalStars = page.querySelector(".evaluation-section .stars");
        evalStars.classList.add("locked");
        evalStars.style.opacity = "0.15";
        sand.style.height = "100%";
      } else if (timers[i] > 0) {
        // Restore partial sand if timer was running
        const sandStartTime = goalTime * (1 - SAND_START_PERCENTAGE);
	const sandDuration = goalTime * SAND_START_PERCENTAGE;
        if (timers[i] >= sandStartTime) {
          const sandElapsed = timers[i] - sandStartTime;
          const pct = Math.min(sandElapsed / sandDuration, 1);
          sand.style.height = `${pct * 100}%`;
        }
      }

      container.appendChild(page);
    });
    
    // Check states after rendering
    checkCompassUnlock();
    checkSubmitButton();
  }

  function startTimer(i, sand, timerDiv, wrapper, textarea) {
    if (intervals[i]) return;

    let sandSoundStarted = false;

    intervals[i] = setInterval(() => {
      timers[i]++;
      
      // Sand starts when configured percentage of time remains
      const sandStartTime = goalTime * (1 - SAND_START_PERCENTAGE);
      const sandDuration = goalTime * SAND_START_PERCENTAGE;
      
      if (timers[i] >= sandStartTime) {
        // Start sand sound when sand starts (if not muted)
        if (!sandSoundStarted) {
          sandSound.currentTime = 0;
          if (!allSoundsMuted) {
            if (window.playSfx) window.playSfx(sandSound, { restart: true, loop: true, retries: 3, delay: 120 });
            else sandSound.play();
          }
          sandSoundStarted = true;
        }
        
        const sandElapsed = timers[i] - sandStartTime;
        const pct = Math.min(sandElapsed / sandDuration, 1);
        sand.style.height = `${pct * 100}%`;
      }
      
      timerDiv.textContent = `Timer: ${timers[i]} / ${goalTime}`;

      if (timers[i] >= goalTime) {
        clearInterval(intervals[i]);
        intervals[i] = null;

        sandSound.pause();
        if (!allSoundsMuted) {
          stoneSound.currentTime = 0;
          if (window.playSfx) window.playSfx(stoneSound, { restart: true, loop: false, retries: 4, delay: 160 });
          else stoneSound.play();
        }

        wrapper.classList.add("sandstone");
        textarea.readOnly = true;
        textarea.blur();
        
        // Mark page as sandstoned and failed timing
        pageData[i].isSandstone = true;
        pageData[i].completedOnTime = false;
        
        // Block compasses on this page permanently
        const starsDiv = wrapper.closest(".page").querySelector(".evaluation-section .stars");
        starsDiv.classList.add("locked");
        starsDiv.style.opacity = "0.15";
        
        checkSubmitButton();
      }
    }, 1000);
  }

  function stopTimer(i) {
    clearInterval(intervals[i]);
    intervals[i] = null;
    sandSound.pause();
  }

  function clearSession() {
    resetSession({ confirm: true });
  }

  // ===================================
  // 🧭 COMPASS & SUBMISSION LOGIC
  // ===================================
  
  function checkCompassUnlock() {
    // UX rule:
    // - Allow AI feedback page-by-page (show AI button once that page has text)
    // - Do NOT allow compass rating until ALL pages have at least 1 character AND no textarea is focused
    const allHaveText = pageData.every(p => p.isSandstone || p.charCount > 0);
    const noTextareaFocused = document.activeElement.tagName !== 'TEXTAREA';

    const allPages = document.querySelectorAll(".page");
    allPages.forEach((pageEl, i) => {
      const aiBtn = pageEl.querySelector(".ai-btn");
      if (aiBtn) {
        const canShowAI = !pageData[i]?.isSandstone && (pageData[i]?.charCount || 0) > 0;
        aiBtn.style.display = canShowAI ? 'block' : 'none';
      }
    });

    if (!(allHaveText && noTextareaFocused)) return;

    let anyUnlocked = false;
    allPages.forEach((pageEl, i) => {
      const starsDiv = pageEl.querySelector(".stars");
      const evalSection = pageEl.querySelector(".evaluation-section");
      if (!pageData[i].isSandstone && starsDiv) {
        starsDiv.classList.remove("locked");
        if (!starsDiv.classList.contains('rated') && evalSection) {
          evalSection.classList.add('ready');
          anyUnlocked = true;
        }

        // If this page already has an AI response rendered, enabling compasses
        // should also enable the "Use This Rating" button.
        updateUseRatingButtons(i);
      }
    });

    if (anyUnlocked && !allSoundsMuted) {
      evaluateSound.currentTime = 0;
      if (window.playSfx) window.playSfx(evaluateSound, { restart: true, loop: false, retries: 2, delay: 120 });
      else evaluateSound.play();
    }
  }

  // "Use This Rating" should only be clickable once the page is in Evaluation stage.
  function canUseAIRating(pageIndex) {
    const pageEl = document.querySelectorAll('.page')[pageIndex];
    if (!pageEl) return false;
    if (pageData?.[pageIndex]?.isSandstone) return false;
    const starsDiv = pageEl.querySelector('.evaluation-section .stars');
    const evalSection = pageEl.querySelector('.evaluation-section');
    if (!starsDiv || !evalSection) return false;
    return !starsDiv.classList.contains('locked') && evalSection.classList.contains('ready');
  }

  function updateUseRatingButtons(pageIndex) {
    const feedbackDiv = document.querySelector(`.ai-feedback[data-page="${pageIndex}"]`);
    if (!feedbackDiv) return;
    const useBtn = feedbackDiv.querySelector('.use-rating-btn');
    if (!useBtn) return;
    const rating = Number(useBtn.getAttribute('data-rating') || '0');
    const enabled = rating > 0 && canUseAIRating(pageIndex);
    useBtn.disabled = !enabled;
    useBtn.title = enabled ? '' : 'Locked until Evaluation stage.';
  }

  function scrollToTop() {
    const firstPage = document.querySelector('.page');
    if (firstPage) {
      firstPage.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  }

  function goToNext(currentIndex) {
    // Move to the next consolidation textarea; if none remain, go to top.
    // currentIndex is the page index the user is "on" (0-based). Use -1 to start from the beginning.
    const textareas = document.querySelectorAll('.page textarea');
    for (let j = currentIndex + 1; j < textareas.length; j++) {
      const ta = textareas[j];
      if (ta && !ta.readOnly && !ta.disabled) {
        ta.focus();
        return;
      }
    }

    // none remain → force unlock sequence
    const active = document.activeElement;
    if (active && active.tagName === "TEXTAREA") active.blur();
    checkCompassUnlock();
    scrollToTop();
  }

  // Global keyboard navigation:
  // - Enter (when not in a textarea): go to next consolidation box
  // - Esc (when in a textarea): unfocus textarea
  document.addEventListener("keydown", (e) => {
    // Esc handled per-textarea; this is a backup for cases where focus is on something else.
    if (e.key === "Escape") {
      const active = document.activeElement;
      if (active && active.tagName === "TEXTAREA") {
        e.preventDefault();
        active.blur();
      }
      return;
    }

    if (e.key !== "Enter" || e.shiftKey) return;

    const active = document.activeElement;
    if (active && active.tagName === "TEXTAREA") return;

    e.preventDefault();

    // If user has never focused a page yet, treat as start
    const startIndex = (lastFocusedPageIndex === -1) ? -1 : lastFocusedPageIndex;
    goToNext(startIndex);

  });



  async function evaluatePageWithAI(pageIndex) {
    const aiBtn = document.querySelector(`.ai-btn[data-page="${pageIndex}"]`);
    const feedbackDiv = document.querySelector(`.ai-feedback[data-page="${pageIndex}"]`);
    if (!aiBtn || !feedbackDiv) return;

    // Toggle if already open
    if (feedbackDiv.style.display === 'block') {
      feedbackDiv.style.display = 'none';
      aiBtn.textContent = '▼ AI';
      return;
    }

    aiBtn.textContent = '⏳ Loading...';
    aiBtn.classList.add('loading');
    feedbackDiv.style.display = 'block';
    feedbackDiv.innerHTML = '<div style="text-align: center; opacity: 0.6;">Analyzing...</div>';

    const page = pageData[pageIndex];
    const pageElement = document.querySelectorAll('.page')[pageIndex];
    const passageText = pageElement.querySelector('.page-text').textContent;
    const userText = page?.consolidation || "";

    const requestPayload = {
      pageText: passageText,
      userText: userText,
      betterCharLimit: goalCharCount,
      bulletMaxChars: 110
    };

    try {
      const response = await fetch("https://reading-comprehension-rpwd.vercel.app/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });

      const rawText = await response.text();
      if (!response.ok) {
        lastAIDiagnostics = {
          kind: 'evaluate',
          pageIndex,
          status: response.status,
          request: requestPayload,
          responseText: rawText,
          at: new Date().toISOString()
        };
        throw new Error(rawText);
      }

      const data = JSON.parse(rawText || "{}");
      lastAIDiagnostics = {
        kind: 'evaluate',
        pageIndex,
        status: response.status,
        request: requestPayload,
        responseText: rawText,
        // If the API returned debug info, keep it out of the normal UI and only
        // expose it via the diagnostics panel.
        debug: data && data.debug ? data.debug : undefined,
        at: new Date().toISOString()
      };
      displayAIFeedback(pageIndex, data.feedback || "");

      aiBtn.textContent = '▲ AI';
      aiBtn.classList.remove('loading');
    } catch (error) {
      console.error('AI evaluation error:', error);
      if (!lastAIDiagnostics) {
        lastAIDiagnostics = {
          kind: 'evaluate',
          pageIndex,
          status: 0,
          request: requestPayload,
          responseText: String(error?.message || error || ''),
          at: new Date().toISOString()
        };
      }
      feedbackDiv.innerHTML =
        '<div style="color: #8B2500;">Error getting AI feedback. Check console and verify AI Host is running.</div>';
      aiBtn.textContent = '▼ AI';
      aiBtn.classList.remove('loading');
    }
  }

  function displayAIFeedback(pageIndex, feedback) {
    const feedbackDiv = document.querySelector(`.ai-feedback[data-page="${pageIndex}"]`);
    if (!feedbackDiv) return;

    // Persist raw feedback so Final Summary can reuse it later.
    if (pageData?.[pageIndex]) {
      pageData[pageIndex].aiFeedbackRaw = String(feedback || "");
    }

    // Robust parsing:
    // - Works with \n or \r\n
    // - Tolerates extra lines (rare model drift)
    // - Accepts quoted or unquoted "better consolidation" line
    // - Accepts label variants: "Better consolidation:", "Example of Strong Consolidation:", "**Strong Consolidation:**"
    const rawLines = String(feedback || "")
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    // 1) Rating (🧭🧭⚪⚪⚪ (2/5))
    const ratingLine = rawLines.find(l => /[🧭⚪]+\s*\(\d\/5\)/.test(l)) || "";
    const ratingMatch = ratingLine.match(/([🧭⚪]+)\s*\((\d)\/5\)/);
    const rating = ratingMatch ? parseInt(ratingMatch[2], 10) : 0;

    // 2) Analysis: first non-rating line after the rating line
    let analysis = "";
    const ratingIdx = rawLines.indexOf(ratingLine);
    if (ratingIdx >= 0) {
      analysis = rawLines.slice(ratingIdx + 1).find(l => !/better consolidation/i.test(l) && !/strong consolidation/i.test(l)) || "";
    } else {
      analysis = rawLines[1] || "";
    }

    // 3) Better consolidation: locate label, then take remaining lines
    const labelIdx = rawLines.findIndex(l =>
      /^better consolidation\s*:?\s*$/i.test(l) ||
      /^example of strong consolidation\s*:?\s*$/i.test(l) ||
      /^\*\*strong consolidation:\*\*\s*$/i.test(l) ||
      /^strong consolidation\s*:?\s*$/i.test(l)
    );

    let betterExample = "";
    if (labelIdx >= 0) {
      const after = rawLines.slice(labelIdx + 1);
      if (after.length) betterExample = after.join(" ");

      // Strip optional surrounding quotes
      betterExample = betterExample.replace(/^"+/, "").replace(/"+$/, "").trim();

      // Strip the optional trailing "This consolidation..." sentence if included
      betterExample = betterExample.replace(/\s*This consolidation\b.*$/i, "").trim();
    } else if (rawLines.length >= 4) {
      // Back-compat: exactly 4 lines
      betterExample = rawLines[3].replace(/^"+/, "").replace(/"+$/, "").trim();
    }

    // Build HTML
    let html = '';

    if (ratingMatch) {
      html += `<div class="ai-rating">${ratingMatch[1]} <span class="ai-score">(${rating}/5)</span></div>`;
    }

    if (analysis) {
      html += `<div class="ai-analysis">${analysis}</div>`;
    }

    if (betterExample) {
      html += `<div class="better-example">
        <div class="better-label">Better consolidation:</div>
        "${betterExample}"
      </div>`;
    }

    // Actions: "Use This Rating" is disabled until the page reaches Evaluation stage.
    const useDisabled = !(rating > 0 && canUseAIRating(pageIndex));
    html += `<div class="ai-actions">`
    html += `<button class="use-rating-btn" data-rating="${rating}" ${useDisabled ? 'disabled' : ''} onclick="applyAIRating(${pageIndex}, ${rating})">Use This Rating (${rating}/5)</button>`;
    html += `<button class="next-after-ai-btn" onclick="goToNext(${pageIndex})">Next Page →</button>`;
    html += `</div>`;
    feedbackDiv.innerHTML = html;

    // In case the compass unlock happens after AI renders, keep button state synced.
    updateUseRatingButtons(pageIndex);
  }


  function applyAIRating(pageIndex, rating) {
    const starsDiv = document.querySelector(`.stars[data-page="${pageIndex}"]`);
    if (!starsDiv) return;
    
    const stars = starsDiv.querySelectorAll(".star");
    setRating(pageIndex, rating, stars);
  }

  function setRating(pageIndex, value, stars) {
    pageData[pageIndex].rating = value;
    
    // Play compass click sound
    if (!allSoundsMuted) {
      compassSound.currentTime = 0;
      compassSound.play();
    }
    
    // Mark this compass group as rated (stops animation)
    const starsDiv = stars[0].closest('.stars');
    starsDiv.classList.add('rated');
    
    // Stop label glow animation
    const evalSection = starsDiv.closest('.evaluation-section');
    evalSection.classList.remove('ready');
    
    // Fill stars up to the clicked value
    stars.forEach((star, i) => {
      if (i < value) {
        star.classList.add("filled");
      } else {
        star.classList.remove("filled");
      }
    });
    
    checkSubmitButton();
  }

  function checkSubmitButton() {
    // Enable submit when all non-sandstone pages have been rated
    const nonSandstonePages = pageData.filter(p => !p.isSandstone);
    
    // If all pages are sandstone, enable immediately
    if (nonSandstonePages.length === 0 && pageData.length > 0) {
      document.getElementById("submitBtn").disabled = false;
      return;
    }
    
    // Otherwise check if all non-sandstone pages are rated
    const allRated = nonSandstonePages.every(p => p.rating > 0);
    document.getElementById("submitBtn").disabled = !allRated;
  }

  // ===================================
  // ðŸ“Š EVALUATION & TIER SYSTEM
  // ===================================
  
  function calculateScores() {
    const totalPages = pageData.length;
    if (totalPages === 0) return null;
    
    // 1. Comprehension Score (55 pts) - compass self-evaluation
    const nonSandstonePages = pageData.filter(p => !p.isSandstone);
    let comprehensionScore = 0;
    if (nonSandstonePages.length > 0) {
      const totalRating = nonSandstonePages.reduce((sum, p) => sum + p.rating, 0);
      const avgRating = totalRating / nonSandstonePages.length;
      comprehensionScore = (avgRating / 5) * WEIGHT_COMPREHENSION;
    }
    
    // 2. Discipline Score (25 pts) - completed on time with gradient penalty for insufficient length
    // Full credit if >= 90% of goal, proportional penalty if below
    const minChars = Math.floor(goalCharCount * (1 - COMPRESSION_TOLERANCE));
    let disciplineScore = 0;
    
    pageData.forEach(p => {
      if (!p.completedOnTime) {
        // Sandstoned: no points
        disciplineScore += 0;
      } else if (p.charCount >= minChars) {
        // Met 90% threshold: full points
        disciplineScore += WEIGHT_DISCIPLINE;
      } else {
        // Below threshold: proportional credit (0 to minChars range)
        disciplineScore += (p.charCount / minChars) * WEIGHT_DISCIPLINE;
      }
    });
    disciplineScore = disciplineScore / totalPages;
    
    // 3. Compression Score (20 pts) - character count sweet spot
    let compressionScore = 0;
    pageData.forEach(p => {
      const chars = p.charCount;
      const goal = goalCharCount;
      const sweetSpotMin = Math.floor(goal * (1 - COMPRESSION_TOLERANCE));
      const sweetSpotMax = Math.ceil(goal * (1 + COMPRESSION_TOLERANCE));
      
      if (chars < sweetSpotMin) {
        // Under sweet spot: proportional penalty
        compressionScore += (chars / goal) * WEIGHT_COMPRESSION;
      } else if (chars <= sweetSpotMax) {
        // In sweet spot: full points
        compressionScore += WEIGHT_COMPRESSION;
      } else {
        // Over sweet spot: penalty
        const overAmount = chars - sweetSpotMax;
        const penalty = (overAmount / goal) * WEIGHT_COMPRESSION;
        compressionScore += Math.max(0, WEIGHT_COMPRESSION - penalty);
      }
    });
    compressionScore = compressionScore / totalPages;
    
    const totalScore = comprehensionScore + disciplineScore + compressionScore;
    
    return {
      comprehension: Math.round(comprehensionScore * 10) / 10,
      discipline: Math.round(disciplineScore * 10) / 10,
      compression: Math.round(compressionScore * 10) / 10,
      total: Math.round(totalScore * 10) / 10
    };
  }
  
  function getTier(score) {
    for (let tier of TIERS) {
      if (score >= tier.min) return tier;
    }
    return TIERS[TIERS.length - 1]; // Fallback to lowest tier
  }
  
  function submitEvaluation() {
    const btn = document.getElementById("submitBtn");
    btn.disabled = true;
    
    // Calculate scores
    const scores = calculateScores();
    if (!scores) {
      alert("No pages to evaluate!");
      btn.disabled = false;
      return;
    }
    
    const tier = getTier(scores.total);
    const advice = getNextTierAdvice(tier.name);
    
    // Calculate session stats
    const totalPages = pageData.length;
    const sandstoned = pageData.filter(p => p.isSandstone).length;
    const avgRating = pageData.filter(p => !p.isSandstone).length > 0
      ? pageData.filter(p => !p.isSandstone).reduce((sum, p) => sum + p.rating, 0) / pageData.filter(p => !p.isSandstone).length
      : 0;
    const avgChars = pageData.reduce((sum, p) => sum + p.charCount, 0) / totalPages;
    
    // Update verdict section
    const verdictSection = document.getElementById("verdictSection");
    verdictSection.innerHTML = `
      <div class="seal">${tier.emoji}</div>
      <div class="tier-name">${tier.name}</div>
      <div class="tier-subtitle">Total Score: ${scores.total}</div>
      
      <div class="score-breakdown">
        <div class="score-item">
          <div class="score-label">Comprehension</div>
          <div class="score-value">${scores.comprehension}</div>
          <div class="score-desc">Self-evaluation</div>
        </div>
        <div class="score-item">
          <div class="score-label">Discipline</div>
          <div class="score-value">${scores.discipline}</div>
          <div class="score-desc">On time + substance</div>
        </div>
        <div class="score-item">
          <div class="score-label">Compression</div>
          <div class="score-value">${scores.compression}</div>
          <div class="score-desc">Concise writing</div>
        </div>
      </div>

      <div class="explanation-section">
        <p><strong>Comprehension (${scores.comprehension}/${WEIGHT_COMPREHENSION}):</strong> Your honest self-assessment of how well you understood the material's core ideas, accuracy, and engagement.</p>
        
        <p><strong>Discipline (${scores.discipline}/${WEIGHT_DISCIPLINE}):</strong> Completed before time runs out. Full credit at 90%+ of character goal (${Math.floor(goalCharCount * (1 - COMPRESSION_TOLERANCE))}+ chars). Below that, credit scales proportionally down to zero.</p>
        
        <p><strong>Compression (${scores.compression}/${WEIGHT_COMPRESSION}):</strong> Writing concise summaries that capture meaning without being too brief or verbose. Sweet spot: ${Math.floor(goalCharCount * (1 - COMPRESSION_TOLERANCE))}-${Math.ceil(goalCharCount * (1 + COMPRESSION_TOLERANCE))} characters (90-110% of goal).</p>
      </div>

      ${advice ? `<div class="next-tier-advice">
        <div class="advice-label">Next Level</div>
        <p>${advice}</p>
      </div>` : ''}

      <div class="session-stats">
        <div class="stat-item">
          <span class="stat-label">Pages completed:</span>
          <span class="stat-value">${totalPages - sandstoned}/${totalPages}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Pages sandstoned:</span>
          <span class="stat-value">${sandstoned}/${totalPages}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Avg compass rating:</span>
          <span class="stat-value">${avgRating.toFixed(1)}/5</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Avg characters:</span>
          <span class="stat-value">${Math.round(avgChars)}</span>
        </div>
      </div>

      <div class="final-summary-controls" style="margin-top: 18px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
        <button class="submit-btn" id="finalSummaryBtn" type="button" onclick="generateFinalSummary()">Unlock Final Summary</button>
        <button class="submit-btn" id="printResultsBtn" type="button" onclick="printResults()" style="opacity:0.9;">Print Results</button>
      </div>

      <div id="finalSummaryStatus" style="margin-top:10px; text-align:center; font-size: 14px; opacity:0.8;"></div>
      <div id="finalSummaryOutput" style="margin-top:12px; display:none;"></div>
    `;
    
    // Show verdict with animation
    verdictSection.style.display = "block";
    
    // Play reward sound
    if (!allSoundsMuted) {
      rewardSound.currentTime = 0;
      rewardSound.play();
    }
    
    // Optional: Trigger confetti for Masterful
    if (tier.name === 'Masterful') {
      triggerConfetti();
    }
  }

  // ===================================
  // 🧠 FINAL SUMMARY (CHAPTER CONSOLIDATION)
  // ===================================

  function buildFinalSummaryPagesPayload() {
    // Tiered input:
    // 1) Use stored AI feedback if present for a page.
    // 2) Otherwise fall back to raw page text + user consolidation.
    // This keeps token usage controlled and avoids reprocessing pages that already have feedback.
    return pageData
      .map((p, idx) => {
        const ai = String(p?.aiFeedbackRaw ?? "").trim();
        const pageText = String(p?.text ?? "").trim();
        const userText = String(p?.consolidation ?? "").trim();

        if (ai) return { n: idx + 1, aiFeedback: ai };
        return { n: idx + 1, pageText, userText };
      })
      .filter((p) => {
        const ai = String(p?.aiFeedback ?? "").trim();
        const t = String(p?.pageText ?? "").trim();
        const u = String(p?.userText ?? "").trim();
        return ai || t || u;
      });
  }

  async function generateFinalSummary() {
    const btn = document.getElementById("finalSummaryBtn");
    const status = document.getElementById("finalSummaryStatus");
    const out = document.getElementById("finalSummaryOutput");
    if (!btn || !status || !out) return;

    const pagesPayload = buildFinalSummaryPagesPayload();
    if (!pagesPayload.length) {
      status.textContent = "Insufficient material to summarize.";
      return;
    }

    btn.disabled = true;
    status.textContent = "Generating final summary…";
    out.style.display = "none";
    out.innerHTML = "";

    const requestPayload = { title: "", pages: pagesPayload };

    try {
      const response = await fetch("https://reading-comprehension-rpwd.vercel.app/api/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });

      const rawText = await response.text();
      if (!response.ok) {
        lastAIDiagnostics = {
          kind: 'summary',
          status: response.status,
          request: requestPayload,
          responseText: rawText,
          at: new Date().toISOString()
        };
        throw new Error(rawText);
      }

      const data = JSON.parse(rawText || "{}");
      lastAIDiagnostics = {
        kind: 'summary',
        status: response.status,
        request: requestPayload,
        responseText: rawText,
        at: new Date().toISOString()
      };
      const summary = String(data?.summary ?? "").trim();
      if (!summary) {
        status.textContent = "No summary returned.";
        btn.disabled = false;
        return;
      }

      status.textContent = "";
      out.style.display = "block";
      out.innerHTML = `
        <div style="white-space:pre-wrap; line-height:1.45; padding:14px; border: 1px solid var(--border); border-radius: 10px; background: rgba(255,255,255,0.04);">
          ${escapeHtml(summary)}
        </div>
      `;
    } catch (err) {
      console.error("Final summary error:", err);
      status.textContent = "Error generating final summary. Check console.";
      btn.disabled = false;
    }
  }
  function printResults() {
    // Simple, stable text print (no UI/CSS parity attempts).
    const verdict = document.getElementById("verdictSection");
    if (!verdict) return;

    const text = verdict.innerText || "";

    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) return;

    w.document.open();
    w.document.write(`
      <!doctype html>
      <html><head><meta charset="utf-8" />
      <title>Reading Results</title>
      <style>
        body { font-family: monospace; padding: 40px; white-space: pre-wrap; line-height: 1.6; }
      </style>
      </head><body>${escapeHtml(text)}</body></html>
    `);
    w.document.close();

    w.focus();
    w.print();
  }

  // Keep escaping helper for rendering AI text safely into HTML blocks.
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
  
  function getNextTierAdvice(currentTier) {
    const advice = {
      'Fragmented': 'Focus on writing substantial consolidations (90%+ of your character goal) before time runs out. Discipline means both beating the timer AND writing enough to capture the core idea.',
      'Developing': 'Build consistency by finishing every page on time and within the character goal. Be honest in your self-evaluations to identify gaps.',
      'Competent': 'Capture the main mechanisms and causal relationships in each passage, not just surface-level facts. This depth will raise your comprehension score.',
      'Proficient': 'Perfect your compression hit the sweet spot every time and consistently rate yourself 5/5 when you have truly mastered the material.',
      'Masterful': 'Outstanding work! You have mastered focused reading, honest self-assessment, and concise consolidation. Keep this discipline as you tackle harder material.'
    };
    return advice[currentTier] || '';
  }
  
  function triggerConfetti() {
    const colors = ['#c17d4a', '#8B2500', '#a96939', '#d4af37'];
    for (let i = 0; i < 50; i++) {
      setTimeout(() => {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
        document.body.appendChild(confetti);
        
        setTimeout(() => confetti.remove(), 3000);
      }, i * 30);
    }
  }

  // Initialize optional Book Import UI
  initBookImporter();

  // ===================================
  // 🛠️ Utility Panels (Volume + Diagnostics)
  // ===================================

  (function initUtilityPanels() {
    const musicToggleBtn = document.getElementById('musicToggle');
    const toggleMusicBtn = document.getElementById('toggleMusicBtn');
    const volumePanel = document.getElementById('volumePanel');
    const volumeCloseBtn = document.getElementById('volumeCloseBtn');

    // Diagnostics are debug-only and must not alter the normal UI layout.
    // We build the button + panel dynamically (appended to <body>) so it cannot
    // create empty boxes inside .top-controls.
    let diagBtn = null;
    let diagPanel = null;
    let diagCloseBtn = null;
    let diagText = null;
    let diagCopyBtn = null;

    // URL flag: ?debug=1
    let debugEnabled = false;
    try {
      const params = new URLSearchParams(location.search);
      debugEnabled = (params.get('debug') === '1');
    } catch (_) {}

    // If any legacy diag elements exist in the DOM (from older patches), hide them
    // so they don't consume layout space.
    ['diagBtn', 'diagPanel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        try { el.style.display = 'none'; } catch (_) {}
      }
    });

    // Hide any legacy "debug" dropdown/controls if present.
    if (debugEnabled) {
      const legacySelectors = [
        '#debugControls', '#debugControl', '#debugPanelLegacy', '#debugSelect', '#debugMode',
        '#debugDropdown', '#debugToggle', '#debugMenu', '.debug-controls', '.debug-control',
        '.debug-dropdown', '.debug-select', '.debug-toggle'
      ];
      legacySelectors.forEach((sel) => {
        document.querySelectorAll(sel).forEach((el) => {
          try { el.style.display = 'none'; } catch (_) {}
        });
      });
    }

    function hideAllPanels() {
      if (volumePanel) volumePanel.style.display = 'none';
      if (diagPanel) diagPanel.style.display = 'none';
    }

    // Volume panel wiring
    if (musicToggleBtn && volumePanel) {
      const sliders = {
        music: document.getElementById('vol_music'),
        sand: document.getElementById('vol_sand'),
        stone: document.getElementById('vol_stone'),
        reward: document.getElementById('vol_reward'),
        compass: document.getElementById('vol_compass'),
        pageTurn: document.getElementById('vol_pageTurn'),
        evaluate: document.getElementById('vol_evaluate'),
      };

      function syncSlidersFromState() {
        if (sliders.music) sliders.music.value = String(music.volume);
        if (sliders.sand) sliders.sand.value = String(sandSound.volume);
        if (sliders.stone) sliders.stone.value = String(stoneSound.volume);
        if (sliders.reward) sliders.reward.value = String(rewardSound.volume);
        if (sliders.compass) sliders.compass.value = String(compassSound.volume);
        if (sliders.pageTurn) sliders.pageTurn.value = String(pageTurnSound.volume);
        if (sliders.evaluate) sliders.evaluate.value = String(evaluateSound.volume);
      }

      Object.entries(sliders).forEach(([key, el]) => {
        if (!el) return;
        el.addEventListener('input', () => setVolume(key, el.value));
      });

      // Open the volume panel from the existing music button (no extra top-controls button).
      musicToggleBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        const isOpen = volumePanel.style.display === 'block';
        hideAllPanels();
        if (!isOpen) {
          syncSlidersFromState();
          // Position the panel just ABOVE the music toggle so it never drops below the fold.
          // (iPad cursor can't reach off-page dropdowns.)
          try {
            // Temporarily show invisibly so we can measure height.
            volumePanel.style.visibility = 'hidden';
            volumePanel.style.display = 'block';

            const rect = musicToggleBtn.getBoundingClientRect();
            const panelW = volumePanel.offsetWidth;
            const panelH = volumePanel.offsetHeight;

            const gap = 10;
            const top = Math.max(10, rect.top - panelH - gap);
            const left = Math.min(
              window.innerWidth - panelW - 10,
              Math.max(10, rect.right - panelW)
            );

            volumePanel.style.top = `${top}px`;
            volumePanel.style.left = `${left}px`;
          } catch (_) {}
          volumePanel.style.visibility = 'visible';
        }
      });

      if (volumeCloseBtn) volumeCloseBtn.addEventListener('click', () => (volumePanel.style.display = 'none'));
      if (toggleMusicBtn) toggleMusicBtn.addEventListener('click', () => window.toggleMusic && window.toggleMusic());
    }

    // Diagnostics panel wiring (debug-only)
    function ensureDiagUI() {
      if (!debugEnabled) return;
      if (diagBtn && diagPanel && diagText) return;

      // Button: match the music button styling and sit beside it.
      diagBtn = document.createElement('button');
      diagBtn.id = 'diagBtn';
      diagBtn.type = 'button';
      diagBtn.className = 'music-button';
      diagBtn.title = 'Diagnostics';
      diagBtn.innerHTML = '<span id="diagIcon">🔧</span>';

      if (musicToggleBtn && musicToggleBtn.parentElement) {
        musicToggleBtn.parentElement.insertBefore(diagBtn, musicToggleBtn);
      } else {
        // fallback: fixed top-right (only if the DOM changes)
        document.body.appendChild(diagBtn);
        diagBtn.style.position = 'fixed';
        diagBtn.style.top = '16px';
        diagBtn.style.right = '64px';
        diagBtn.style.zIndex = '1000';
      }

      // Panel: same conventions as the Sound panel (fixed, above the button)
      diagPanel = document.createElement('div');
      diagPanel.id = 'diagPanel';
      diagPanel.style.display = 'none';
      diagPanel.style.position = 'fixed';
      diagPanel.style.zIndex = '1000';
      diagPanel.style.width = '420px';
      diagPanel.style.maxWidth = '92vw';
      diagPanel.style.padding = '12px';
      diagPanel.style.border = '2px solid var(--border)';
      diagPanel.style.borderRadius = '10px';
      diagPanel.style.background = 'var(--secondary-bg)';
      diagPanel.style.boxShadow = '0 8px 28px rgba(0,0,0,0.22)';
      diagPanel.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
          <strong style="font-size: 13px; opacity:0.9;">Diagnostics</strong>
          <button type="button" id="diagCloseBtn" style="padding:6px 10px;">✕</button>
        </div>
        <textarea id="diagText" readonly style="width:100%; height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 12px; padding: 10px;"></textarea>
        <div style="display:flex; gap:10px; margin-top:10px; justify-content:flex-end;">
          <button type="button" id="diagCopyBtn">Copy</button>
        </div>
      `;
      document.body.appendChild(diagPanel);

      diagCloseBtn = diagPanel.querySelector('#diagCloseBtn');
      diagText = diagPanel.querySelector('#diagText');
      diagCopyBtn = diagPanel.querySelector('#diagCopyBtn');

      function positionPanelAboveButton(btn, panel) {
        if (!btn || !panel) return;
        try {
          panel.style.visibility = 'hidden';
          panel.style.display = 'block';
          const rect = btn.getBoundingClientRect();
          const panelW = panel.offsetWidth;
          const panelH = panel.offsetHeight;
          const gap = 10;
          const top = Math.max(10, rect.top - panelH - gap);
          const left = Math.min(
            window.innerWidth - panelW - 10,
            Math.max(10, rect.right - panelW)
          );
          panel.style.top = `${top}px`;
          panel.style.left = `${left}px`;
        } catch (_) {}
        panel.style.visibility = 'visible';
      }

      function setDiagVisible(v) {
        if (!diagPanel || !diagText) return;
        if (!v) {
          diagPanel.style.display = 'none';
          return;
        }
        const dump = lastAIDiagnostics
          ? JSON.stringify(lastAIDiagnostics, null, 2)
          : 'No diagnostics captured yet.\n\nTip: run an AI eval, then open diagnostics.';
        diagText.value = dump;
        diagPanel.style.display = 'block';
        positionPanelAboveButton(diagBtn, diagPanel);
      }

      diagBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const isOpen = diagPanel && diagPanel.style.display === 'block';
        hideAllPanels();
        setDiagVisible(!isOpen);
      });

      if (diagCloseBtn) diagCloseBtn.addEventListener('click', () => setDiagVisible(false));
      if (diagCopyBtn && diagText) {
        diagCopyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(diagText.value || '');
            diagCopyBtn.textContent = 'Copied';
            setTimeout(() => (diagCopyBtn.textContent = 'Copy'), 900);
          } catch (_) {
            diagText.select();
            document.execCommand('copy');
          }
        });
      }

      // Ctrl+Alt+D toggles diagnostics (debug-only)
      document.addEventListener('keydown', (e) => {
        if (!debugEnabled) return;
        if (!(e.ctrlKey && e.altKey && (e.key === 'd' || e.key === 'D'))) return;
        const isOpen = diagPanel && diagPanel.style.display === 'block';
        hideAllPanels();
        setDiagVisible(!isOpen);
      });
    }

    // Build debug UI only when enabled.
    ensureDiagUI();

    // Click outside closes panels (lightweight)
    document.addEventListener('click', (e) => {
      const t = e.target;
      const inVol = volumePanel && volumePanel.contains(t);
      const inDiag = diagPanel && diagPanel.contains(t);
      const isVolBtn = musicToggleBtn && (t === musicToggleBtn || musicToggleBtn.contains(t));
      const isDiagBtn = diagBtn && (t === diagBtn || diagBtn.contains(t));
      if (inVol || inDiag || isVolBtn || isDiagBtn) return;
      hideAllPanels();
    });
  })();
