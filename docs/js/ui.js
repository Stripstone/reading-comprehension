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
      const MALE_NAMES   = ['Daniel','Rishi','Alex','Guy','Ryan','Fred','David','Mark','Tom','Bruce','James'];

      function buildVoiceSelect(selectEl, gender) {
        if (!selectEl) return;
        const isFree      = typeof appTier !== 'undefined' && appTier === 'free';
        const isActive    = String(TTS_STATE?.voiceVariant || 'female').toLowerCase() === gender;
        const savedBrowser = (() => { try { return localStorage.getItem('rc_browser_voice') || ''; } catch(_) { return ''; } })();
        const savedVariant = (() => { try { return localStorage.getItem('rc_voice_variant') || 'female'; } catch(_) { return 'female'; } })();
        const isThisVoiceActive = isActive && (savedVariant === gender);

        const allVoices = (window.speechSynthesis?.getVoices() || [])
          .filter(v => !BAD_VOICES.some(b => v.name.includes(b)))
          .filter(v => (v.lang || '').toLowerCase().startsWith('en'));

        const nameList  = gender === 'female' ? FEMALE_NAMES : MALE_NAMES;
        const quality   = allVoices.filter(v => nameList.some(n => v.name.toLowerCase().includes(n.toLowerCase())));

        const hasAnyVoices = quality.length > 0 || (!isFree);
        const bothListsEmpty = !allVoices.length;

        selectEl.innerHTML = '';

        // Placeholder option — uses 'hidden' not 'disabled' so Firefox/LibreWolf
        // renders the text correctly as the visible selection label.
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.hidden = true;
        if (bothListsEmpty) {
          placeholder.textContent = gender === 'female' ? 'Female' : 'Male';
        } else if (!hasAnyVoices) {
          placeholder.textContent = gender === 'female' ? 'Female — none found' : 'Male — none found';
        } else {
          placeholder.textContent = gender === 'female' ? 'Female' : 'Male';
        }
        placeholder.selected = !isThisVoiceActive || (!savedBrowser && savedVariant !== gender && isFree);
        selectEl.appendChild(placeholder);

        // Cloud voices for Paid/Premium — Azure Neural voice catalogue
        // Voices match what Edge browser exposes natively, so Edge users
        // may get these for free via browserSpeakQueue (see tts.js Edge optimisation).
        if (!isFree) {
          const cloudGrp = document.createElement('optgroup');
          cloudGrp.label = '☁️ Cloud (Neural)';

          const AZURE_VOICES = gender === 'female'
            ? [
                { id: 'en-US-AriaNeural',     label: 'Aria (US)' },
                { id: 'en-US-JennyNeural',    label: 'Jenny (US)' },
                { id: 'en-US-SaraNeural',     label: 'Sara (US)' },
                { id: 'en-GB-SoniaNeural',    label: 'Sonia (UK)' },
                { id: 'en-AU-NatashaNeural',  label: 'Natasha (AU)' },
              ]
            : [
                { id: 'en-US-RyanNeural',     label: 'Ryan (US)' },
                { id: 'en-US-GuyNeural',      label: 'Guy (US)' },
                { id: 'en-US-DavisNeural',    label: 'Davis (US)' },
                { id: 'en-GB-RyanNeural',     label: 'Ryan (UK)' },
                { id: 'en-AU-WilliamNeural',  label: 'William (AU)' },
              ];

          AZURE_VOICES.forEach(v => {
            const opt = document.createElement('option');
            opt.value = `cloud:${v.id}`;
            opt.textContent = v.label;
            if (savedVariant === gender && savedBrowser === `cloud:${v.id}`) opt.selected = true;
            if (!savedBrowser && savedVariant === gender && v === AZURE_VOICES[0]) opt.selected = true;
            cloudGrp.appendChild(opt);
          });
          selectEl.appendChild(cloudGrp);
        }

        // Browser voices — no group label on free tier
        if (quality.length) {
          if (isFree) {
            // Free: no optgroup label, voices appear directly
            quality.forEach(v => {
              const opt = document.createElement('option');
              opt.value = v.name;
              opt.textContent = v.name.replace(/^com\.apple\.[^.]+\./, '').replace(/-compact$/, '');
              if (v.name === savedBrowser && savedVariant === gender) opt.selected = true;
              selectEl.appendChild(opt);
            });
          } else {
            const grp = document.createElement('optgroup');
            grp.label = '🖥️ Browser';
            quality.forEach(v => {
              const opt = document.createElement('option');
              opt.value = v.name;
              opt.textContent = v.name.replace(/^com\.apple\.[^.]+\./, '').replace(/-compact$/, '');
              if (v.name === savedBrowser && savedVariant === gender) opt.selected = true;
              grp.appendChild(opt);
            });
            selectEl.appendChild(grp);
          }
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
          if (!val) return;
          setVoiceVariant(gender);
          if (val.startsWith('polly:') || val.startsWith('cloud:')) {
            // Cloud voice — store the full value so pollyFetchUrl can forward the model id
            try { localStorage.setItem('rc_browser_voice', val); } catch(_) {}
          } else {
            // Browser voice
            try { localStorage.setItem('rc_browser_voice', val); } catch(_) {}
          }
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
        const totalSpent = Object.values(sessionTokens?.spent || {}).reduce((a, b) => a + b, 0);
        const merged = {
          tokens: {
            tier: typeof appTier !== 'undefined' ? appTier : 'unknown',
            remaining: sessionTokens?.remaining ?? '—',
            allowance: (typeof TOKEN_ALLOWANCES !== 'undefined' && appTier) ? TOKEN_ALLOWANCES[appTier] : '—',
            totalSpent,
            breakdown: sessionTokens?.spent || {},
          },
          tts: {
            variant: TTS_STATE?.voiceVariant || 'female',
            activeBrowserVoice: TTS_STATE?.activeBrowserVoiceName || null,
            allEnglishVoices: (() => {
              try {
                return (window.speechSynthesis?.getVoices() || [])
                  .filter(v => (v.lang || '').toLowerCase().startsWith('en'))
                  .map(v => v.name);
              } catch(_) { return []; }
            })(),
          },
          ai: lastAIDiagnostics || null,
          anchors: lastAnchorsDiagnostics || null,
        };
        const hasAny = Boolean(merged.ai || merged.anchors);
        const dump = JSON.stringify(merged, null, 2);
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
    try { if (typeof tokenReset === 'function') tokenReset(); } catch(_) {}
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

    // Anchors row (counter + Hint button) — hidden on Free tier AND in reading mode.
    // applyModeVisibility already hides these in reading mode; we must not override that.
    const isReadingMode = appMode === 'reading';
    document.querySelectorAll('.anchors-row').forEach(el => {
      if (isFree || isReadingMode) {
        el.style.display = 'none';
      } else {
        el.style.display = '';
      }
    });

    // AI Evaluate buttons and Submit — hidden on Free and in reading mode
    document.querySelectorAll('.ai-btn, #submitBtn').forEach(el => {
      el.style.display = (isFree || isReadingMode) ? 'none' : '';
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


// ===== Extracted shell routing/bridge logic from docs/index.html =====
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

        // Reading mode: hide nav for focus, restore on exit
        const mainNav = document.querySelector('nav');
        if (mainNav) mainNav.style.display = id === 'reading-mode' ? 'none' : '';
        if (wasReading && id !== 'reading-mode') cleanupReadingTransientState();
        if (id === 'reading-mode') {
            if (!_readingStartTime) _readingStartTime = Date.now();
            initFocusMode();
            updateTierPill();
            updateExplorerSwatchState();
            updateProgressBar();
        }
        if (id === 'dashboard') refreshLibrary();

        window.scrollTo(0, 0);
    }

    // ── Focus mode fade ──────────────────────────────────────────
    let focusModeTimer   = null;
    let focusModeHandler = null;

    function initFocusMode() {
        // Restore persisted TTS speed into the dropdown and the audio element.
        try {
            const savedSpeed = localStorage.getItem('rc_tts_speed');
            if (savedSpeed) {
                const sel = document.getElementById('shell-speed');
                if (sel) sel.value = savedSpeed;
                if (typeof window.setPlaybackRate === 'function') window.setPlaybackRate(savedSpeed); else shellSetSpeed(savedSpeed);
            }
        } catch(_) {}

        const bar = document.getElementById('reading-top-bar');
        const rm  = document.getElementById('reading-mode');
        if (!bar || !rm) return;
        if (focusModeHandler) {
            ['mousemove', 'scroll', 'touchstart', 'click'].forEach(ev =>
                rm.removeEventListener(ev, focusModeHandler));
        }
        bar.classList.remove('faded');
        function resetFade() {
            bar.classList.remove('faded');
            clearTimeout(focusModeTimer);
            focusModeTimer = setTimeout(() => bar.classList.add('faded'), 3000);
        }
        focusModeHandler = resetFade;
        resetFade();
        ['mousemove', 'scroll', 'touchstart', 'click'].forEach(ev =>
            rm.addEventListener(ev, resetFade, { passive: true }));
        bar.addEventListener('mouseenter', () => { bar.classList.remove('faded'); clearTimeout(focusModeTimer); });
        bar.addEventListener('mouseleave', resetFade);
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

    // ── F1: TTS Speed Control (shell-only) ────────────────────────
    // Patches window.speechSynthesis.speak once so every browser TTS utterance
    // inherits the saved rate without touching tts.js.
    (function patchSpeechSynthesisRate() {
        if (!window.speechSynthesis) return;
        const _origSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
        window.speechSynthesis.speak = function(utter) {
            try { utter.rate = parseFloat(localStorage.getItem('rc_tts_speed') || '1') || 1; } catch(_) {}
            return _origSpeak(utter);
        };
    })();

    function shellSetSpeed(value) {
        if (typeof window.setPlaybackRate === 'function') {
            window.setPlaybackRate(value);
            return;
        }
        const rate = parseFloat(value) || 1;
        try { localStorage.setItem('rc_tts_speed', String(rate)); } catch(_) {}
        try { if (typeof TTS_STATE !== 'undefined') TTS_STATE.rate = rate; } catch(_) {}
        try { if (typeof TTS_AUDIO_ELEMENT !== 'undefined') TTS_AUDIO_ELEMENT.playbackRate = rate; } catch(_) {}
    }

    function hasActiveReadingCards() {
        const reading = document.getElementById('reading-mode');
        const pagesEl = document.getElementById('pages');
        return !!(reading && !reading.classList.contains('hidden-section') && pagesEl && pagesEl.querySelector('.page'));
    }

    function clearImporterTransientUI() {
        try {
            if (typeof window.resetImporterState === 'function') {
                window.resetImporterState();
                return;
            }
        } catch (_) {}
    }

    function cleanupReadingTransientState() {
        try { if (typeof ttsStop === 'function') ttsStop(); } catch(_) {}
        try { if (typeof ttsAutoplayCancelCountdown === 'function') ttsAutoplayCancelCountdown(); } catch(_) {}
        try {
            if (typeof window.toggleMusic === 'function' && typeof window.allSoundsMuted !== 'undefined' && !window.allSoundsMuted) {
                window.toggleMusic();
            }
        } catch(_) {}
        const vol = document.getElementById('volumePanel');
        if (vol) vol.style.display = 'none';
        const badge = document.getElementById('shell-countdown-badge');
        if (badge) badge.remove();
        const signal = document.getElementById('session-complete');
        if (signal) signal.classList.add('hidden-section');
        const prog = document.getElementById('shell-page-progress');
        if (prog) prog.textContent = '—';
        const pauseBtn = document.getElementById('shell-pause-btn');
        if (pauseBtn) {
            pauseBtn.classList.remove('active');
            pauseBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';
        }
        _readingStartTime = null;
    }

    // ── Bottom bar controls ──────────────────────────────────────

    // Pause/Play — calls app's tts.js functions if available.
    // Guards against first-use case where TTS was never started (TTS_STATE.activeKey is null).
    function handlePausePlay() {
        const btn = document.getElementById('shell-pause-btn');
        if (!btn) return;
        try {
            const status = (typeof window.getPlaybackStatus === 'function') ? window.getPlaybackStatus() : null;
            if (status && !status.active && !btn.classList.contains('active')) return;
            const next = (typeof window.pauseOrResumeReading === 'function') ? window.pauseOrResumeReading() : null;
            const paused = next ? !!next.paused : btn.classList.contains('active');
            if (paused) {
                btn.classList.add('active');
                btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play';
            } else {
                btn.classList.remove('active');
                btn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';
            }
        } catch(_) {}
    }

    // Autoplay button — syncs with #autoplayToggle checkbox inside volumePanel
    function handleAutoplayToggle() {
        const checkbox = document.getElementById('autoplayToggle');
        const btn      = document.getElementById('shell-autoplay-btn');
        if (!checkbox || !btn) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
        btn.classList.toggle('active', checkbox.checked);
    }

    // Keep autoplay button in sync if checkbox changes (e.g. via volume panel)
    document.addEventListener('DOMContentLoaded', () => {
        const checkbox = document.getElementById('autoplayToggle');
        const btn      = document.getElementById('shell-autoplay-btn');
        if (checkbox && btn) {
            checkbox.addEventListener('change', () => {
                btn.classList.toggle('active', checkbox.checked);
            });
        }
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
        _readingStartTime = Date.now();
        if (typeof window.startReadingFromSource === 'function') {
            window.startReadingFromSource(_previewBookId, { source: 'book' });
        }
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
                setTimeout(clearImporterTransientUI, 0);
            });
        }
        const importCloseBtn = document.getElementById('importBookClose');
        if (importCloseBtn) {
            importCloseBtn.addEventListener('click', () => setTimeout(clearImporterTransientUI, 0));
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
                const btn = document.getElementById('shell-autoplay-btn');
                if (!btn) return;
                let badge = document.getElementById('shell-countdown-badge');
                try {
                    if (!hasActiveReadingCards()) { if (badge) badge.remove(); return; }
                    const idx = (typeof AUTOPLAY_STATE !== 'undefined') ? AUTOPLAY_STATE.countdownPageIndex : -1;
                    const sec = (typeof AUTOPLAY_STATE !== 'undefined') ? AUTOPLAY_STATE.countdownSec      : 0;
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
                            const noCountdown = (typeof AUTOPLAY_STATE === 'undefined') || AUTOPLAY_STATE.countdownPageIndex === -1;
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
