// ===================================
  // ðŸ“š READING COMPREHENSION APP
  // ===================================
  
  // ===================================
  // ðŸ“š APPLICATION STATE
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

  let goalTime = DEFAULT_TIME_GOAL;
  let goalCharCount = DEFAULT_CHAR_GOAL;

  const sandSound = document.getElementById("sandSound");
  const stoneSound = document.getElementById("stoneSound");
  const rewardSound = document.getElementById("rewardSound");
  const compassSound = document.getElementById("compassSound");
  const pageTurnSound = document.getElementById("pageTurnSound");
  const evaluateSound = document.getElementById("evaluateSound");
  
  // Set initial volumes
  sandSound.volume = SAND_VOLUME;
  stoneSound.volume = STONE_VOLUME;
  rewardSound.volume = REWARD_VOLUME;
  compassSound.volume = COMPASS_VOLUME;
  pageTurnSound.volume = PAGE_TURN_VOLUME;
  evaluateSound.volume = EVALUATE_VOLUME;
  music.volume = MUSIC_VOLUME;
  
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
    const pageStartSelect = document.getElementById("pageStartSelect");
    const pageEndSelect = document.getElementById("pageEndSelect");
    const loadBtn = document.getElementById("loadBookSelection");
    const bulkInput = document.getElementById("bulkInput");

    if (!sourceSel || !bookControls || !textControls || !bookSelect || !chapterControls || !chapterSelect || !pageStartSelect || !pageEndSelect || !loadBtn || !bulkInput) return;

    // ---- UI helpers ----
    function setSourceUI() {
      const src = sourceSel.value;
      if (src === "book") {
        bookControls.style.display = "flex";
        textControls.style.display = "none";
      } else {
        bookControls.style.display = "none";
        textControls.style.display = "block";
      }
    }

    function setSelectOptions(sel, options, placeholder) {
      sel.innerHTML = "";
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = placeholder || "Select…";
      sel.appendChild(ph);
      for (const opt of options) {
        const o = document.createElement("option");
        o.value = String(opt.value);
        o.textContent = String(opt.label);
        sel.appendChild(o);
      }
    }

    function setDisabled(sel, isDisabled) {
      sel.disabled = !!isDisabled;
    }

    // ---- Parsing ----
    // We keep content-cleaning consistent with existing addPages(): remove blank lines and header-ish lines.
    function cleanContentLines(lines) {
      return (lines || [])
        .map(l => String(l || "").trim())
        .filter(l => l && l !== "---" && !/^[#—]/.test(l));
    }

    function parseBookMarkdown(raw) {
      const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");

      const chapters = [];
      let currentChapter = null;
      let currentPage = null;

      function pushPage() {
        if (currentChapter && currentPage) {
          const cleaned = cleanContentLines(currentPage.lines);
          currentChapter.pages.push({
            title: currentPage.title || `Page ${currentChapter.pages.length + 1}`,
            text: cleaned.join(" ")
          });
        }
        currentPage = null;
      }

      function pushChapter() {
        if (currentChapter) {
          pushPage();
          // drop empty pages
          currentChapter.pages = currentChapter.pages.filter(p => p.text && p.text.trim().length);
          chapters.push(currentChapter);
        }
        currentChapter = null;
      }

      const h1Re = /^#\s+(.+)\s*$/;
      const h2Re = /^##\s+(.+)\s*$/;

      for (const line of lines) {
        const h1 = line.match(h1Re);
        if (h1) {
          pushChapter();
          currentChapter = { title: h1[1].trim(), pages: [] };
          currentPage = null;
          continue;
        }
        const h2 = line.match(h2Re);
        if (h2) {
          if (!currentChapter) currentChapter = { title: "Introduction", pages: [] };
          pushPage();
          currentPage = { title: h2[1].trim(), lines: [] };
          continue;
        }

        // If we have no explicit pages but see separators, treat as page boundaries (fallback behavior)
        if (line.trim() === "---") {
          if (!currentChapter) currentChapter = { title: "Introduction", pages: [] };
          if (!currentPage) currentPage = { title: `Page ${currentChapter.pages.length + 1}`, lines: [] };
          pushPage();
          continue;
        }

        if (!currentChapter) currentChapter = { title: "Introduction", pages: [] };
        if (!currentPage) currentPage = { title: `Page ${currentChapter.pages.length + 1}`, lines: [] };
        currentPage.lines.push(line);
      }

      pushChapter();

      // Determine if chapters are "real" (more than one H1) — otherwise treat as no-chapter doc.
      const hasMultipleChapters = chapters.length > 1;

      if (!hasMultipleChapters) {
        // Flatten into single pseudo-chapter and hide chapter UI.
        const allPages = (chapters[0]?.pages || []);
        return { hasChapters: false, chapters: [{ title: "", pages: allPages }] };
      }

      return { hasChapters: true, chapters };
    }

    // ---- Manifest + state ----
    let manifest = [];
    let currentBook = null; // {hasChapters, chapters}
    let selectedChapterIndex = 0;

    async function loadManifest() {
      const paths = ["assets/books/index.json", "index.json"];
      let lastErr = null;

      for (const p of paths) {
        try {
          const res = await fetch(p, { cache: "no-cache" });
          if (!res.ok) throw new Error(`manifest fetch failed: ${p} (${res.status})`);
          const data = await res.json();
          const arr = Array.isArray(data) ? data : [];
          manifest = arr.map((b) => {
            const id = b.id || b.name || "";
            const path = b.path || (id ? `assets/books/${id}.md` : "");
            const title = b.title || titleFromBookId(id) || id || "Untitled";
            return { id, title, path };
          }).filter(b => b.id && b.path);

          setSelectOptions(
            bookSelect,
            manifest.map(b => ({ value: b.id, label: b.title })),
            manifest.length ? "Select a book" : "No books found"
          );
          return;
        } catch (e) {
          lastErr = e;
        }
      }

      console.error(lastErr);
      bookSelect.innerHTML = `<option value="">Failed to load manifest</option>`;
    }

    async function loadBookById(bookId) {
      const entry = manifest.find(b => b.id === bookId);
      if (!entry) return;

      chapterSelect.innerHTML = `<option value="">Loading…</option>`;
      pageStartSelect.innerHTML = `<option value="">Loading…</option>`;
      pageEndSelect.innerHTML = `<option value="">Loading…</option>`;
      setDisabled(chapterSelect, true);
      setDisabled(pageStartSelect, true);
      setDisabled(pageEndSelect, true);

      try {
        const res = await fetch(entry.path, { cache: "no-cache" });
        if (!res.ok) throw new Error(`book fetch failed: ${entry.path} (${res.status})`);
        const raw = await res.text();
        currentBook = parseBookMarkdown(raw);

        // Chapters UI
        if (currentBook.hasChapters) {
          chapterControls.style.display = "flex";
          setSelectOptions(
            chapterSelect,
            currentBook.chapters.map((c, idx) => ({ value: idx, label: c.title || `Chapter ${idx + 1}` })),
            "Select chapter"
          );
          setDisabled(chapterSelect, false);
          selectedChapterIndex = 0;
          chapterSelect.value = "0";
        } else {
          chapterControls.style.display = "none";
          chapterSelect.innerHTML = `<option value="0">All</option>`;
          selectedChapterIndex = 0;
        }

        populatePagesForChapter(selectedChapterIndex);
      } catch (e) {
        console.error(e);
        chapterSelect.innerHTML = `<option value="">Failed to load book</option>`;
        pageStartSelect.innerHTML = `<option value="">Failed to load book</option>`;
        pageEndSelect.innerHTML = `<option value="">Failed to load book</option>`;
      }
    }

    function getCurrentPages() {
      const chap = currentBook?.chapters?.[selectedChapterIndex] || currentBook?.chapters?.[0];
      return chap?.pages || [];
    }

    function populatePagesForChapter(chapterIdx) {
      selectedChapterIndex = Number(chapterIdx) || 0;
      const pagesForChapter = getCurrentPages();

      const options = pagesForChapter.map((p, idx) => ({
        value: idx,
        label: `${idx + 1}. ${p.title || `Page ${idx + 1}`}`
      }));

      const placeholder = options.length ? "Select page" : "No pages found";
      setSelectOptions(pageStartSelect, options, placeholder);
      setSelectOptions(pageEndSelect, options, placeholder);

      const disabled = !options.length;
      setDisabled(pageStartSelect, disabled);
      setDisabled(pageEndSelect, disabled);

      if (options.length) {
        pageStartSelect.value = "0";
        pageEndSelect.value = String(options.length - 1);
      }
    }

    function clampRange(startIdx, endIdx, max) {
      let s = Math.max(0, Math.min(startIdx, max));
      let e = Math.max(0, Math.min(endIdx, max));
      if (e < s) e = s;
      return [s, e];
    }

    function addPagesFromArray(texts) {
      const t = (texts || []).map(x => String(x || "").trim()).filter(Boolean);
      if (!t.length) return;

      goalTime = parseInt(document.getElementById("goalTimeInput").value);
      goalCharCount = parseInt(document.getElementById("goalCharInput").value);

      for (const pageText of t) {
        pages.push(pageText);
        pageData.push({
          text: pageText,
          consolidation: "",
          charCount: 0,
          completedOnTime: true,
          isSandstone: false,
          rating: 0
        });
      }
      render();
      checkSubmitButton();
    }

    // ---- Wiring ----
    sourceSel.addEventListener("change", setSourceUI);

    bookSelect.addEventListener("change", async () => {
      const id = bookSelect.value;
      if (!id) return;
      await loadBookById(id);
    });

    chapterSelect.addEventListener("change", () => {
      populatePagesForChapter(chapterSelect.value);
    });

    // Keep end >= start for convenience
    pageStartSelect.addEventListener("change", () => {
      if (Number(pageEndSelect.value) < Number(pageStartSelect.value)) {
        pageEndSelect.value = pageStartSelect.value;
      }
    });

    loadBtn.addEventListener("click", () => {
      if (!currentBook) return;

      const pagesForChapter = getCurrentPages();
      if (!pagesForChapter.length) return;

      const max = pagesForChapter.length - 1;
      const [s, e] = clampRange(Number(pageStartSelect.value), Number(pageEndSelect.value), max);
      const selected = pagesForChapter.slice(s, e + 1).map(p => p.text).filter(Boolean);

      addPagesFromArray(selected);
    });

    // Init defaults
    sourceSel.value = "book";
    setSourceUI();
    await loadManifest();
  }    }

    async function loadManifest() {
      try {
        const res = await fetch("assets/books/index.json", { cache: "no-cache" });
        if (!res.ok) throw new Error("manifest fetch failed");
        const data = await res.json();
        manifest = (Array.isArray(data) ? data : []).map((b) => {
          const id = b.id || b.name || "";
          const path = b.path || (id ? `assets/books/${id}.md` : "");
          const title = b.title || titleFromBookId(id) || id || "Untitled";
          return { id, title, path };
        }).filter(b => b.id && b.path);

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

    async function loadBook(id) {
      currentBookRaw = "";
      currentBookPages = [];
      currentBookChapters = [];
      chapterSelect.innerHTML = "<option value=''>Loading…</option>";

      const entry = manifest.find(b => b.id === id);
      if (!entry) {
        chapterSelect.innerHTML = "<option value=''>Select a book first</option>";
        return;
      }

      try {
        const res = await fetch(entry.path, { cache: "no-cache" });
        if (!res.ok) throw new Error("book fetch failed");
        currentBookRaw = await res.text();

        currentBookPages = splitIntoPages(currentBookRaw);
        currentBookChapters = parseChaptersFromMarkdown(currentBookRaw);

        const max = Math.max(1, currentBookPages.length || 1);
        rangeStart.max = String(max);
        rangeEnd.max = String(max);
        rangeStart.value = "1";
        rangeEnd.value = String(max);

        chapterSelect.innerHTML = "";
        if (currentBookChapters.length === 0) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "No chapters detected";
          chapterSelect.appendChild(opt);
        } else {
          const opt0 = document.createElement("option");
          opt0.value = "";
          opt0.textContent = "Select a chapter…";
          chapterSelect.appendChild(opt0);

          currentBookChapters.forEach((ch, idx) => {
            const opt = document.createElement("option");
            opt.value = String(idx);
            opt.textContent = ch.title || `Chapter ${idx + 1}`;
            chapterSelect.appendChild(opt);
          });
        }
      } catch (e) {
        chapterSelect.innerHTML = "<option value=''>Failed to load book</option>";
        console.error("Book load error:", e);
      }
    }

    function applySelectionToBulkInput(payload) {
      let text = "";
      if (Array.isArray(payload)) {
        text = payload.join("\n---\n");
      } else {
        text = String(payload || "").trim();
      }
      bulkInput.value = text;
      addPages();
    }

    // Events
    sourceSel.addEventListener("change", () => {
      const isBook = sourceSel.value === "book";
      bookControls.style.display = isBook ? "flex" : "none";
    });

    modeSel.addEventListener("change", setModeUI);
    setModeUI();

    bookSelect.addEventListener("change", async () => {
      const id = bookSelect.value;
      if (!id) {
        chapterSelect.innerHTML = "<option value=''>Select a book first</option>";
        return;
      }
      await loadBook(id);
    });

    loadBtn.addEventListener("click", () => {
      if (!currentBookRaw) return;

      const mode = modeSel.value;
      if (mode === "pages") {
        const start = Math.max(1, parseInt(rangeStart.value || "1", 10));
        const end = Math.max(start, parseInt(rangeEnd.value || String(start), 10));
        const max = currentBookPages.length || 0;
        if (max === 0) return;

        const s = Math.min(start, max) - 1;
        const e = Math.min(end, max);
        applySelectionToBulkInput(currentBookPages.slice(s, e));
        return;
      }

      const idx = parseInt(chapterSelect.value || "", 10);
      if (Number.isFinite(idx) && currentBookChapters[idx]) {
        applySelectionToBulkInput(currentBookChapters[idx].raw);
      }
    });

    await loadManifest();
  }


function addPages() {
    const input = document.getElementById("bulkInput").value.trim();
    goalTime = parseInt(document.getElementById("goalTimeInput").value);
    goalCharCount = parseInt(document.getElementById("goalCharInput").value);
    if (!input) return;

    input.split(/\n---\n|\n## Page\s+\d+/i).forEach(c => {
      const cleaned = c.split("\n").map(l => l.trim()).filter(l => l && !/^[#â€”]/.test(l));
      if (cleaned.length) {
        pages.push(cleaned.join(" "));
        pageData.push({
          text: cleaned.join(" "),
          consolidation: "",
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
        // Enter: next consolidation box (Shift+Enter remains normal newline behavior)
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          goToNext(i);
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
            sandSound.play();
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
          stoneSound.play();
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
    if (!confirm("Clear all pages, consolidations, and timers?")) return;
    pages = [];
    pageData = [];
    timers = [];
    intervals.forEach(i => clearInterval(i));
    intervals = [];
    sandSound.pause();
    document.getElementById("pages").innerHTML = "";
    document.getElementById("submitBtn").disabled = true;
    document.getElementById("verdictSection").style.display = "none";
  }

  // ===================================
  // 🧭 COMPASS & SUBMISSION LOGIC
  // ===================================
  
  function checkCompassUnlock() {
    // Unlock compasses when ALL pages have at least 1 character
    // AND user is not currently focused on any textarea
    const allHaveText = pageData.every(p => p.charCount > 0);
    const noTextareaFocused = document.activeElement.tagName !== 'TEXTAREA';
    
    if (allHaveText && noTextareaFocused) {
      let anyUnlocked = false;
      
      // Get all pages to find both evaluation sections and action buttons
      const allPages = document.querySelectorAll(".page");
      
      allPages.forEach((page, i) => {
        const starsDiv = page.querySelector(".stars");
        const evalSection = page.querySelector(".evaluation-section");
        const aiBtn = page.querySelector(".ai-btn");
        
        // Only unlock non-sandstone pages
        if (!pageData[i].isSandstone && starsDiv) {
          starsDiv.classList.remove("locked");
          // Add 'ready' class to trigger label glow animation
          if (!starsDiv.classList.contains('rated') && evalSection) {
            evalSection.classList.add('ready');
            anyUnlocked = true;
          }
          // Show AI button when compasses unlock
          if (aiBtn) aiBtn.style.display = 'block';
        }
      });
      
      // Play evaluation sound once when unlocking
      if (anyUnlocked && !allSoundsMuted) {
        evaluateSound.currentTime = 0;
        evaluateSound.play();
      }
    }
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

    try {
      const response = await fetch("https://reading-comprehension-rpwd.vercel.app/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageText: passageText,
          userText: userText,
          // Use server's default model (set via OLLAMA_MODEL env var if needed)
          // model: "llama3.1",  // optional override
          
          // CRITICAL: Pass the user's character goal to enforce limits
          betterCharLimit: goalCharCount,
          bulletMaxChars: 110
        })
      });

      if (!response.ok) {
        const msg = await response.text();
        throw new Error(msg);
      }

      const data = await response.json();
      displayAIFeedback(pageIndex, data.feedback || "");

      aiBtn.textContent = '▲ AI';
      aiBtn.classList.remove('loading');
    } catch (error) {
      console.error('AI evaluation error:', error);
      feedbackDiv.innerHTML =
        '<div style="color: #8B2500;">Error getting AI feedback. Check console and verify AI Host is running.</div>';
      aiBtn.textContent = '▼ AI';
      aiBtn.classList.remove('loading');
    }
  }

  function displayAIFeedback(pageIndex, feedback) {
    const feedbackDiv = document.querySelector(`.ai-feedback[data-page="${pageIndex}"]`);
    if (!feedbackDiv) return;

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

    html += `<button class="use-rating-btn" onclick="applyAIRating(${pageIndex}, ${rating})">Use This Rating (${rating}/5)</button>`;
    feedbackDiv.innerHTML = html;
  }


  function applyAIRating(pageIndex, rating) {
    const starsDiv = document.querySelector(`.stars[data-page="${pageIndex}"]`);
    if (!starsDiv) return;
    
    const stars = starsDiv.querySelectorAll(".star");
    setRating(pageIndex, rating, stars);
    
    // Scroll to next page if exists
    const pages = document.querySelectorAll('.page');
    if (pages[pageIndex + 1]) {
      pages[pageIndex + 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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
  
  function getNextTierAdvice(currentTier) {
    const advice = {
      'Fragmented': 'Focus on writing substantial consolidations (90%+ of your character goal) before time runs out. Discipline means both beating the timer AND writing enough to capture the core idea.',
      'Developing': 'Build consistencyâ€”finish every page on time and meet the character goal. Be honest in your self-evaluations to identify gaps.',
      'Competent': 'Capture the main mechanisms and causal relationships in each passage, not just surface-level facts. This depth will raise your comprehension score.',
      'Proficient': 'Perfect your compressionâ€”hit the sweet spot every timeâ€”and consistently rate yourself 5/5 when you have truly mastered the material.',
      'Masterful': 'ðŸ† Outstanding work! You have mastered focused reading, honest self-assessment, and concise consolidation. Keep this discipline as you tackle harder material.'
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
