// Split from original app.js during role-based phase-1 restructure.
// File: ui.js
// Note: This is still global-script architecture (no bundler/modules required).

  // ☰ Mobile Top Menu
  // ===================================

  (function initTopMenu() {
    const btn = document.getElementById('topMenuBtn');
    const menu = document.getElementById('topMenu');
    const mHow = document.getElementById('topMenuHow');
    const mImport = document.getElementById('topMenuImport');
    const mLib = document.getElementById('topMenuLibrary');

    const howBtn = document.getElementById('howItWorksBtn');
    const importBtn = document.getElementById('importBookBtn');
    const libBtn = document.getElementById('manageLibraryBtn');

    if (!btn || !menu) return;

    function toggle(force) {
      const willOpen = typeof force === 'boolean' ? force : (menu.style.display === 'none' || !menu.style.display);
      menu.style.display = willOpen ? 'block' : 'none';
      btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });

    document.addEventListener('click', () => toggle(false));
    menu.addEventListener('click', (e) => e.stopPropagation());

    mHow?.addEventListener('click', () => { toggle(false); howBtn?.click(); });
    mImport?.addEventListener('click', () => { toggle(false); importBtn?.click(); });
    mLib?.addEventListener('click', () => { toggle(false); libBtn?.click(); });
  })();

  // ===================================
  // 📘 How This Works (Instructions Modal)
  // ===================================

  (function initHowItWorksModal() {
    const btn = document.getElementById('howItWorksBtn');
    const modal = document.getElementById('howItWorksModal');
    const closeBtn = document.getElementById('howItWorksClose');
    const donateBtn = document.getElementById('donateBtn');

    // Wire donate link from config if present
    try {
      if (donateBtn && typeof BUY_ME_A_COFFEE_URL === 'string' && BUY_ME_A_COFFEE_URL.trim()) {
        donateBtn.href = BUY_ME_A_COFFEE_URL.trim();
      }
    } catch (_) {
      // ignore
    }


    // Support footer is now static at the bottom of the page (no banner logic).

    function openModal() {
      if (!modal) return;
      modal.style.display = 'flex';
      modal.setAttribute('aria-hidden', 'false');
      // Focus close for accessibility
      if (closeBtn) closeBtn.focus();
    }

    function closeModal() {
      if (!modal) return;
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
      if (btn) btn.focus();
    }

    if (btn) btn.addEventListener('click', openModal);
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    // Click outside modal closes
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }

    // ESC closes
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
        closeModal();
      }
    });
  })();

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
    let diagClearCacheBtn = null;
    let diagCopyBtn = null;

    // URL flag: show diagnostics when debug is present/truthy.
    const debugEnabled = isDebugEnabledFromUrl();

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
      const voiceFemaleBtn = document.getElementById('voiceFemaleBtn');
      const voiceMaleBtn = document.getElementById('voiceMaleBtn');
      const sliders = {
        voice: document.getElementById('vol_voice'),
        music: document.getElementById('vol_music'),
        sand: document.getElementById('vol_sand'),
        stone: document.getElementById('vol_stone'),
        reward: document.getElementById('vol_reward'),
        compass: document.getElementById('vol_compass'),
        pageTurn: document.getElementById('vol_pageTurn'),
        evaluate: document.getElementById('vol_evaluate'),
      };

      function syncSlidersFromState() {
        if (sliders.voice) sliders.voice.value = String(Math.max(0, Math.min(1, Number(TTS_STATE.volume ?? 1))));
        if (sliders.music) sliders.music.value = String(music.volume);
        if (sliders.sand) sliders.sand.value = String(sandSound.volume);
        if (sliders.stone) sliders.stone.value = String(stoneSound.volume);
        if (sliders.reward) sliders.reward.value = String(rewardSound.volume);
        if (sliders.compass) sliders.compass.value = String(compassSound.volume);
        if (sliders.pageTurn) sliders.pageTurn.value = String(pageTurnSound.volume);
        if (sliders.evaluate) sliders.evaluate.value = String(evaluateSound.volume);

        // Sync voice variant toggle
        const vv = String(TTS_STATE.voiceVariant || 'female').toLowerCase();
        if (voiceFemaleBtn && voiceMaleBtn) {
          const isFemale = vv !== 'male';
          voiceFemaleBtn.setAttribute('aria-pressed', String(isFemale));
          voiceMaleBtn.setAttribute('aria-pressed', String(!isFemale));
          voiceFemaleBtn.classList.toggle('is-active', isFemale);
          voiceMaleBtn.classList.toggle('is-active', !isFemale);
        }
      }

      function setVoiceVariant(v) {
        const vv = String(v || '').toLowerCase() === 'male' ? 'male' : 'female';
        TTS_STATE.voiceVariant = vv;
        try { localStorage.setItem('rc_voice_variant', vv); } catch (_) {}
        syncSlidersFromState();
      }

      if (voiceFemaleBtn) voiceFemaleBtn.addEventListener('click', () => setVoiceVariant('female'));
      if (voiceMaleBtn) voiceMaleBtn.addEventListener('click', () => setVoiceVariant('male'));

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
      diagBtn.id = 'diagnosticsToggle';
      diagBtn.type = 'button';
      diagBtn.className = 'music-button';
      diagBtn.title = 'Diagnostics';
      diagBtn.innerHTML = '<span id="diagIcon">🔧</span>';

      // IMPORTANT: .music-button is fixed bottom-right.
      // Place diagnostics to the LEFT of the music button (same bottom edge).
      diagBtn.style.right = '88px';
      diagBtn.style.bottom = '20px';
      // Ensure it sits above other fixed UI.
      diagBtn.style.zIndex = '1001';

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
          <button type="button" id="diagClearCacheBtn" title="Clears all local cache/state for clean testing">Delete cache</button>
          <button type="button" id="diagCopyBtn">Copy</button>
        </div>
      `;
      document.body.appendChild(diagPanel);

      diagCloseBtn = diagPanel.querySelector('#diagCloseBtn');
      diagText = diagPanel.querySelector('#diagText');
      diagClearCacheBtn = diagPanel.querySelector('#diagClearCacheBtn');
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
        const merged = {
          ai: lastAIDiagnostics || null,
          anchors: lastAnchorsDiagnostics || null,
        };
        const hasAny = Boolean(merged.ai || merged.anchors);
        const dump = hasAny
          ? JSON.stringify(merged, null, 2)
          : 'No diagnostics captured yet.\n\nTip: load pages with ?debug=1 (anchors) or run an AI eval.';
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
      if (diagClearCacheBtn) {
        diagClearCacheBtn.addEventListener('click', async () => {
          const ok = window.confirm(
            'Delete cache?\n\nThis clears ALL local browser storage for this app (including saved work) and reloads the page.'
          );
          if (!ok) return;

          try { localStorage.clear(); } catch (_) {}
          try { sessionStorage.clear(); } catch (_) {}

          // Best-effort: clear Service Worker Cache Storage if present.
          try {
            if (window.caches && caches.keys) {
              const keys = await caches.keys();
              await Promise.all(keys.map((k) => caches.delete(k)));
            }
          } catch (_) {}

          // Reload for a clean boot.
          try {
            window.location.reload();
          } catch (_) {
            window.location.href = window.location.href;
          }
        });
      }
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

// ===================================
// 🗂️ Mode Selector
// ===================================
(function initModeSelector() {
  const select = document.getElementById('modeSelect');
  if (!select) return;

  try {
    const saved = localStorage.getItem('rc_app_mode');
    if (saved && ['reading','comprehension','thesis'].includes(saved)) {
      appMode = saved;
    }
  } catch (_) {}

  select.value = appMode;

  select.addEventListener('change', () => {
    const newMode = select.value;
    if (newMode === appMode) return;

    const hasPages = typeof pages !== 'undefined' && Array.isArray(pages) && pages.length > 0;
    if (hasPages) {
      const ok = window.confirm(`Switch mode? Your consolidations will be preserved.`);
      if (!ok) { select.value = appMode; return; }
    }

    appMode = newMode;
    try { localStorage.setItem('rc_app_mode', appMode); } catch (_) {}
    render();
  });
})();

// ===================================
// 📝 Thesis Input
// ===================================
(function initThesisInput() {
  const input = document.getElementById('thesisInput');
  if (!input) return;
  try { input.value = localStorage.getItem('rc_thesis_text') || ''; } catch (_) {}
  thesisText = input.value;

  input.addEventListener('input', () => {
    thesisText = input.value;
    try { localStorage.setItem('rc_thesis_text', thesisText); } catch (_) {}
  });
})();

// ===================================
// ▶ Autoplay Toggle
// ===================================
(function initAutoplayToggle() {
  const checkbox = document.getElementById('autoplayToggle');
  if (!checkbox) return;

  try { AUTOPLAY_STATE.enabled = localStorage.getItem('rc_autoplay') === '1'; } catch (_) {}
  checkbox.checked = AUTOPLAY_STATE.enabled;

  checkbox.addEventListener('change', () => {
    AUTOPLAY_STATE.enabled = checkbox.checked;
    try { localStorage.setItem('rc_autoplay', AUTOPLAY_STATE.enabled ? '1':'0'); } catch (_) {}
    if (!AUTOPLAY_STATE.enabled) ttsAutoplayCancelCountdown();
  });
})();

// --- Boot: restore local session if present ---
try {
  if (loadPersistedSessionIfAny()) {
    render();
    updateDiagnostics();
    // Ensure we can rehydrate per-page saved work even if the session snapshot lacked hashes.
    ensurePageHashesAndRehydrate();
  }
} catch (_) {}
// ===================================
// Footer-aware music button position
// (updates on scroll AND on content size changes)
// ===================================
(function () {
  const musicBtn = document.getElementById("musicToggle");
  const diagBtn = document.getElementById("diagnosticsToggle");
  if (!musicBtn) return;

  const SNAP_THRESHOLD = 140; // px

  function updateMusicOffset() {
    const doc = document.documentElement;

    const scrollBottom = window.scrollY + window.innerHeight;
    const docBottom = doc.scrollHeight;

    const nearBottom = (docBottom - scrollBottom) <= SNAP_THRESHOLD;

    musicBtn.style.bottom = nearBottom
      ? `calc(var(--support-footer-height) + 20px)`
      : `20px`;

    // Keep diagnostics button vertically aligned with the music button.
    // (It sits to the left, but should share the same bottom offset logic.)
    if (diagBtn) diagBtn.style.bottom = musicBtn.style.bottom;
  }

  // Throttle to one update per frame (prevents observer spam)
  let raf = 0;
  function scheduleUpdate() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      updateMusicOffset();
    });
  }

  // Initial
  scheduleUpdate();

  // Scroll/resize
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("load", scheduleUpdate);

  // Content-size changes (load pages / clear pages / render())
  const pagesEl = document.getElementById("pages");
  const footerEl = document.getElementById("supportFooter");

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(scheduleUpdate);
    if (pagesEl) ro.observe(pagesEl);
    ro.observe(document.body);
    if (footerEl) ro.observe(footerEl);
  }

  // Optional: DOM mutations (covers cases where size changes without a resize)
  if (pagesEl && window.MutationObserver) {
    const mo = new MutationObserver(scheduleUpdate);
    mo.observe(pagesEl, { childList: true, subtree: true, characterData: true });
  }
})();
