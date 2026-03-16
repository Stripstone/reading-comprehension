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
      }

      function setVoiceVariant(v) {
        const vv = String(v || '').toLowerCase() === 'male' ? 'male' : 'female';
        TTS_STATE.voiceVariant = vv;
        try { localStorage.setItem('rc_voice_variant', vv); } catch (_) {}
      }

      // Voice selects — two dropdowns, one per gender.
      // Selecting from either dropdown sets both the active variant and specific voice.
      // Free tier: browser voices only.
      // Paid/Premium: Polly cloud voices at the top, browser voices below.
      const voiceFemaleSelect = document.getElementById('voiceFemaleSelect');
      const voiceMaleSelect   = document.getElementById('voiceMaleSelect');

      const BAD_VOICES = [
        'Albert','Bad News','Bells','Boing','Bubbles','Cellos',
        'Deranged','Good News','Hysterical','Jester','Organ',
        'Superstar','Whisper','Zarvox','Trinoids'
      ];

      const FEMALE_NAMES = ['Aria','Jenny','Samantha','Karen','Moira','Serena','Tessa','Zira','Eva','Susan','Victoria','Fiona','Allison','Ava','Nora'];
      const MALE_NAMES   = ['Daniel','Alex','Guy','Ryan','Rishi','David','Mark','Tom','Fred','Bruce','James'];

      function buildVoiceSelect(selectEl, gender) {
        if (!selectEl) return;
        const isFree      = typeof appTier !== 'undefined' && appTier === 'free';
        const isActive    = String(TTS_STATE?.voiceVariant || 'female').toLowerCase() === gender;
        const savedBrowser = (() => { try { return localStorage.getItem('rc_browser_voice') || ''; } catch(_) { return ''; } })();
        const savedVariant = (() => { try { return localStorage.getItem('rc_voice_variant') || 'female'; } catch(_) { return 'female'; } })();
        const isThisVoiceActive = isActive && (savedVariant === gender);

        // Collect all usable English voices — broad match so no voices are silently dropped
        const allVoices = (window.speechSynthesis?.getVoices() || [])
          .filter(v => !BAD_VOICES.some(b => v.name.includes(b)))
          .filter(v => (v.lang || '').toLowerCase().startsWith('en'));

        const nameList = gender === 'female' ? FEMALE_NAMES : MALE_NAMES;
        const otherList = gender === 'female' ? MALE_NAMES : FEMALE_NAMES;

        // Quality: matches this gender's name list
        const quality = allVoices.filter(v => nameList.some(n => v.name.toLowerCase().includes(n.toLowerCase())));
        // Other: doesn't match either gender list — shown in both dropdowns
        const neutral = allVoices.filter(v => !nameList.some(n => v.name.toLowerCase().includes(n.toLowerCase()))
                                           && !otherList.some(n => v.name.toLowerCase().includes(n.toLowerCase())));

        selectEl.innerHTML = '';

        // Default placeholder — shown when this gender is not active
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = gender === 'female' ? 'Female' : 'Male';
        placeholder.disabled = true;
        // Show placeholder selected only if this gender is not active
        placeholder.selected = !isThisVoiceActive || (!savedBrowser && savedVariant !== gender);
        selectEl.appendChild(placeholder);

        // Cloud voices for Paid/Premium
        if (!isFree) {
          const cloudGrp = document.createElement('optgroup');
          cloudGrp.label = '☁️ Cloud (Neural)';
          const pollyOpt = document.createElement('option');
          pollyOpt.value = `polly:${gender}`;
          pollyOpt.textContent = gender === 'female' ? 'Neural Female' : 'Neural Male';
          if (savedVariant === gender && !savedBrowser) pollyOpt.selected = true;
          cloudGrp.appendChild(pollyOpt);
          selectEl.appendChild(cloudGrp);
        }

        // Recommended browser voices
        if (quality.length) {
          const grp = document.createElement('optgroup');
          grp.label = isFree ? '⭐ Recommended' : '⭐ Browser';
          quality.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.name;
            opt.textContent = v.name.replace(/^com\.apple\.[^.]+\./, '').replace(/-compact$/, '');
            if (v.name === savedBrowser && savedVariant === gender) opt.selected = true;
            grp.appendChild(opt);
          });
          selectEl.appendChild(grp);
        }

        // Neutral voices shown in both dropdowns
        if (neutral.length) {
          const grp = document.createElement('optgroup');
          grp.label = 'Other English';
          neutral.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.name;
            opt.textContent = v.name.replace(/^com\.apple\.[^.]+\./, '').replace(/-compact$/, '');
            if (v.name === savedBrowser && savedVariant === gender) opt.selected = true;
            grp.appendChild(opt);
          });
          selectEl.appendChild(grp);
        }

        // If no voices found at all, show a disabled note
        if (!quality.length && !neutral.length && isFree) {
          const none = document.createElement('option');
          none.value = '';
          none.disabled = true;
          none.textContent = 'No system voices found';
          selectEl.appendChild(none);
        }

        // Accent border on the active dropdown
        selectEl.style.borderColor = isThisVoiceActive
          ? 'var(--accent, #c17d4a)'
          : 'var(--border)';
      }

      function populateBrowserVoicePicker() {
        buildVoiceSelect(voiceFemaleSelect, 'female');
        buildVoiceSelect(voiceMaleSelect,   'male');
      }

      function handleVoiceSelectChange(selectEl, gender) {
        if (!selectEl) return;
        selectEl.addEventListener('change', () => {
          const val = selectEl.value;
          if (!val) return; // placeholder selected — ignore
          setVoiceVariant(gender);
          if (val.startsWith('polly:')) {
            try { localStorage.removeItem('rc_browser_voice'); } catch(_) {}
          } else {
            try { localStorage.setItem('rc_browser_voice', val); } catch(_) {}
          }
          // Rebuild both — other resets to placeholder, this one shows selection
          populateBrowserVoicePicker();
        });
      }

      handleVoiceSelectChange(voiceFemaleSelect, 'female');
      handleVoiceSelectChange(voiceMaleSelect,   'male');

      // Repopulate when voices load asynchronously (Chrome/Edge)
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.addEventListener('voiceschanged', populateBrowserVoicePicker);
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
          populateBrowserVoicePicker();
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
    if (saved && ['reading','comprehension','research'].includes(saved)) {
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
// 💳 Tier Selector
// ===================================
(function initTierSelector() {
  const select = document.getElementById('tierSelect');
  if (!select) return;

  const VALID_TIERS = ['free', 'paid', 'premium'];

  // Restore persisted tier
  try {
    const saved = localStorage.getItem('rc_app_tier');
    if (saved && VALID_TIERS.includes(saved)) {
      appTier = saved;
    }
  } catch (_) {}

  select.value = appTier;

  select.addEventListener('change', () => {
    const newTier = select.value;
    if (!VALID_TIERS.includes(newTier) || newTier === appTier) return;
    appTier = newTier;
    try { localStorage.setItem('rc_app_tier', appTier); } catch (_) {}
    applyTierAccess();
  });

  // Apply on boot
  applyTierAccess();

  function applyTierAccess() {
    // Tier access rules (prototype: feature gating active, usage unrestricted).
    //
    // free    — Reading mode only. Comprehension and Research disabled.
    //           No AI Evaluate, no TTS voices beyond default.
    // paid    — All modes accessible. AI Evaluate available. Standard voices.
    // premium — Full access. All voices, all modes, all features.
    //
    // NOTE: These rules gate UI visibility only. No server-side enforcement yet.

    const isFree    = appTier === 'free';
    const isPaid    = appTier === 'paid';
    const isPremium = appTier === 'premium';

    // Mode options:
    //   Free        — Reading only. Comprehension disabled.
    //   Paid+       — Reading + Comprehension.
    //   All tiers   — Research always disabled until implemented.
    const modeSelect = document.getElementById('modeSelect');
    if (modeSelect) {
      const comprehensionOpt = modeSelect.querySelector('option[value="comprehension"]');
      const researchOpt      = modeSelect.querySelector('option[value="research"]');
      if (comprehensionOpt) comprehensionOpt.disabled = isFree;
      // Research is selectable on Paid/Premium (evaluation.js shows coming-soon alert on use).
      // Disabled only on Free alongside Comprehension.
      if (researchOpt)      researchOpt.disabled = isFree;

      // If currently on a gated mode, drop back to Reading
      if (isFree && appMode !== 'reading') {
        modeSelect.value = 'reading';
        appMode = 'reading';
        try { localStorage.setItem('rc_app_mode', 'reading'); } catch (_) {}
        if (typeof applyModeVisibility === 'function') applyModeVisibility();
      }
    }

    // Anchors row (counter + Hint button) — hidden on Free
    document.querySelectorAll('.anchors-row').forEach(el => {
      el.style.display = isFree ? 'none' : '';
    });

    // AI Evaluate buttons and Submit — hidden on Free
    document.querySelectorAll('.ai-btn, #submitBtn').forEach(el => {
      el.style.display = isFree ? 'none' : '';
    });

    // Voice dropdowns are visible at all tiers — Free sees browser voices,
    // Paid/Premium see cloud voices at the top. No hiding needed.
  }
})();

// ===================================
// 📝 Research Input
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
  try {
    checkbox.checked = localStorage.getItem('rc_autoplay') === '1';
    AUTOPLAY_STATE.enabled = checkbox.checked;
  } catch (_) {}
  checkbox.addEventListener('change', () => {
    AUTOPLAY_STATE.enabled = checkbox.checked;
    localStorage.setItem('rc_autoplay', checkbox.checked ? '1':'0');
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
