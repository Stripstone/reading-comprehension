// ============================================================
// jubly — Shell + App bridge
// ============================================================
//
    // PERMANENT (shell navigation and app wiring):
    //   showSection(), initFocusMode(), switchTab(), openModal(),
    //   closeModal(), setTheme(), handleExplorerSwatch(),
    //   setTier(), updateTierPill(), handlePausePlay(),
    //   handleAutoplayToggle(), updateProgressBar(),
    //   showSessionComplete(), renderDashboard(), startReading()
    //
    // SCAFFOLD (remove on real auth wiring):
    //   login() — simulates auth; replace with Supabase auth flow
    // ============================================================

    // ── Section routing ──────────────────────────────────────────
    const ALL_SECTIONS     = ['landing-page', 'login-page', 'dashboard', 'profile-page', 'reading-mode'];
    const SIDEBAR_SECTIONS = ['dashboard', 'profile-page'];

    function showSection(id) {
        const readingModeEl = document.getElementById('reading-mode');
        const wasReading = readingModeEl && !readingModeEl.classList.contains('hidden-section');

        ALL_SECTIONS.forEach(s => document.getElementById(s).classList.add('hidden-section'));
        document.getElementById(id).classList.remove('hidden-section');

        const isPublic  = id === 'landing-page' || id === 'login-page';
        const isLanding = id === 'landing-page';

        document.getElementById('nav-user-controls').classList.toggle('hidden-section', isPublic);
        const landingControls = document.getElementById('nav-landing-controls');
        if (landingControls) landingControls.style.display = isLanding ? 'flex' : 'none';
        const footer = document.getElementById('landing-footer');
        if (footer) footer.classList.toggle('hidden-section', id !== 'landing-page');

        // Sidebar
        const sidebar = document.getElementById('app-sidebar');
        if (sidebar) sidebar.style.display = SIDEBAR_SECTIONS.includes(id) ? 'flex' : 'none';
        const sbLibrary = document.getElementById('sb-library');
        if (sbLibrary) sbLibrary.classList.toggle('active', id === 'dashboard');

        // Support footer: visible on logged-in non-reading pages only
        const supportFooter = document.getElementById('supportFooter');
        if (supportFooter) supportFooter.style.display = SIDEBAR_SECTIONS.includes(id) ? 'block' : 'none';

        // Reading mode: keep top controls visible, restore on exit
        const mainNav = document.querySelector('nav');
        if (mainNav) mainNav.style.display = id === 'reading-mode' ? 'none' : '';
        if (wasReading && id !== 'reading-mode') cleanupReadingTransientState();
        if (id === 'reading-mode') {
            initFocusMode();
            updateTierPill();
            updateExplorerSwatchState();
            updateProgressBar();
            syncPausePlayButton();
            try { if (typeof window.restoreReadingPosition === 'function') setTimeout(() => window.restoreReadingPosition({ behavior: 'auto' }), 60); } catch(_) {}
        }
        if (id === 'dashboard') refreshLibrary();

        window.scrollTo(0, 0);
    }

    // ── Focus mode fade ──────────────────────────────────────────
    let focusModeTimer   = null;
    let focusModeHandler = null;

    function initFocusMode() {
        try {
            const savedSpeed = localStorage.getItem('rc_tts_speed');
            if (savedSpeed) {
                const sel = document.getElementById('shell-speed');
                if (sel) sel.value = savedSpeed;
                if (typeof window.setPlaybackRate === 'function') window.setPlaybackRate(savedSpeed);
                else shellSetSpeed(savedSpeed);
            }
        } catch(_) {}

        const bar = document.getElementById('reading-top-bar');
        const rm  = document.getElementById('reading-mode');
        if (!bar || !rm) return;
        if (focusModeHandler) {
            ['mousemove', 'scroll', 'touchstart', 'click'].forEach(ev =>
                rm.removeEventListener(ev, focusModeHandler));
        }
        clearTimeout(focusModeTimer);
        bar.classList.remove('faded');
        focusModeHandler = null;
    }

    // ── Modals ───────────────────────────────────────────────────
    function openModal(id)  { const el = document.getElementById(id); if (!el) return; el.classList.remove('hidden-section'); if (el.classList.contains('modal-overlay')) el.style.display = 'flex'; }
    function closeModal(id) { const el = document.getElementById(id); if (!el) return; el.classList.add('hidden-section'); if (el.classList.contains('modal-overlay')) el.style.display = 'none'; }

    // ── Auth (SCAFFOLD) ──────────────────────────────────────────
    // SCAFFOLD: replace login() with real Supabase auth flow
    function login() {
        showSection('dashboard');
        try { refreshLibrary(); } catch(_) {}
    }

    // ── Profile tabs ─────────────────────────────────────────────
    function switchTab(tabId) {
        document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden-section'));
        document.getElementById(tabId).classList.remove('hidden-section');
        document.querySelectorAll('.profile-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabId);
        });
    }

    // ── Tier — drives #tierSelect so ui.js applyTierAccess() fires ──
    function setTier(btn) {
        document.querySelectorAll('.tier-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const map = { 'Basic': 'free', 'Pro': 'paid', 'Premium': 'premium' };
        const value = map[btn.textContent.trim()] || 'free';
        const sel = document.getElementById('tierSelect');
        if (sel && sel.value !== value) { sel.value = value; sel.dispatchEvent(new Event('change')); }
        const pill = document.getElementById('reading-tier-pill');
        if (pill) pill.textContent = btn.textContent.trim();
        updateExplorerSwatchState();
    }

    function updateTierPill() {
        const sel  = document.getElementById('tierSelect');
        const pill = document.getElementById('reading-tier-pill');
        if (!sel || !pill) return;
        const map = { free: 'Basic', paid: 'Pro', premium: 'Premium' };
        pill.textContent = map[sel.value] || 'Basic';
    }

    function getCurrentTier() {
        const sel = document.getElementById('tierSelect');
        if (sel && sel.value) return sel.value;
        return (typeof appTier !== 'undefined' && appTier) ? appTier : 'free';
    }

    // ── Theme ────────────────────────────────────────────────────
    function setTheme(theme, btn) {
        document.body.classList.remove('theme-green', 'theme-purple', 'theme-explorer');
        if (theme !== 'default') document.body.classList.add('theme-' + theme);
        document.querySelectorAll('#theme-swatches .theme-swatch').forEach(s => s.classList.remove('selected'));
        btn.querySelector('.theme-swatch').classList.add('selected');
    }

    // Explorer swatch: unlock for paid/premium, gate for free
    function handleExplorerSwatch() {
        const tier = getCurrentTier();
        if (tier === 'free') {
            openModal('pricing-modal');
        } else {
            setTheme('explorer', document.getElementById('explorer-swatch-btn'));
        }
    }

    function updateExplorerSwatchState() {
        const btn  = document.getElementById('explorer-swatch-btn');
        const tier = getCurrentTier();
        if (!btn) return;
        if (tier === 'free') {
            btn.classList.add('explorer-locked');
            btn.title = 'Upgrade to Pro+ to unlock Explorer theme';
            btn.querySelector('.theme-swatch').style.opacity = '0.6';
        } else {
            btn.classList.remove('explorer-locked');
            btn.title = 'Explorer theme';
            btn.querySelector('.theme-swatch').style.opacity = '1';
        }
    }

    function promptExplorerUpgrade() { openModal('pricing-modal'); }

    // ── TTS speed bridge ─────────────────────────────────────────

    function shellSetSpeed(value) {
        const rate = parseFloat(value) || 1;
        if (typeof window.setPlaybackRate === 'function') {
            window.setPlaybackRate(rate);
        } else {
            try { localStorage.setItem('rc_tts_speed', String(rate)); } catch(_) {}
        }
        const sel = document.getElementById('shell-speed');
        if (sel) sel.value = String(rate);
        try {
            if (typeof window.applyCurrentPlaybackRate === 'function') window.applyCurrentPlaybackRate();
        } catch(_) {}
    }

    function hasActiveReadingCards() {
        const reading = document.getElementById('reading-mode');
        const pagesEl = document.getElementById('pages');
        return !!(reading && !reading.classList.contains('hidden-section') && pagesEl && pagesEl.querySelector('.page'));
    }

    function clearImporterTransientUI() {
        const inp = document.getElementById('importFileInput');
        if (inp) inp.value = '';
        const dropzone = document.getElementById('importDropzone');
        if (dropzone) dropzone.classList.remove('is-dragover');
        const uploadStatus = document.getElementById('importUploadStatus');
        if (uploadStatus) { uploadStatus.style.display = 'none'; uploadStatus.textContent = ''; }
        const scanBtn = document.getElementById('importScanBtn');
        if (scanBtn) scanBtn.disabled = true;
        const stageUpload = document.getElementById('importStageUpload');
        const stagePick = document.getElementById('importStagePick');
        const stageProgress = document.getElementById('importStageProgress');
        if (stageUpload) stageUpload.style.display = '';
        if (stagePick) stagePick.style.display = 'none';
        if (stageProgress) stageProgress.style.display = 'none';
        const selectionMeta = document.getElementById('importSelectionMeta');
        if (selectionMeta) selectionMeta.textContent = 'Selected: 0';
        const filter = document.getElementById('importFilter');
        if (filter) filter.value = '';
        const tocList = document.getElementById('importTocList');
        if (tocList) tocList.innerHTML = '';
        const previewTitle = document.getElementById('importPreviewTitle');
        if (previewTitle) previewTitle.textContent = 'Select a section';
        const previewBody = document.getElementById('importPreviewBody');
        if (previewBody) previewBody.textContent = "You'll see a short preview here.";
        const advPanel = document.getElementById('importAdvancedPanel');
        if (advPanel) advPanel.style.display = 'none';
        const progressFill = document.getElementById('importProgressFill');
        if (progressFill) progressFill.style.width = '0%';
        const progressMeta = document.getElementById('importProgressMeta');
        if (progressMeta) progressMeta.textContent = 'Preparing';
        const progressDetail = document.getElementById('importProgressDetail');
        if (progressDetail) progressDetail.textContent = '0 pages created';
        const doneBtn = document.getElementById('importDoneBtn');
        if (doneBtn) doneBtn.style.display = 'none';
    }

    function cleanupReadingTransientState() {
        try { if (typeof window.exitReadingSession === 'function') window.exitReadingSession(); } catch(_) {}
        const vol = document.getElementById('volumePanel');
        if (vol) vol.style.display = 'none';
        const badge = document.getElementById('shell-countdown-badge');
        if (badge) badge.remove();
        const signal = document.getElementById('session-complete');
        if (signal) signal.classList.add('hidden-section');
        const prog = document.getElementById('shell-page-progress');
        if (prog) prog.textContent = '—';
        _readingStartTime = null;
    }

    // ── Bottom bar controls ──────────────────────────────────────

    // Pause/Play — calls app's tts.js functions if available.
    // Guards against first-use case where TTS was never started (TTS_STATE.activeKey is null).
    function syncPausePlayButton() {
        const btn = document.getElementById('shell-pause-btn');
        const prevBtn = document.getElementById('tts-prev-btn');
        const nextBtn = document.getElementById('tts-next-btn');
        if (!btn) return;
        let status = { active: false, paused: false };
        let countdown = { active: false };
        try { if (typeof window.getPlaybackStatus === 'function') status = window.getPlaybackStatus() || status; } catch(_) {}
        try { if (typeof window.getCountdownStatus === 'function') countdown = window.getCountdownStatus() || countdown; } catch(_) {}
        const active = !!status.active;
        const paused = !!status.paused;
        const countdownActive = !!countdown.active;
        const speaking = active && !countdownActive;
        syncPlaybackUiAvailability();
        if (btn.disabled && !speaking && !countdownActive) return;
        btn.classList.toggle('active', speaking && paused);
        const compact = isCompactPlaybackView();
        btn.title = speaking ? (paused ? 'Resume narration' : 'Pause narration') : 'Play current page';
        btn.innerHTML = (speaking && !paused)
            ? (`<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>${compact ? '' : ' Pause'}`)
            : (`<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>${compact ? '' : ' Play'}`);
        [prevBtn, nextBtn].forEach((control) => {
            if (!control) return;
            control.disabled = !speaking;
            control.setAttribute('aria-disabled', (!speaking).toString());
        });
    }


    function syncPlaybackUiAvailability() {
        let support = { playable: true, freePlayable: true, reason: '', tier: 'free' };
        try { if (typeof window.getTtsSupportStatus === 'function') support = window.getTtsSupportStatus() || support; } catch(_) {}
        const unavailable = !support.playable;
        const reason = support.reason || 'Playback is unavailable on this device.';
        const playBtn = document.getElementById('shell-pause-btn');
        if (playBtn) {
            playBtn.disabled = unavailable;
            playBtn.setAttribute('aria-disabled', String(unavailable));
            playBtn.title = unavailable ? reason : 'Play current page';
        }
        document.querySelectorAll('.tts-btn[data-tts="page"]').forEach((btn) => {
            btn.disabled = unavailable;
            btn.setAttribute('aria-disabled', String(unavailable));
            if (unavailable) btn.title = reason;
            else btn.removeAttribute('title');
        });
        const autoplayBtn = document.getElementById('shell-autoplay-btn');
        if (autoplayBtn) {
            autoplayBtn.disabled = unavailable;
            autoplayBtn.setAttribute('aria-disabled', String(unavailable));
            if (unavailable) autoplayBtn.title = reason;
            else autoplayBtn.removeAttribute('title');
        }
        const settingsBtn = document.getElementById('openReadingSettings');
        if (settingsBtn) settingsBtn.title = unavailable ? reason : 'Reading settings';
    }

    function isCompactPlaybackView() {
        try { return !!window.matchMedia && window.matchMedia('(max-width: 640px)').matches; } catch (_) { return window.innerWidth <= 640; }
    }

    function handlePausePlay() {
        let status = { active: false, paused: false };
        let countdown = { active: false };
        try { if (typeof window.getPlaybackStatus === 'function') status = window.getPlaybackStatus() || status; } catch(_) {}
        try { if (typeof window.getCountdownStatus === 'function') countdown = window.getCountdownStatus() || countdown; } catch(_) {}
        if (!status.active) {
            try {
                if (countdown.active && typeof window.restartLastSpokenPageTts === 'function' && window.restartLastSpokenPageTts()) {
                    setTimeout(syncPausePlayButton, 0);
                    return;
                }
                if (typeof window.startFocusedPageTts === 'function' && window.startFocusedPageTts()) {
                    setTimeout(syncPausePlayButton, 0);
                    return;
                }
            } catch(_) {}
        }
        try { if (typeof window.pauseOrResumeReading === 'function') window.pauseOrResumeReading(); } catch(_) {}
        syncPausePlayButton();
    }

    function handleTtsStep(delta) {
        let moved = false;
        try { if (typeof window.ttsJumpSentence === 'function') moved = !!window.ttsJumpSentence(delta); } catch(_) {}
        if (!moved) {
            try { if (typeof window.ttsJumpPage === 'function') moved = !!window.ttsJumpPage(delta); } catch(_) {}
        }
        syncPausePlayButton();
        return moved;
    }

    function syncAutoplayButton() {
        const checkbox = document.getElementById('autoplayToggle');
        if (!checkbox) return;
        let enabled = false;
        try { if (typeof window.getAutoplayStatus === 'function') enabled = !!window.getAutoplayStatus().enabled; } catch(_) {}
        checkbox.checked = enabled;
    }

    function handleAutoplayToggle(force) {
        try { if (typeof window.toggleAutoplay === 'function') window.toggleAutoplay(force); } catch(_) {}
        syncAutoplayButton();
    }

    function handleOpenReadingSettings() {
        try {
            if (typeof window.toggleReadingSettingsModal === 'function') {
                window.toggleReadingSettingsModal('sound');
                return true;
            }
            if (typeof window.openReadingSettingsModal === 'function') {
                window.openReadingSettingsModal('sound');
                return true;
            }
        } catch(_) {}
        const panel = document.getElementById('volumePanel');
        const trigger = document.getElementById('openReadingSettings') || document.getElementById('musicToggle');
        if (!panel) return false;
        try {
            const isOpen = panel.style.display === 'flex' || panel.style.display === 'block' || !panel.classList.contains('hidden-section');
            if (isOpen) {
                panel.style.display = 'none';
                panel.classList.add('hidden-section');
                panel.setAttribute('aria-hidden', 'true');
                return true;
            }
            panel.style.display = 'flex';
            panel.classList.remove('hidden-section');
            panel.setAttribute('aria-hidden', 'false');
            if (trigger) {
                panel.style.visibility = 'hidden';
                const rect = trigger.getBoundingClientRect();
                const panelW = panel.offsetWidth || 320;
                const panelH = panel.offsetHeight || 420;
                const gap = 10;
                const top = Math.max(10, rect.bottom + gap > window.innerHeight ? rect.top - panelH - gap : rect.bottom + gap);
                const left = Math.min(window.innerWidth - panelW - 10, Math.max(10, rect.right - panelW));
                panel.style.top = `${top}px`;
                panel.style.left = `${left}px`;
                panel.style.visibility = 'visible';
            }
            return true;
        } catch(_) {
            return false;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const checkbox = document.getElementById('autoplayToggle');
        if (checkbox) {
            checkbox.addEventListener('change', () => {
                handleAutoplayToggle(checkbox.checked);
            });
        }
        const settingsBtn = document.getElementById('openReadingSettings');
        if (settingsBtn) settingsBtn.addEventListener('click', (e) => { e.preventDefault(); handleOpenReadingSettings(); });
        setTimeout(() => { updateTierPill(); updateExplorerSwatchState(); syncPlaybackUiAvailability(); syncPausePlayButton(); syncAutoplayButton(); }, 500);
        window.setInterval(() => {
            try {
                const readingMode = document.getElementById('reading-mode');
                if (readingMode && !readingMode.classList.contains('hidden-section')) {
                    syncPlaybackUiAvailability();
                    syncPausePlayButton();
                }
            } catch(_) {}
        }, 250);
        patchRefreshHook();

        const bookSel = document.getElementById('bookSelect');
        const chSel   = document.getElementById('chapterSelect');
        const loadBtn = document.getElementById('loadBookSelection');
        const pageStart = document.getElementById('pageStart');
        const pageEnd   = document.getElementById('pageEnd');
        if (bookSel && chSel && loadBtn && pageStart && pageEnd) {
            const waitForPages = (timeout = 2500) => new Promise(resolve => {
                const started = Date.now();
                (function poll() {
                    if (pageStart.options.length > 0 && pageEnd.options.length > 0 && pageStart.value !== '' && pageEnd.value !== '') return resolve(true);
                    if (Date.now() - started > timeout) return resolve(false);
                    setTimeout(poll, 50);
                })();
            });
            bookSel.addEventListener('change', async () => {
                if (document.getElementById('reading-mode')?.classList.contains('hidden-section')) return;
                const ready = await waitForPages();
                if (ready) {
                    loadBtn.click();
                    setTimeout(() => { try { if (typeof window.__jublyAfterRender === 'function') window.__jublyAfterRender(); } catch(_) {} }, 120);
                }
            });
            chSel.addEventListener('change', async () => {
                if (document.getElementById('reading-mode')?.classList.contains('hidden-section')) return;
                const ready = await waitForPages();
                if (ready) {
                    loadBtn.click();
                    setTimeout(() => { try { if (typeof window.__jublyAfterRender === 'function') window.__jublyAfterRender(); } catch(_) {} }, 120);
                }
            });
        }
    });

    // ── Library table — populated by __jublyLibraryRefresh hook called from library.js ──
    function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    async function refreshLibrary() {
        const rowsEl  = document.getElementById('library-rows');
        const popEl   = document.getElementById('library-populated');
        const emptyEl = document.getElementById('library-empty');
        const sub     = document.getElementById('dashboard-subtitle');
        if (!rowsEl) return;
        let books = [];
        try { if (typeof localBooksGetAll === 'function') books = await localBooksGetAll(); } catch(_) {}
        const has = books.length > 0;
        if (popEl)   popEl.classList.toggle('hidden-section', !has);
        if (emptyEl) emptyEl.classList.toggle('hidden-section', has);
        if (sub) sub.style.display = has ? '' : 'none';
        if (!has) return;
        books.sort((a, b) => (b.createdAt||0) - (a.createdAt||0));
        rowsEl.innerHTML = books.map(b => {
            const pages   = (String(b.markdown||'').match(/^\s*##\s+/gm)||[]).length;
            const date    = new Date(b.createdAt||Date.now()).toLocaleDateString();
            const estMins = Math.max(1, Math.round(pages * 1.5));
            const id      = ('local:' + String(b.id)).replace(/'/g,"\\'");
            const title   = escHtml(b.title||'Untitled');
            return `<div onclick="openPreview('${id}','${title.replace(/'/g,"\\'")}')" class="px-6 py-4 flex items-center hover:bg-slate-50 cursor-pointer transition-colors border-b border-slate-100">
                <div class="flex-grow flex items-center gap-3"><div class="w-8 h-8 rounded flex items-center justify-center text-lg bg-accent-soft text-accent flex-shrink-0">📄</div><div><p class="font-semibold text-slate-800 text-sm">${title}</p><p class="text-xs text-slate-400">Added ${date}</p></div></div>
                <div class="w-32 hidden md:block"><span class="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-bold">Unread</span></div>
                <div class="w-32 hidden md:block text-sm text-slate-500 font-medium">${estMins} min left</div>
                <div class="w-8 text-slate-300">→</div></div>`;
        }).join('');
    }
    // Hook called by library.js after populateBookSelectWithLocal()
    window.__jublyLibraryRefresh = refreshLibrary;

    function patchRefreshHook() {
        let tries = 0;
        const timer = setInterval(() => {
            tries += 1;
            if (typeof window.__rcRefreshBookSelect === 'function') {
                clearInterval(timer);
                const prev = window.__rcRefreshBookSelect;
                if (prev.__jublyWrapped) return;
                const wrapped = async function() {
                    const out = await prev.apply(this, arguments);
                    try { await refreshLibrary(); } catch(_) {}
                    return out;
                };
                wrapped.__jublyWrapped = true;
                window.__rcRefreshBookSelect = wrapped;
            } else if (tries >= 100) {
                clearInterval(timer);
            }
        }, 100);
    }

    // Scroll affordance — called by library.js via __jublyAfterRender after render()
    window.__jublyAfterRender = function() {
        document.querySelectorAll('#pages .page').forEach(function(pageEl) {
            const textEl = pageEl.querySelector('.page-text');
            if (!textEl || textEl.parentElement.classList.contains('page-text-wrap')) return;
            const wrap = document.createElement('div'); wrap.className = 'page-text-wrap';
            textEl.parentNode.insertBefore(wrap, textEl); wrap.appendChild(textEl);
            const fade = document.createElement('div'); fade.className = 'page-text-fade'; wrap.appendChild(fade);
            function checkScroll() {
                const atEnd = textEl.scrollHeight - textEl.scrollTop - textEl.clientHeight < 8;
                wrap.classList.toggle('scrolled-to-end', atEnd || textEl.scrollHeight <= textEl.clientHeight + 4);
            }
            textEl.addEventListener('scroll', checkScroll, { passive: true });
            setTimeout(checkScroll, 150);
        });
    };

    // ── Reading session ──────────────────────────────────────────
    let _previewBookId = null;
    function openPreview(id, title) {
        _previewBookId = id;
        const el = document.getElementById('preview-title');
        if (el) el.innerText = title || 'Book';
        openModal('preview-modal');
    }

    function startReading() {
        closeModal('preview-modal');
        const signal = document.getElementById('session-complete');
        if (signal) signal.classList.add('hidden-section');
        showSection('reading-mode');
        if (!_previewBookId) return;

        try {
            if (typeof window.startReadingFromPreview === 'function') {
                window.startReadingFromPreview(_previewBookId);
            }
        } catch(_) {}
    }

    // Empty state drag/drop
    function emptyStateDrop(e) {
        e.preventDefault();
        const zone = document.getElementById('empty-drop-zone');
        if (zone) { zone.style.borderColor = 'transparent'; zone.style.background = ''; }
        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || !files.length) return;
        const openBtn = document.getElementById('importBookBtn');
        if (openBtn) openBtn.click();
        else {
            const modal = document.getElementById('importBookModal');
            if (modal) { modal.style.display = 'flex'; modal.setAttribute('aria-hidden', 'false'); }
        }
        const inp = document.getElementById('importFileInput');
        if (inp) {
            try {
                const dt = new DataTransfer();
                dt.items.add(files[0]);
                inp.value = '';
                inp.files = dt.files;
                inp.dispatchEvent(new Event('change', { bubbles: true }));
            } catch(_) {}
        }
    }

    // ── F7: Reading time tracker (shell-only) ────────────────────
    let _readingStartTime = null;

    // Session complete signal — uses real pages[] and shell reading timer
    function showSessionComplete() {
        const signal = document.getElementById('session-complete');
        if (!signal || !hasActiveReadingCards()) return;
        const pageCount = (typeof pages !== 'undefined' && Array.isArray(pages)) ? pages.length : 0;
        const elapsed   = _readingStartTime ? Date.now() - _readingStartTime : 0;
        const mins      = elapsed > 0 ? Math.max(1, Math.round(elapsed / 60000)) : Math.max(1, Math.round(pageCount * 1.5));
        document.getElementById('stat-pages').textContent   = pageCount;
        document.getElementById('stat-minutes').textContent = mins;
        signal.classList.remove('hidden-section');
        signal.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Page progress bar — uses real pages[] from app state
    function updateProgressBar() {
        const prog  = document.getElementById('shell-page-progress');
        if (!prog) return;
        if (!hasActiveReadingCards()) { prog.textContent = '—'; return; }
        const total = (typeof pages !== 'undefined' && Array.isArray(pages)) ? pages.length : 0;
        const cur   = (typeof lastFocusedPageIndex === 'number' && lastFocusedPageIndex >= 0)
                        ? lastFocusedPageIndex : 0;
        prog.textContent = total > 0 ? `Page ${cur + 1} / ${total}` : '—';
    }

    // ── App event bridge ─────────────────────────────────────────
    // Called by app's goToNext() / nextCard equivalent at session end
    // The app will call showSessionComplete() directly once wired;
    // this is a fallback shim for the transition period.
    window.jublySessionComplete = showSessionComplete;

    document.addEventListener('DOMContentLoaded', () => {
        const tierSel = document.getElementById('tierSelect');
        if (tierSel) {
            tierSel.addEventListener('change', () => { updateTierPill(); updateExplorerSwatchState(); });
        }

        // After a successful import the engine fires Done; refresh shell library explicitly.
        const importDoneBtn = document.getElementById('importDoneBtn');
        if (importDoneBtn) {
            importDoneBtn.addEventListener('click', () => {
                try { refreshLibrary(); } catch(_) {}
                setTimeout(() => {
                    if (typeof window.resetImporterState === 'function') window.resetImporterState();
                    else clearImporterTransientUI();
                }, 0);
            });
        }
        const importCloseBtn = document.getElementById('importBookClose');
        if (importCloseBtn) {
            importCloseBtn.addEventListener('click', () => setTimeout(() => {
                if (typeof window.resetImporterState === 'function') window.resetImporterState();
                else clearImporterTransientUI();
            }, 0));
        }

        // Keep progress bar in sync as the user scrolls or focuses pages.
        const pagesEl = document.getElementById('pages');
        if (pagesEl) {
            pagesEl.addEventListener('scroll',  () => updateProgressBar());
            pagesEl.addEventListener('focusin', () => updateProgressBar());
        }


        // F3: Page advance pulse + end-of-book detection via MutationObserver.
        let _sessionCompletePending = false;
        const _pagesContainer = document.getElementById('pages');
        if (_pagesContainer) {
            new MutationObserver(() => {
                // Pulse progress indicator on any page advance.
                const prog = document.getElementById('shell-page-progress');
                if (prog && !prog.classList.contains('page-advance-pulse')) {
                    prog.classList.add('page-advance-pulse');
                    prog.addEventListener('animationend', () => prog.classList.remove('page-advance-pulse'), { once: true });
                }
                // Detect last page reached: active page is the last one.
                try {
                    if (!hasActiveReadingCards()) return;
                    const total = (typeof pages !== 'undefined' && Array.isArray(pages)) ? pages.length : 0;
                    if (total < 1) return;
                    const activeEl = _pagesContainer.querySelector('.page-active');
                    if (!activeEl) return;
                    const allPages = Array.from(_pagesContainer.querySelectorAll('.page'));
                    const activeIdx = allPages.indexOf(activeEl);
                    if (activeIdx === total - 1 && !_sessionCompletePending) {
                        _sessionCompletePending = true;
                        // 500ms debounce: wait to confirm no further page-active transition follows.
                        setTimeout(() => {
                            _sessionCompletePending = false;
                            const stillActive = _pagesContainer.querySelector('.page-active');
                            const stillLast   = stillActive && Array.from(_pagesContainer.querySelectorAll('.page')).indexOf(stillActive) === total - 1;
                            const countdown = (typeof window.getCountdownStatus === 'function') ? window.getCountdownStatus() : { active: false };
                            const noCountdown = !countdown.active;
                            if (stillLast && noCountdown) showSessionComplete();
                        }, 500);
                    }
                } catch(_) {}
            }, { attributes: true, subtree: true, attributeFilter: ['class'] });
        }

        // Exit reading: stop TTS, cancel autoplay, clear countdown poll before navigating away.
        // The button's inline onclick still fires (showSection) — this just cleans up first.
        const exitBtn = document.querySelector('.reading-top-exit');
        if (exitBtn) {
            exitBtn.addEventListener('click', () => cleanupReadingTransientState());
        }
    });

    // Engine scripts load dynamically after window.load; refresh shell library once boot settles.
    window.addEventListener('load', () => setTimeout(() => { refreshLibrary(); patchRefreshHook(); }, 350));

    if (typeof window !== 'undefined' && window.speechSynthesis) {
        try {
            window.speechSynthesis.addEventListener('voiceschanged', () => {
                syncPlaybackUiAvailability();
                syncPausePlayButton();
            });
        } catch (_) {}
    }

    function snapshotShellControl(selector) {
        const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!el) return null;
        let rect = null;
        try {
            const r = el.getBoundingClientRect();
            rect = { width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) };
        } catch (_) {}
        return {
            text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
            disabled: !!el.disabled,
            ariaDisabled: el.getAttribute('aria-disabled'),
            title: el.getAttribute('title') || '',
            className: el.className || '',
            rect
        };
    }

    function getShellDiagnosticsSnapshot() {
        const settingsPanel = document.getElementById('volumePanel');
        const topBar = document.getElementById('reading-top-bar');
        const bottomBar = document.querySelector('.reading-bottom-bar');
        const readingMode = document.getElementById('reading-mode');
        const pageBtns = Array.from(document.querySelectorAll('.tts-btn[data-tts="page"]'));
        return {
            readingVisible: !!(readingMode && !readingMode.classList.contains('hidden-section')),
            settingsOpen: !!(settingsPanel && settingsPanel.style.display !== 'none' && !settingsPanel.classList.contains('hidden-section')),
            controls: {
                settings: snapshotShellControl('#openReadingSettings'),
                exit: snapshotShellControl('.reading-top-exit'),
                play: snapshotShellControl('#shell-pause-btn'),
                prev: snapshotShellControl('#tts-prev-btn'),
                next: snapshotShellControl('#tts-next-btn'),
                autoplay: snapshotShellControl('#shell-autoplay-btn')
            },
            pageReadButtons: {
                count: pageBtns.length,
                disabledCount: pageBtns.filter((btn) => !!btn.disabled).length,
                activeCount: pageBtns.filter((btn) => btn.classList.contains('tts-active')).length,
                sample: pageBtns.slice(0, 3).map((btn) => snapshotShellControl(btn))
            },
            layout: {
                topBar: topBar ? { clientWidth: topBar.clientWidth, scrollWidth: topBar.scrollWidth } : null,
                topLeft: (() => {
                    const el = document.querySelector('#reading-top-bar .reading-top-left');
                    return el ? { clientWidth: el.clientWidth, scrollWidth: el.scrollWidth } : null;
                })(),
                bottomBar: bottomBar ? { clientWidth: bottomBar.clientWidth, scrollWidth: bottomBar.scrollWidth } : null
            }
        };
    }

    window.syncPlaybackUiAvailability = syncPlaybackUiAvailability;
    window.handleOpenReadingSettings = handleOpenReadingSettings;
    window.getShellDiagnosticsSnapshot = getShellDiagnosticsSnapshot;
