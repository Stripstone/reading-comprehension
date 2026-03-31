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


    let SHELL_DEBUG = {
        seq: 0,
        lastPlaybackSync: null,
        lastControlAction: null,
        lastSkipAction: null,
        lastProgressSnapshot: null
    };
    function shellDebugRemember(slot, data) {
        const entry = Object.assign({ seq: ++SHELL_DEBUG.seq, at: new Date().toISOString() }, data || {});
        SHELL_DEBUG[slot] = entry;
        try { if (typeof updateDiagnostics === 'function') updateDiagnostics(); } catch (_) {}
        return entry;
    }

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

        // Reading mode: hide nav for focus, restore on exit
        const mainNav = document.querySelector('nav');
        if (mainNav) mainNav.style.display = id === 'reading-mode' ? 'none' : '';
        if (wasReading && id !== 'reading-mode') {
            try {
                let exitResult = null;
                if (typeof exitReadingSession === 'function') exitResult = exitReadingSession();
                else cleanupReadingTransientState();
                // PATCH(diagnostics): record exit result in shell debug so it appears in getShellDiagnosticsSnapshot()
                shellDebugRemember('lastControlAction', { type: 'exit-reading', exitResult });
            } catch(_) {}
        }
        if (id === 'reading-mode') {
            initFocusMode();
            updateTierPill();
            updateExplorerSwatchState();
            updateProgressBar();
            // (label mutation removed — layout handled purely in CSS)
        }
        if (id === 'dashboard') refreshLibrary();
        try { if (typeof window.syncDiagnosticsVisibility === 'function') window.syncDiagnosticsVisibility(); } catch (_) {}

        window.scrollTo(0, 0);
    }

    // ── Focus mode fade ──────────────────────────────────────────
    let focusModeTimer   = null;
    let focusModeHandler = null;

    function initFocusMode() {
        const bar = document.getElementById('reading-top-bar');
        const rm  = document.getElementById('reading-mode');
        if (!bar || !rm) return;
        if (focusModeHandler) {
            ['mousemove', 'scroll', 'touchstart', 'click'].forEach(ev =>
                rm.removeEventListener(ev, focusModeHandler));
        }
        focusModeHandler = null;
        clearTimeout(focusModeTimer);
        focusModeTimer = null;
        bar.classList.remove('faded');
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

    // ── F1: TTS Speed Control bridge ─────────────────────────────
    function shellSetSpeed(value) {
        const rate = parseFloat(value) || 1;
        try { if (typeof setPlaybackRate === 'function') return setPlaybackRate(rate); } catch(_) {}
        return rate;
    }

    function hasActiveReadingCards() {
        const reading = document.getElementById('reading-mode');
        const pagesEl = document.getElementById('pages');
        return !!(reading && !reading.classList.contains('hidden-section') && pagesEl && pagesEl.querySelector('.page'));
    }

    // PATCH(authority-boundary): Shell no longer directly manipulates importer DOM.
    // resetImporterState() in import.js is the single authoritative path:
    // it clears UI and all internal parser state (_file, _zip, _tocItems, etc.)
    // so the next open is always clean. The old shell version only reset UI,
    // leaving internal state dirty and allowing stale file/parse data to persist.
    function clearImporterTransientUI() {
        try { if (typeof resetImporterState === 'function') resetImporterState({ keepModalOpen: false }); } catch(_) {}
    }

    // PATCH(authority-boundary): Shell no longer owns runtime cleanup.
    // exitReadingSession() in library.js is the single authoritative path:
    // it stops TTS, cancels countdown, clears music, and emits diagnostics.
    function cleanupReadingTransientState() {
        try { if (typeof exitReadingSession === 'function') exitReadingSession(); } catch(_) {}
    }

    // ── Bottom bar controls ──────────────────────────────────────

    // Pause/Play — calls app's tts.js functions if available.
    // Guards against first-use case where TTS was never started (TTS_STATE.activeKey is null).
    function syncShellPlaybackControls() {
        const btn = document.getElementById('shell-play-btn');
        const labelEl = document.getElementById('shell-play-label');
        const iconEl = btn ? btn.querySelector('.shell-play-icon') : null;
        const prevBtn = document.getElementById('shell-prev-btn');
        const nextBtn = document.getElementById('shell-next-btn');
        let status = { active: false, paused: false };
        let countdown = { active: false };
        let support = { playable: true, reason: '' };
        let eligibility = { canPlay: false, canPause: false, canResume: false, canSkipPrev: false, canSkipNext: false, reasons: {} };
        try { if (typeof getPlaybackStatus === 'function') status = getPlaybackStatus() || status; } catch (_) {}
        try { if (typeof getCountdownStatus === 'function') countdown = getCountdownStatus() || countdown; } catch (_) {}
        try { if (typeof getTtsSupportStatus === 'function') support = getTtsSupportStatus() || support; } catch (_) {}
        try { if (typeof getPlaybackControlEligibility === 'function') eligibility = getPlaybackControlEligibility() || eligibility; } catch (_) {}
        const canPlay = !!eligibility.canPlay;
        if (btn) {
            const label = eligibility.canResume ? 'Resume' : (eligibility.canPause ? 'Pause' : 'Play');
            btn.classList.toggle('active', !!status.active && !status.paused);
            btn.title = status.active ? (status.paused ? 'Resume narration' : 'Pause narration') : (countdown.active ? 'Resume current page from countdown' : 'Play current page');
            btn.disabled = !canPlay;
            btn.setAttribute('aria-disabled', String(!canPlay));
            if (labelEl) labelEl.textContent = label;
            if (iconEl) {
                iconEl.innerHTML = label === 'Pause'
                    ? '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>'
                    : '<polygon points="8 5 19 12 8 19 8 5"></polygon>';
            }
        }
        [prevBtn, nextBtn].forEach((control) => {
            if (!control) return;
            const isPrev = control === prevBtn;
            const canSkip = isPrev ? !!eligibility.canSkipPrev : !!eligibility.canSkipNext;
            const reason = isPrev
                ? (eligibility.reasons?.canSkipPrev || 'Skip unavailable')
                : (eligibility.reasons?.canSkipNext || 'Skip unavailable');
            control.disabled = !canSkip;
            control.setAttribute('aria-disabled', String(!canSkip));
            control.title = canSkip ? control.title.replace('disabled','').trim() : `Skip unavailable: ${reason}`;
        });
        document.querySelectorAll('.tts-btn[data-tts="page"]').forEach((pageBtn) => {
            const disabled = !support.playable && !pageBtn.classList.contains('tts-active');
            pageBtn.disabled = disabled;
            pageBtn.setAttribute('aria-disabled', String(disabled));
            if (disabled) pageBtn.title = support.reason || 'Playback unavailable';
            else pageBtn.removeAttribute('title');
        });
        // PATCH(speed-sync): Keep #shell-speed in sync with TTS_STATE.rate.
        // Previously, if setPlaybackRate() was called from any path other than
        // the shell select itself (e.g. programmatic change, restored preference),
        // the select remained stale. Now it always reflects runtime truth.
        try {
            const speedSel = document.getElementById('shell-speed');
            const runtimeRate = String(Number(status.playbackRate || 1));
            if (speedSel && speedSel.value !== runtimeRate) {
                // Only update if the value exists as an option, to avoid
                // leaving the select in an invalid/blank state.
                const hasOpt = Array.from(speedSel.options).some(o => o.value === runtimeRate);
                if (hasOpt) speedSel.value = runtimeRate;
            }
        } catch (_) {}

        shellDebugRemember('lastPlaybackSync', {
            type: 'playback-sync',
            playback: status,
            countdown,
            support,
            eligibility,
            speedSynced: true,
            controls: {
                playDisabled: !!(btn && btn.disabled),
                prevDisabled: !!(prevBtn && prevBtn.disabled),
                nextDisabled: !!(nextBtn && nextBtn.disabled),
                blockedReasons: {
                    play: (!canPlay && eligibility.reasons) ? (eligibility.reasons.canPlay || '') : null,
                    prev: (!eligibility.canSkipPrev && eligibility.reasons) ? (eligibility.reasons.canSkipPrev || '') : null,
                    next: (!eligibility.canSkipNext && eligibility.reasons) ? (eligibility.reasons.canSkipNext || '') : null,
                }
            }
        });
    }

    function handlePausePlay() {
        // Use runtime eligibility as the routing signal rather than raw status.active.
        // eligibility.canResume encodes the correct intent (has active paused session)
        // and is false in post-error states where activeKey=null even if browserPaused=true.
        // This prevents the shell from making routing decisions based on ambiguous state.
        let status = { active: false, paused: false };
        let countdown = { active: false };
        let eligibility = { canPlay: false, canPause: false, canResume: false };
        try { if (typeof getPlaybackStatus === 'function') status = getPlaybackStatus() || status; } catch (_) {}
        try { if (typeof getCountdownStatus === 'function') countdown = getCountdownStatus() || countdown; } catch (_) {}
        try { if (typeof getPlaybackControlEligibility === 'function') eligibility = getPlaybackControlEligibility() || eligibility; } catch (_) {}
        const before = { playback: status, countdown, eligibility };
        let route = 'pause-or-resume';
        let result = false;
        try {
            if (eligibility.canResume) {
                // Active paused session exists — delegate Resume to runtime.
                route = 'pause-or-resume-reading';
                result = !!pauseOrResumeReading();
                // Sync controls immediately so prev/next reflect resumed state.
                setTimeout(syncShellPlaybackControls, 0);
            } else if (eligibility.canPause) {
                // Actively speaking — delegate Pause to runtime.
                route = 'pause-or-resume-reading';
                result = !!pauseOrResumeReading();
                // Sync controls immediately after pause so prev/next remain enabled.
                setTimeout(syncShellPlaybackControls, 0);
            } else {
                // No active session. Start from the current focused page.
                // Countdown takes priority: user expects to restart the timed page.
                if (countdown.active && typeof restartLastSpokenPageTts === 'function') {
                    route = 'restart-last-spoken-page';
                    result = !!restartLastSpokenPageTts();
                } else if (typeof startFocusedPageTts === 'function') {
                    route = 'start-focused-page';
                    result = !!startFocusedPageTts();
                }
                if (result) {
                    setTimeout(syncShellPlaybackControls, 0);
                    shellDebugRemember('lastControlAction', { type: 'play-toggle', route, before, result: true, after: (typeof getPlaybackStatus === 'function') ? getPlaybackStatus() : null });
                    return true;
                }
            }
        } catch (_) {}
        syncShellPlaybackControls();
        shellDebugRemember('lastControlAction', { type: 'play-toggle', route, before, result: !!result, after: (typeof getPlaybackStatus === 'function') ? getPlaybackStatus() : null });
        return result;
    }

    // PATCH(autoplay-authority): was a dead stub returning false.
    // toggleAutoplay() in tts.js is the runtime owner of autoplay state.
    // Shell forwards the intent and syncs the checkbox so the hidden #autoplayToggle
    // reflects truth (ui.js reads it on boot, and the settings panel shows it).
    function handleAutoplayToggle() {
        let next = false;
        try { if (typeof toggleAutoplay === 'function') next = !!toggleAutoplay(); } catch(_) {}
        try {
            const cb = document.getElementById('autoplayToggle');
            if (cb) cb.checked = next;
        } catch(_) {}
        shellDebugRemember('lastControlAction', { type: 'autoplay-toggle', enabled: next });
        return next;
    }



    function handleTtsStep(delta) {
        const before = {
            playback: (typeof getPlaybackStatus === 'function') ? getPlaybackStatus() : null,
            countdown: (typeof getCountdownStatus === 'function') ? getCountdownStatus() : null,
            runtime: (typeof getRuntimeUiState === 'function') ? getRuntimeUiState() : null
        };
        let moved = false;
        let route = 'unavailable';
        try { if (typeof ttsJumpSentence === 'function') { moved = !!ttsJumpSentence(delta); if (moved) route = 'sentence-jump'; } } catch (_) {}
        if (!moved) {
            try { if (typeof ttsJumpPage === 'function') { moved = !!ttsJumpPage(delta); if (moved) route = 'page-jump'; } } catch (_) {}
        }
        syncShellPlaybackControls();
        shellDebugRemember('lastSkipAction', {
            type: 'skip',
            delta,
            route,
            moved,
            before,
            after: {
                playback: (typeof getPlaybackStatus === 'function') ? getPlaybackStatus() : null,
                countdown: (typeof getCountdownStatus === 'function') ? getCountdownStatus() : null,
                runtime: (typeof getRuntimeUiState === 'function') ? getRuntimeUiState() : null,
                tts: (typeof getTtsDiagnosticsSnapshot === 'function') ? getTtsDiagnosticsSnapshot() : null
            }
        });
        return moved;
    }

    document.addEventListener('DOMContentLoaded', () => {
        // Sync tier pill and explorer swatch once app has loaded
        setTimeout(() => { updateTierPill(); updateExplorerSwatchState(); }, 500);
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
        try { if (typeof startReadingFromPreview === 'function') startReadingFromPreview(_previewBookId); } catch (_) {}
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
        if (!hasActiveReadingCards()) { prog.textContent = '—'; shellDebugRemember('lastProgressSnapshot', { type: 'progress', visible: false, label: '—' }); return; }
        const total = (typeof pages !== 'undefined' && Array.isArray(pages)) ? pages.length : 0;
        const cur   = (typeof lastFocusedPageIndex === 'number' && lastFocusedPageIndex >= 0)
                        ? lastFocusedPageIndex : 0;
        prog.textContent = total > 0 ? `Page ${cur + 1} / ${total}` : '—';
        shellDebugRemember('lastProgressSnapshot', { type: 'progress', visible: true, label: prog.textContent, current: cur, total });
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
                setTimeout(() => { try { if (typeof resetImporterState === 'function') resetImporterState({ keepModalOpen: false }); } catch(_) {} }, 0)
            });
        }
        const importCloseBtn = document.getElementById('importBookClose');
        if (importCloseBtn) {
            importCloseBtn.addEventListener('click', () => setTimeout(() => { try { if (typeof resetImporterState === 'function') resetImporterState({ keepModalOpen: false }); } catch(_) {} }, 0));
        }

        // Keep progress bar in sync as the user scrolls or focuses pages.
        const pagesEl = document.getElementById('pages');
        if (pagesEl) {
            pagesEl.addEventListener('scroll',  () => updateProgressBar());
            pagesEl.addEventListener('focusin', () => updateProgressBar());
        }

        // F2: Autoplay countdown badge — polls AUTOPLAY_STATE every 300ms, shows badge on button.
        let _countdownInterval = null;
        function _startCountdownPoll() {
            if (_countdownInterval) return;
            _countdownInterval = setInterval(() => {
                const btn = document.getElementById('shell-next-btn');
                if (!btn) return;
                let badge = document.getElementById('shell-countdown-badge');
                try {
                    if (!hasActiveReadingCards()) { if (badge) badge.remove(); return; }
                    const countdown = (typeof getCountdownStatus === 'function') ? getCountdownStatus() : { pageIndex: -1, seconds: 0 };
                    const idx = countdown.pageIndex;
                    const sec = countdown.seconds;
                    if (idx !== -1 && sec > 0) {
                        if (!badge) {
                            badge = document.createElement('span');
                            badge.id = 'shell-countdown-badge';
                            badge.style.cssText = 'margin-left:4px; font-size:0.65rem; font-weight:800; color:var(--theme-accent); background:var(--theme-accent-soft); border-radius:999px; padding:1px 6px;';
                            btn.appendChild(badge);
                        }
                        badge.textContent = `Next: ${sec}…`;
                    } else if (badge) {
                        badge.remove();
                    }
                } catch(_) { if (badge) badge.remove(); }
            }, 300);
        }
        _startCountdownPoll();

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
                            const cd = (typeof getCountdownStatus === 'function') ? getCountdownStatus() : { active: false }; const noCountdown = !cd.active;
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
            exitBtn.addEventListener('click', () => { try { syncShellPlaybackControls(); } catch(_) {} });
        }

        setInterval(() => {
            try { syncShellPlaybackControls(); } catch(_) {}
            try { updateProgressBar(); } catch(_) {}
        }, 350);
    });

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

    window.getShellDiagnosticsSnapshot = function getShellDiagnosticsSnapshot() {
        const topBar = document.getElementById('reading-top-bar');
        const bottomBar = document.querySelector('.reading-bottom-bar');
        const readingMode = document.getElementById('reading-mode');
        const pageBtns = Array.from(document.querySelectorAll('.tts-btn[data-tts="page"]'));
        const topCluster = document.querySelector('#reading-top-bar .reading-top-left');
        const topActions = document.querySelector('#reading-top-bar .reading-top-actions');
        const bottomCluster = document.querySelector('.reading-bottom-bar .reading-bottom-left');
        const bottomActions = document.querySelector('.reading-bottom-bar .reading-bottom-actions');
        const progress = document.getElementById('shell-page-progress');
        return {
            readingVisible: !!(readingMode && !readingMode.classList.contains('hidden-section')),
            settingsOpen: !!(typeof window.isReadingSettingsModalOpen === 'function' && window.isReadingSettingsModalOpen()),
            progressLabel: progress ? progress.textContent : null,
            playback: (typeof window.getPlaybackStatus === 'function') ? window.getPlaybackStatus() : null,
            countdown: (typeof window.getCountdownStatus === 'function') ? window.getCountdownStatus() : null,
            support: (typeof window.getTtsSupportStatus === 'function') ? window.getTtsSupportStatus() : null,
            runtime: (typeof window.getRuntimeUiState === 'function') ? window.getRuntimeUiState() : null,
            tts: (typeof window.getTtsDiagnosticsSnapshot === 'function') ? window.getTtsDiagnosticsSnapshot() : null,
            controls: {
                settings: snapshotShellControl('#openReadingSettings'),
                exit: snapshotShellControl('.reading-top-exit'),
                previous: snapshotShellControl('#shell-prev-btn'),
                play: snapshotShellControl('#shell-play-btn'),
                next: snapshotShellControl('#shell-next-btn')
            },
            pageReadButtons: {
                count: pageBtns.length,
                disabledCount: pageBtns.filter((btn) => !!btn.disabled).length,
                activeCount: pageBtns.filter((btn) => btn.classList.contains('tts-active')).length,
                sample: pageBtns.slice(0, 3).map((btn) => snapshotShellControl(btn))
            },
            debug: SHELL_DEBUG,
            layout: {
                topBar: topBar ? { clientWidth: topBar.clientWidth, scrollWidth: topBar.scrollWidth } : null,
                topCluster: topCluster ? { clientWidth: topCluster.clientWidth, scrollWidth: topCluster.scrollWidth, offsetLeft: topCluster.offsetLeft } : null,
                topActions: topActions ? { clientWidth: topActions.clientWidth, offsetLeft: topActions.offsetLeft } : null,
                bottomBar: bottomBar ? { clientWidth: bottomBar.clientWidth, scrollWidth: bottomBar.scrollWidth } : null,
                bottomCluster: bottomCluster ? { clientWidth: bottomCluster.clientWidth, scrollWidth: bottomCluster.scrollWidth, offsetLeft: bottomCluster.offsetLeft } : null,
                bottomActions: bottomActions ? { clientWidth: bottomActions.clientWidth, offsetLeft: bottomActions.offsetLeft } : null
            }
        };
    };
    // Engine scripts load dynamically after window.load; refresh shell library once boot settles.
    window.addEventListener('load', () => setTimeout(() => { refreshLibrary(); patchRefreshHook(); }, 350));
