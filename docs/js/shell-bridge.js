// ============================================================
// shell-bridge.js
// Connects the jubly shell UI to the app's functional engine.
// Loaded AFTER all app scripts (state, tts, library, etc.)
// ============================================================

(function() {

  // ── Dashboard library rendering ──────────────────────────────────────
  // Reads books from IndexedDB and populates the dashboard library list.

  let _cachedBooks = [];
  let _currentBookId = null;
  let _currentBookRecord = null;

  async function refreshDashboardLibrary() {
    const listEl = document.getElementById('libraryList');
    const populatedEl = document.getElementById('library-populated');
    const emptyEl = document.getElementById('library-empty');
    const subtitleEl = document.getElementById('dashboard-subtitle');

    let books = [];
    try {
      if (typeof localBooksGetAll === 'function') {
        books = await localBooksGetAll();
      }
    } catch (e) {
      console.warn('Failed to load library:', e);
    }

    _cachedBooks = books;

    if (!books.length) {
      if (populatedEl) populatedEl.style.display = 'none';
      if (emptyEl) emptyEl.style.display = '';
      if (subtitleEl) subtitleEl.style.display = 'none';
      return;
    }

    if (populatedEl) populatedEl.style.display = '';
    if (emptyEl) emptyEl.style.display = 'none';
    if (subtitleEl) subtitleEl.style.display = '';

    if (!listEl) return;
    listEl.innerHTML = '';

    books.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    books.forEach((book) => {
      const pageCount = countPagesInMarkdown(book.markdown || '');
      const estMinutes = Math.max(1, Math.round(pageCount * 1.5));
      const dateStr = book.createdAt ? new Date(book.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

      const row = document.createElement('div');
      row.className = 'library-row';
      row.innerHTML = `
        <div class="flex-grow flex items-center gap-3 min-w-0">
          <div class="w-8 h-8 rounded flex items-center justify-center text-lg bg-accent-soft text-accent flex-shrink-0">📄</div>
          <div class="min-w-0">
            <p class="font-semibold text-slate-800 text-sm truncate">${escapeHtml(book.title || book.sourceName || 'Untitled')}</p>
            <p class="text-xs text-slate-400">${dateStr}</p>
          </div>
        </div>
        <div class="w-28 hidden md:block text-sm text-slate-500 font-medium flex-shrink-0">${pageCount} pages</div>
        <div class="w-28 hidden md:block text-sm text-slate-500 font-medium flex-shrink-0">~${estMinutes} min</div>
        <div class="w-8 text-slate-300 flex-shrink-0">→</div>
      `;
      row.addEventListener('click', () => openBookPreview(book.id));
      listEl.appendChild(row);
    });
  }

  // Expose globally for shell routing
  window.refreshDashboardLibrary = refreshDashboardLibrary;

  // Wire the import completion hook
  window.__rcRefreshBookSelect = refreshDashboardLibrary;

  // ── Page counting helper ─────────────────────────────────────────────
  function countPagesInMarkdown(md) {
    return (md.match(/^\s*##\s+/gm) || []).length;
  }

  function countChaptersInMarkdown(md) {
    return (md.match(/^\s*#\s+/gm) || []).length;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Preview modal ────────────────────────────────────────────────────

  function openBookPreview(bookId) {
    const book = _cachedBooks.find(b => b.id === bookId);
    if (!book) return;

    const pageCount = countPagesInMarkdown(book.markdown || '');
    const estMinutes = Math.max(1, Math.round(pageCount * 1.5));

    const titleEl = document.getElementById('preview-title');
    const pagesEl = document.getElementById('preview-pages');
    const timeEl = document.getElementById('preview-time');
    const startBtn = document.getElementById('previewStartBtn');

    if (titleEl) titleEl.textContent = book.title || book.sourceName || 'Untitled';
    if (pagesEl) pagesEl.textContent = `${pageCount} Pages`;
    if (timeEl) timeEl.textContent = `~${estMinutes} min`;

    // Wire start button
    if (startBtn) {
      startBtn.onclick = () => {
        closeModal('preview-modal');
        startReadingBook(bookId);
      };
    }

    openModal('preview-modal');
  }

  // ── Start reading a book ─────────────────────────────────────────────

  async function startReadingBook(bookId) {
    let book = _cachedBooks.find(b => b.id === bookId);
    if (!book) {
      try {
        book = await localBookGet(bookId);
      } catch (e) {
        console.error('Failed to load book:', e);
        return;
      }
    }
    if (!book || !book.markdown) return;

    _currentBookId = bookId;
    _currentBookRecord = book;

    // Parse markdown into chapters and pages
    const parsed = parseBookMarkdown(book.markdown);

    // Populate chapter select
    const chapterSelect = document.getElementById('chapterSelect');
    if (chapterSelect && parsed.chapters.length > 0) {
      chapterSelect.innerHTML = '';
      parsed.chapters.forEach((ch, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = 'Ch: ' + (ch.title || (i + 1));
        chapterSelect.appendChild(opt);
      });
      chapterSelect.onchange = () => {
        const idx = parseInt(chapterSelect.value, 10);
        if (Number.isFinite(idx)) loadChapter(parsed.chapters, idx);
      };
    }

    // Populate book select with current book
    const bookSelect = document.getElementById('bookSelect');
    if (bookSelect) {
      bookSelect.innerHTML = '';
      _cachedBooks.forEach((b) => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.title || b.sourceName || 'Untitled';
        bookSelect.appendChild(opt);
      });
      bookSelect.value = bookId;
      bookSelect.onchange = async () => {
        const newId = bookSelect.value;
        if (newId && newId !== _currentBookId) {
          await startReadingBook(newId);
        }
      };
    }

    // Load first chapter
    if (parsed.chapters.length > 0) {
      loadChapter(parsed.chapters, 0);
    } else {
      // No chapters — load all pages directly
      loadPagesIntoApp(parsed.allPages);
    }

    showSection('reading-mode');
  }

  function loadChapter(chapters, idx) {
    if (!chapters[idx]) return;
    loadPagesIntoApp(chapters[idx].pages);
    const chapterSelect = document.getElementById('chapterSelect');
    if (chapterSelect) chapterSelect.value = String(idx);
  }

  function loadPagesIntoApp(pagesArray) {
    if (!Array.isArray(pagesArray) || !pagesArray.length) return;

    // Set global state (from state.js)
    pages = pagesArray.map(p => p.text || p);
    pageData = pages.map((t) => ({
      text: t,
      consolidation: '',
      charCount: 0,
      completedOnTime: true,
      isSandstone: false,
      rating: 0,
      pageHash: '',
      anchors: null,
      anchorVersion: 0,
      anchorsMeta: null,
      aiExpanded: false,
      aiFeedbackRaw: '',
      aiAt: null,
      aiRating: null
    }));
    timers = pages.map(() => 0);
    intervals = pages.map(() => null);
    lastFocusedPageIndex = 0;
    evaluationPhase = false;

    render();
    updatePageProgress();

    // Compute hashes and rehydrate persisted work
    if (typeof ensurePageHashesAndRehydrate === 'function') {
      ensurePageHashesAndRehydrate().then(() => {
        render();
        updatePageProgress();
      });
    }

    // Persist session
    if (typeof schedulePersistSession === 'function') schedulePersistSession();
  }

  // ── Markdown parser ──────────────────────────────────────────────────
  // Parses the book markdown (H1 = chapters, H2 = pages within chapters)

  function parseBookMarkdown(md) {
    const text = String(md || '');
    const lines = text.split(/\r?\n/);

    const chapters = [];
    let currentChapter = null;
    let currentPage = null;
    const allPages = [];

    function pushPage() {
      if (!currentPage) return;
      const body = currentPage.lines
        .map(l => l.trim())
        .filter(l => l && !/^\s{0,3}#{1,6}\s+/.test(l) && !/^\s*[—-]{2,}\s*$/.test(l))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (body) {
        const page = { title: currentPage.title, text: body };
        if (currentChapter) currentChapter.pages.push(page);
        allPages.push(page);
      }
    }

    function pushChapter() {
      pushPage();
      currentPage = null;
      if (currentChapter && currentChapter.pages.length > 0) {
        chapters.push(currentChapter);
      }
    }

    for (const line of lines) {
      // H1 = chapter
      const h1 = line.match(/^\s{0,3}#\s+(.*)\s*$/);
      if (h1) {
        pushChapter();
        currentChapter = { title: (h1[1] || '').trim(), pages: [] };
        continue;
      }

      // H2 = page
      const h2 = line.match(/^\s{0,3}##\s+(.*)\s*$/);
      if (h2) {
        pushPage();
        currentPage = { title: (h2[1] || '').trim(), lines: [] };
        continue;
      }

      if (!currentPage) currentPage = { title: 'Page 1', lines: [] };
      currentPage.lines.push(line);
    }

    pushChapter();

    // If no chapters found, treat all pages as one chapter
    if (chapters.length === 0 && allPages.length > 0) {
      chapters.push({ title: 'All', pages: allPages });
    }

    return { chapters, allPages };
  }

  // ── Page progress bar ────────────────────────────────────────────────

  function updatePageProgress() {
    const progressEl = document.getElementById('pageProgress');
    const dotsEl = document.getElementById('pageDots');
    const total = (typeof pages !== 'undefined') ? pages.length : 0;
    const current = (typeof lastFocusedPageIndex !== 'undefined' && lastFocusedPageIndex >= 0)
      ? lastFocusedPageIndex + 1 : 1;

    if (progressEl) progressEl.textContent = `Page ${current} / ${total}`;
    if (dotsEl && total <= 30) {
      dotsEl.innerHTML = '';
      for (let i = 0; i < total; i++) {
        const dot = document.createElement('div');
        dot.className = 'w-2 h-2 rounded-full';
        dot.style.background = i < current ? 'var(--theme-accent)' : '#e2e8f0';
        dotsEl.appendChild(dot);
      }
    } else if (dotsEl) {
      dotsEl.innerHTML = '';
    }
  }
  window.updatePageProgress = updatePageProgress;

  // ── goToNext — shell version ─────────────────────────────────────────
  // Advances to next page card, updates progress, handles session complete.

  window.goToNext = function goToNext(currentIndex) {
    const total = (typeof pages !== 'undefined') ? pages.length : 0;
    const nextIndex = currentIndex + 1;

    if (nextIndex >= total) {
      // Session complete
      showSessionComplete();
      return;
    }

    lastFocusedPageIndex = nextIndex;
    updatePageProgress();

    // Deactivate current card, activate next
    const allCards = document.querySelectorAll('#page-stack .page-card');
    allCards.forEach((card, i) => {
      card.classList.toggle('active', i === nextIndex);
    });

    // Scroll to next card
    const nextCard = allCards[nextIndex];
    if (nextCard) {
      nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Play page turn sound
    try {
      if (typeof playSfx === 'function') {
        playSfx(document.getElementById('pageTurnSound'));
      }
    } catch (_) {}

    // Persist position
    if (typeof schedulePersistSession === 'function') schedulePersistSession();
  };

  // ── Session complete ─────────────────────────────────────────────────

  function showSessionComplete() {
    const signal = document.getElementById('session-complete');
    if (!signal) return;
    const total = (typeof pages !== 'undefined') ? pages.length : 0;
    const estMins = Math.max(1, Math.round(total * 1.5));
    const statPages = document.getElementById('stat-pages');
    const statMinutes = document.getElementById('stat-minutes');
    if (statPages) statPages.textContent = total;
    if (statMinutes) statMinutes.textContent = '~' + estMins;
    signal.classList.remove('hidden-section');
    signal.style.display = '';
    signal.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ── render() — produces shell-styled page cards ──────────────────────
  // Overrides the app's render() to produce cards matching the shell design.

  window.render = function render() {
    try { if (typeof ttsStop === 'function') ttsStop(); } catch (_) {}

    const container = document.getElementById('page-stack');
    if (!container) return;
    container.innerHTML = '';

    // Hide session complete
    const signal = document.getElementById('session-complete');
    if (signal) { signal.classList.add('hidden-section'); signal.style.display = 'none'; }

    if (!pages || !pages.length) return;

    pages.forEach((text, i) => {
      if (typeof timers !== 'undefined') timers[i] = timers[i] ?? 0;

      const card = document.createElement('div');
      card.className = 'page-card glass-card p-6 md:p-10' + (i === 0 ? ' active' : '');
      card.dataset.pageIndex = String(i);

      card.innerHTML = `
        <div class="flex justify-between items-center mb-6">
          <span class="text-xs font-black text-slate-400 uppercase tracking-widest">Page ${i + 1} <span class="text-slate-300">/ ${pages.length}</span></span>
          <div class="anchors-dots flex gap-1.5"></div>
        </div>
        <div class="page-text reading-font text-xl md:text-2xl text-slate-800 leading-relaxed mb-8">${escapeHtml(text)}</div>
        <div class="flex gap-4 flex-wrap items-center">
          <button type="button" class="tts-btn px-5 py-3 bg-slate-100 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-200 transition-colors text-sm" data-tts="page" data-page="${i}">🔊 Read Aloud</button>
          ${i === (typeof lastFocusedPageIndex !== 'undefined' ? lastFocusedPageIndex : 0)
            ? `<button type="button" class="btn-theme px-8 py-3 rounded-xl font-bold text-sm" onclick="goToNext(${i})">Got it →</button>`
            : ''}
        </div>

        <!-- Comprehension elements (hidden in Reading mode) -->
        <div class="comprehension-elements mt-8" style="display:none;">
          <div class="anchors-row mb-4">
            <div class="flex items-center justify-between">
              <span class="anchors-counter text-xs font-bold text-slate-400">Anchors: 0/0</span>
              <button type="button" class="hint-btn text-xs font-bold text-indigo-600 hover:underline">Hint</button>
            </div>
          </div>
          <div class="sand-wrapper relative mb-4">
            <textarea placeholder="What was this page really about?" class="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:border-indigo-400 transition bg-white resize-y" rows="3"></textarea>
            <div class="sand-layer absolute inset-0 pointer-events-none rounded-xl" style="height:0%;"></div>
          </div>
          <div class="info-row flex items-center justify-between gap-4 text-xs text-slate-400 mb-4">
            <span class="timer">Timer: 0 / ${typeof goalTime !== 'undefined' ? goalTime : 160}</span>
            <span class="char-counter">Chars: <span class="char-count">0</span> / ${typeof goalCharCount !== 'undefined' ? goalCharCount : 300}</span>
          </div>
          <div class="evaluation-section flex items-center gap-2 mb-4">
            <div class="stars locked flex gap-1" data-page="${i}">
              <span class="star cursor-pointer" data-value="1">🧭</span>
              <span class="star cursor-pointer" data-value="2">🧭</span>
              <span class="star cursor-pointer" data-value="3">🧭</span>
              <span class="star cursor-pointer" data-value="4">🧭</span>
              <span class="star cursor-pointer" data-value="5">🧭</span>
            </div>
          </div>
          <div class="action-buttons">
            <button class="ai-btn btn-ghost px-4 py-2 rounded-lg text-xs font-bold" data-page="${i}" style="display:none;">▼ AI Evaluate</button>
          </div>
          <div class="ai-feedback mt-4" data-page="${i}" style="display:none;"></div>
        </div>
      `;

      // TTS button handler
      const ttsBtn = card.querySelector('.tts-btn');
      if (ttsBtn) {
        ttsBtn.addEventListener('click', () => {
          if (typeof AUTOPLAY_STATE !== 'undefined' && AUTOPLAY_STATE.countdownPageIndex === i) {
            if (typeof ttsAutoplayCancelCountdown === 'function') ttsAutoplayCancelCountdown();
            return;
          }
          if (typeof ttsSpeakQueue === 'function') ttsSpeakQueue('page-' + i, [text]);
        });
      }

      // Track which page the user is interacting with
      card.addEventListener('pointerdown', () => {
        lastFocusedPageIndex = i;
        updatePageProgress();
      });

      container.appendChild(card);
    });

    updatePageProgress();
    if (typeof applyModeVisibility === 'function') applyModeVisibility();
    if (typeof applyTierAccess === 'function') applyTierAccess();
  };

  // ── Speed control ────────────────────────────────────────────────────
  const speedSelect = document.getElementById('speedSelect');
  if (speedSelect) {
    speedSelect.addEventListener('change', () => {
      const rate = parseFloat(speedSelect.value) || 1;
      // Apply to TTS audio element if it exists
      if (typeof TTS_AUDIO_ELEMENT !== 'undefined') TTS_AUDIO_ELEMENT.playbackRate = rate;
      try { localStorage.setItem('jubly_speed', String(rate)); } catch(_) {}
    });
    // Restore saved speed
    try {
      const saved = localStorage.getItem('jubly_speed');
      if (saved) {
        speedSelect.value = saved;
        if (typeof TTS_AUDIO_ELEMENT !== 'undefined') TTS_AUDIO_ELEMENT.playbackRate = parseFloat(saved) || 1;
      }
    } catch(_) {}
  }

  // ── Restore autoplay state ───────────────────────────────────────────
  try {
    const autoSaved = localStorage.getItem('rc_autoplay');
    if (autoSaved === '1') {
      if (typeof AUTOPLAY_STATE !== 'undefined') AUTOPLAY_STATE.enabled = true;
      const btn = document.getElementById('autoplayBtn');
      if (btn) btn.classList.add('active');
    }
  } catch(_) {}

  // ── Volume panel close ───────────────────────────────────────────────
  const volClose = document.getElementById('volumeCloseBtn');
  if (volClose) {
    volClose.addEventListener('click', () => {
      const panel = document.getElementById('volumePanel');
      if (panel) { panel.classList.add('hidden-section'); panel.style.display = ''; }
    });
  }

  // ── Mute/unmute button ───────────────────────────────────────────────
  const muteBtn = document.getElementById('toggleMusicBtn');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      if (typeof toggleMusic === 'function') toggleMusic();
    });
  }

  // ── Boot: restore session ────────────────────────────────────────────
  // If there's a persisted session, offer to resume from dashboard.
  // For now: just refresh the library.
  setTimeout(() => {
    refreshDashboardLibrary();
    updateExplorerGate();

    // Restore tier from localStorage
    try {
      const savedTier = localStorage.getItem('rc_app_tier');
      if (savedTier && ['free','paid','premium'].includes(savedTier)) {
        if (typeof appTier !== 'undefined') appTier = savedTier;
        const btns = document.querySelectorAll('#tierButtons .tier-btn');
        btns.forEach(btn => {
          btn.classList.toggle('active',
            (savedTier === 'free' && btn.textContent.trim() === 'Basic') ||
            (savedTier === 'paid' && btn.textContent.trim() === 'Pro') ||
            (savedTier === 'premium' && btn.textContent.trim() === 'Premium')
          );
        });
        const pill = document.getElementById('tierPill');
        if (pill) pill.textContent = savedTier === 'free' ? 'Basic' : savedTier === 'paid' ? 'Pro' : 'Premium';
        updateExplorerGate();
      }
    } catch(_) {}
  }, 100);

})();
