(function () {
  const SETTINGS_SYNC_DEBOUNCE_MS = 600;
  const LOCAL_THEME_PREFS_KEY = 'rc_theme_prefs';
  const LOCAL_APPEARANCE_PREFS_KEY = 'rc_appearance_prefs';
  const LOCAL_DIAGNOSTICS_PREFS_KEY = 'rc_diagnostics_prefs';
  const PROGRESS_SYNC_DEBOUNCE_MS = 900;

  const state = {
    authReady: false,
    session: null,
    user: null,
    settingsTimer: null,
    progressTimer: null,
    runtimePatched: false,
    runtimeReadyPromise: null,
    activeSessionRowId: null,
    activeSessionStartedAt: null,
    restoreAttempted: false,
  };

  function safeJsonParse(raw, fallback) {
    try {
      return JSON.parse(raw || '');
    } catch (_) {
      return fallback;
    }
  }

  function readLocalThemePrefs() {
    return safeJsonParse(localStorage.getItem(LOCAL_THEME_PREFS_KEY), {}) || {};
  }

  function writeLocalThemePrefs(payload) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    try { localStorage.setItem(LOCAL_THEME_PREFS_KEY, JSON.stringify(safePayload)); } catch (_) {}
    scheduleSettingsSync();
    return safePayload;
  }

  function readLocalAppearancePrefs() {
    return safeJsonParse(localStorage.getItem(LOCAL_APPEARANCE_PREFS_KEY), {}) || {};
  }

  function writeLocalAppearancePrefs(payload) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    try { localStorage.setItem(LOCAL_APPEARANCE_PREFS_KEY, JSON.stringify(safePayload)); } catch (_) {}
    scheduleSettingsSync();
    return safePayload;
  }

  function readLocalDiagnosticsPrefs() {
    return safeJsonParse(localStorage.getItem(LOCAL_DIAGNOSTICS_PREFS_KEY), {}) || {};
  }

  function writeLocalDiagnosticsPrefs(payload) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    try { localStorage.setItem(LOCAL_DIAGNOSTICS_PREFS_KEY, JSON.stringify(safePayload)); } catch (_) {}
    scheduleSettingsSync();
    return safePayload;
  }

  window.rcPrefsAdapter = {
    loadThemePrefs: readLocalThemePrefs,
    saveThemePrefs: writeLocalThemePrefs,
    loadAppearancePrefs: readLocalAppearancePrefs,
    saveAppearancePrefs: writeLocalAppearancePrefs,
    loadDiagnosticsPrefs: readLocalDiagnosticsPrefs,
    saveDiagnosticsPrefs: writeLocalDiagnosticsPrefs,
  };

  function currentTierValue() {
    const select = document.getElementById('tierSelect');
    return select && select.value ? String(select.value) : 'free';
  }

  function currentAutoplayEnabled() {
    try {
      return localStorage.getItem('rc_autoplay') === '1';
    } catch (_) {
      return false;
    }
  }

  function currentTtsSpeed() {
    const speedSelect = document.getElementById('shell-speed');
    const value = speedSelect && speedSelect.value ? Number(speedSelect.value) : 1;
    return Number.isFinite(value) ? value : 1;
  }

  function currentVoiceId() {
    const female = document.getElementById('voiceFemaleSelect');
    const male = document.getElementById('voiceMaleSelect');
    const voiceVariant = (localStorage.getItem('rc_voice_variant') || 'female').toLowerCase() === 'male' ? 'male' : 'female';
    const source = voiceVariant === 'male' ? male : female;
    return source && source.value ? String(source.value) : null;
  }

  function collectSettingsPayload(userId) {
    const themePrefs = readLocalThemePrefs();
    const themeSettings = themePrefs.theme_settings && typeof themePrefs.theme_settings === 'object' ? themePrefs.theme_settings : {};

    return {
      user_id: userId,
      theme_id: themePrefs.theme_id || 'default',
      font_id: themeSettings.font || null,
      tts_speed: currentTtsSpeed(),
      tts_voice_id: currentVoiceId(),
      autoplay_enabled: currentAutoplayEnabled(),
      music_enabled: themeSettings.music === 'custom' || themeSettings.music === 'default',
      music_profile_id: themeSettings.music || null,
      particles_enabled: typeof themeSettings.embersOn === 'boolean' ? themeSettings.embersOn : null,
      particle_preset_id: themeSettings.emberPreset || null,
      use_source_page_numbers: null,
      updated_at: new Date().toISOString(),
    };
  }

  async function loadSettingsFromCloud(client, userId) {
    const { data, error } = await client
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error && error.code !== 'PGRST116') {
      console.warn('[sync] settings load failed', error);
      return null;
    }
    return data || null;
  }

  function applyCloudSettingsToLocal(row) {
    if (!row) return;
    const currentThemePrefs = readLocalThemePrefs();
    const mergedThemePrefs = {
      ...currentThemePrefs,
      theme_id: row.theme_id || currentThemePrefs.theme_id || 'default',
      theme_settings: {
        ...(currentThemePrefs.theme_settings || {}),
        ...(row.font_id ? { font: row.font_id } : {}),
        ...(typeof row.particles_enabled === 'boolean' ? { embersOn: row.particles_enabled } : {}),
        ...(row.particle_preset_id ? { emberPreset: row.particle_preset_id } : {}),
        ...(row.music_profile_id ? { music: row.music_profile_id } : {}),
      },
    };
    writeLocalThemePrefs(mergedThemePrefs);

    try {
      if (typeof row.autoplay_enabled === 'boolean') localStorage.setItem('rc_autoplay', row.autoplay_enabled ? '1' : '0');
      if (row.tts_speed != null) {
        const speedEl = document.getElementById('shell-speed');
        if (speedEl) speedEl.value = String(row.tts_speed);
        if (typeof setPlaybackRate === 'function') setPlaybackRate(Number(row.tts_speed));
      }
    } catch (_) {}

    if (window.rcAppearance && typeof window.rcAppearance.load === 'function') {
      try { window.rcAppearance.load(); } catch (_) {}
    }
    if (window.rcTheme && typeof window.rcTheme.load === 'function') {
      try { window.rcTheme.load(); } catch (_) {}
    }
    if (window.rcDiagnosticsPrefs && typeof window.rcDiagnosticsPrefs.load === 'function') {
      try { window.rcDiagnosticsPrefs.load(); } catch (_) {}
    }
  }

  async function saveSettingsToCloud() {
    if (!state.user) return;
    clearTimeout(state.settingsTimer);
    state.settingsTimer = null;
    try {
      const client = await window.rcSupabase.init();
      const payload = collectSettingsPayload(state.user.id);
      const lookup = await client.from('user_settings').select('user_id').eq('user_id', state.user.id).maybeSingle();
      if (lookup.error && lookup.error.code !== 'PGRST116') throw lookup.error;
      const result = lookup.data
        ? await client.from('user_settings').update(payload).eq('user_id', state.user.id)
        : await client.from('user_settings').insert(payload);
      if (result.error) console.warn('[sync] settings write failed', result.error);
    } catch (err) {
      console.warn('[sync] settings sync error', err);
    }
  }

  function scheduleSettingsSync() {
    if (!state.user) return;
    clearTimeout(state.settingsTimer);
    state.settingsTimer = setTimeout(saveSettingsToCloud, SETTINGS_SYNC_DEBOUNCE_MS);
  }

  function getReadingProgressPayload(userId) {
    const target = window.__rcReadingTarget || {};
    const pageCount = Array.isArray(window.pages) ? window.pages.length : (typeof pages !== 'undefined' && Array.isArray(pages) ? pages.length : 0);
    const pageIndex = Number.isFinite(Number(target.pageIndex)) ? Number(target.pageIndex) : 0;
    const chapterIndex = Number.isFinite(Number(target.chapterIndex)) ? Number(target.chapterIndex) : -1;
    const sourceType = String(target.sourceType || '').trim() || 'book';
    const sourceId = String(target.bookId || '').trim();
    if (!userId || !sourceId) return null;
    return {
      user_id: userId,
      book_id: sourceId,
      source_id: sourceId,
      source_type: sourceType,
      chapter_id: chapterIndex >= 0 ? String(chapterIndex) : null,
      last_page_index: pageIndex,
      page_count: pageCount || null,
      session_version: 2,
      last_read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_active: true,
    };
  }

  async function saveProgressToCloud() {
    if (!state.user) return;
    clearTimeout(state.progressTimer);
    state.progressTimer = null;
    const payload = getReadingProgressPayload(state.user.id);
    if (!payload) return;
    try {
      const client = await window.rcSupabase.init();
      const lookup = await client
        .from('user_progress')
        .select('id')
        .eq('user_id', state.user.id)
        .eq('source_type', payload.source_type)
        .eq('source_id', payload.source_id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lookup.error && lookup.error.code !== 'PGRST116') throw lookup.error;
      const result = lookup.data
        ? await client.from('user_progress').update(payload).eq('id', lookup.data.id)
        : await client.from('user_progress').insert(payload);
      if (result.error) console.warn('[sync] progress write failed', result.error);
    } catch (err) {
      console.warn('[sync] progress sync error', err);
    }
  }

  function scheduleProgressSync() {
    if (!state.user) return;
    clearTimeout(state.progressTimer);
    state.progressTimer = setTimeout(saveProgressToCloud, PROGRESS_SYNC_DEBOUNCE_MS);
  }

  function setTierUi(tier) {
    const value = ['premium', 'paid', 'free'].includes(String(tier || '')) ? String(tier) : 'free';
    window.__rcTierLocked = !!state.user;
    window.__rcTierSyncing = true;
    const select = document.getElementById('tierSelect');
    if (select && select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    window.__rcTierSyncing = false;
    const tierButtons = Array.from(document.querySelectorAll('.tier-btn'));
    const labels = { free: 'Basic', paid: 'Pro', premium: 'Premium' };
    tierButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.textContent.trim() === labels[value]);
      btn.disabled = !!state.user;
      btn.classList.toggle('opacity-60', !!state.user);
      btn.classList.toggle('cursor-not-allowed', !!state.user);
    });
    const currentPlanBtn = document.getElementById('pricing-current-btn');
    const isAuthed = !!state.user;
    if (currentPlanBtn) {
      currentPlanBtn.textContent = isAuthed ? (labels[value] ? `${labels[value]} plan` : 'Current Plan') : 'Continue with Free';
      currentPlanBtn.disabled = false;
    }
    const subscriptionPlanText = document.getElementById('subscription-current-plan');
    if (subscriptionPlanText) subscriptionPlanText.textContent = labels[value] || 'Basic';
    try { if (window.rcTheme && typeof window.rcTheme.enforceAccess === 'function') window.rcTheme.enforceAccess(); } catch (_) {}
    try { if (typeof syncExplorerMusicSource === 'function') syncExplorerMusicSource(); } catch (_) {}
  }

  async function loadEntitlement(client, userId) {
    try {
      const { data, error } = await client
        .from('user_entitlements')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      const row = data || null;
      const isActive = row && ['active', 'trialing', 'past_due', 'unpaid'].includes(String(row.status || '').toLowerCase());
      const tier = isActive && row?.tier ? String(row.tier) : 'free';
      setTierUi(tier);
      return row;
    } catch (err) {
      console.warn('[sync] entitlement load failed', err);
      setTierUi('free');
      return null;
    }
  }

  async function restoreProgressIfPossible(client, userId) {
    if (state.restoreAttempted) return;
    state.restoreAttempted = true;
    try {
      const { data, error } = await client
        .from('user_progress')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      const row = data || null;
      if (!row || !row.source_id) return;
      await waitForRuntimeReady();
      if ((typeof pages !== 'undefined' && Array.isArray(pages) && pages.length > 0) || document.body.classList.contains('reading-active')) return;
      if (typeof showSection === 'function') showSection('reading-mode');
      window.__rcPendingRestorePageIndex = Number.isFinite(Number(row.last_page_index)) ? Number(row.last_page_index) : 0;
      const started = await window.startReadingFromPreview?.(row.source_id);
      if (!started) return;
      const chapterTarget = row.chapter_id;
      if (chapterTarget !== null && chapterTarget !== undefined && chapterTarget !== '') {
        const chapterSelect = document.getElementById('chapterSelect');
        await waitForCondition(function () {
          return chapterSelect && Array.from(chapterSelect.options || []).some((opt) => String(opt.value) === String(chapterTarget));
        }, 2500);
        if (chapterSelect && Array.from(chapterSelect.options || []).some((opt) => String(opt.value) === String(chapterTarget))) {
          chapterSelect.value = String(chapterTarget);
          chapterSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    } catch (err) {
      console.warn('[sync] progress restore failed', err);
    }
  }

  async function beginSessionRow() {
    if (!state.user || state.activeSessionRowId) return;
    const target = window.__rcReadingTarget || {};
    const sourceId = String(target.bookId || '').trim();
    if (!sourceId) return;
    try {
      const client = await window.rcSupabase.init();
      const payload = {
        user_id: state.user.id,
        book_id: sourceId,
        source_id: sourceId,
        source_type: String(target.sourceType || 'book'),
        mode: typeof appMode !== 'undefined' ? String(appMode || 'reading') : 'reading',
        pages_completed: 0,
        tts_seconds: 0,
        minutes_listened: 0,
        completed: false,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await client.from('user_sessions').insert(payload).select('id').single();
      if (error) throw error;
      state.activeSessionRowId = data?.id || null;
      state.activeSessionStartedAt = Date.now();
    } catch (err) {
      console.warn('[sync] session start failed', err);
    }
  }

  async function endSessionRow(result) {
    if (!state.user || !state.activeSessionRowId) return;
    try {
      const client = await window.rcSupabase.init();
      const now = Date.now();
      const durationSeconds = state.activeSessionStartedAt ? Math.max(0, Math.round((now - state.activeSessionStartedAt) / 1000)) : 0;
      const minutes = durationSeconds > 0 ? Math.max(1, Math.round(durationSeconds / 60)) : 0;
      const payload = {
        ended_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
        pages_completed: Number.isFinite(Number(result?.activePageIndex)) ? Number(result.activePageIndex) + 1 : null,
        minutes_listened: minutes,
        completed: Boolean(result?.pageCount) && Number(result.activePageIndex) >= Number(result.pageCount) - 1,
      };
      const { error } = await client.from('user_sessions').update(payload).eq('id', state.activeSessionRowId);
      if (error) throw error;
    } catch (err) {
      console.warn('[sync] session end failed', err);
    } finally {
      state.activeSessionRowId = null;
      state.activeSessionStartedAt = null;
    }
  }

  function waitForCondition(check, timeoutMs) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      (function poll() {
        let ok = false;
        try { ok = !!check(); } catch (_) { ok = false; }
        if (ok || (Date.now() - startedAt) >= timeoutMs) return resolve(ok);
        setTimeout(poll, 60);
      })();
    });
  }

  function waitForRuntimeReady() {
    if (state.runtimeReadyPromise) return state.runtimeReadyPromise;
    state.runtimeReadyPromise = waitForCondition(function () {
      return typeof window.startReadingFromPreview === 'function' && typeof window.exitReadingSession === 'function' && typeof window.setReadingTarget === 'function';
    }, 6000).then(() => {
      patchRuntimeHooks();
      return true;
    });
    return state.runtimeReadyPromise;
  }

  function patchRuntimeHooks() {
    if (state.runtimePatched) return;
    const originalStartReading = window.startReadingFromPreview;
    const originalExitReading = window.exitReadingSession;
    const originalPersist = window.persistSessionNow;
    if (typeof originalStartReading === 'function' && !originalStartReading.__rcWrapped) {
      const wrappedStart = async function () {
        const out = await originalStartReading.apply(this, arguments);
        beginSessionRow();
        scheduleProgressSync();
        return out;
      };
      wrappedStart.__rcWrapped = true;
      window.startReadingFromPreview = wrappedStart;
    }
    if (typeof originalExitReading === 'function' && !originalExitReading.__rcWrapped) {
      const wrappedExit = function () {
        const result = originalExitReading.apply(this, arguments);
        scheduleProgressSync();
        endSessionRow(result);
        return result;
      };
      wrappedExit.__rcWrapped = true;
      window.exitReadingSession = wrappedExit;
    }
    if (typeof originalPersist === 'function' && !originalPersist.__rcWrapped) {
      const wrappedPersist = function () {
        const out = originalPersist.apply(this, arguments);
        scheduleProgressSync();
        return out;
      };
      wrappedPersist.__rcWrapped = true;
      window.persistSessionNow = wrappedPersist;
    }
    state.runtimePatched = true;
  }

  async function handleAuthStateChange(payload) {
    state.session = payload?.session || null;
    state.user = payload?.user || null;
    state.restoreAttempted = false;
    if (!state.user) {
      clearTimeout(state.settingsTimer);
      clearTimeout(state.progressTimer);
      state.activeSessionRowId = null;
      state.activeSessionStartedAt = null;
      window.__rcTierLocked = false;
      setTierUi('free');
      return;
    }
    const client = await window.rcSupabase.init();
    await loadEntitlement(client, state.user.id);
    const row = await loadSettingsFromCloud(client, state.user.id);
    if (row) applyCloudSettingsToLocal(row);
    else scheduleSettingsSync();
    await restoreProgressIfPossible(client, state.user.id);
  }

  window.rcSync = {
    handleAuthStateChange,
    scheduleSettingsSync,
    scheduleProgressSync,
    waitForRuntimeReady,
    beginSessionRow,
    endSessionRow,
  };

  window.addEventListener('load', function () {
    waitForRuntimeReady().catch((err) => console.warn('[sync] runtime not ready', err));
  });
})();
