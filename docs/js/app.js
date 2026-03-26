// jubly app loader
// Loads role-based JS files sequentially, then the shell bridge.
(function () {
  try {
    const params = new URLSearchParams(window.location.search);
    const v = (params.get('debug') || '').trim().toLowerCase();
    const on = params.has('debug') && (v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on');
    if (on) {
      window.DEBUG_TTS      = true;
      window.DEBUG_AUDIO    = true;
      window.DEBUG_AUTOPLAY = true;
    }
  } catch (_) {}

  const ORDER = [
    'config.js',
    'state.js',
    'audio.js',
    'tts.js',
    'utils.js',
    'anchors.js',
    'import.js',
    'library.js',
    'evaluation.js',
    'ui.js',
    'shell-bridge.js'
  ];

  const current = document.currentScript;
  const base = current && current.src ? current.src.replace(/[^/]+$/, '') : 'js/';

  function loadScriptSequentially(i) {
    if (i >= ORDER.length) return;
    const s = document.createElement('script');
    s.src = base + ORDER[i];
    s.async = false;
    s.onload = () => loadScriptSequentially(i + 1);
    s.onerror = () => {
      console.error('Failed to load script:', ORDER[i]);
      // Continue loading remaining scripts even if one fails
      loadScriptSequentially(i + 1);
    };
    document.head.appendChild(s);
  }

  loadScriptSequentially(0);
})();
