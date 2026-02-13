// ===================================
  // ðŸŽµ MUSIC TOGGLE
  // ===================================
  const music = document.getElementById('bgMusic');
  const musicIcon = document.getElementById('musicIcon');
  let allSoundsMuted = true; // Start muted - user can enable with button

  // ===================================
  // 🔓 iOS/iPadOS SAFARI AUDIO UNLOCK
  // ===================================
  // Safari on iOS often refuses HTMLAudioElement.play() until it has been
  // initiated by a real user gesture (tap/click). It can also re-lock after
  // switching tabs/apps.
  let audioUnlocked = false;

  function warmupEl(el) {
    if (!el) return;
    // Keep it silent and instant.
    const prevVol = el.volume;
    const prevMuted = el.muted;
    try {
      el.muted = true;
      el.volume = 0;
      el.currentTime = 0;
      const p = el.play();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          el.pause();
          el.currentTime = 0;
          el.volume = prevVol;
          el.muted = prevMuted;
        }).catch(() => {
          // ignore
          el.pause();
          el.volume = prevVol;
          el.muted = prevMuted;
        });
      } else {
        // Older browsers: best-effort
        el.pause();
        el.currentTime = 0;
        el.volume = prevVol;
        el.muted = prevMuted;
      }
    } catch (_) {
      try {
        el.pause();
      } catch (_) {}
      el.volume = prevVol;
      el.muted = prevMuted;
    }
  }

  function unlockAllAudioOnce() {
    if (audioUnlocked) return;
    audioUnlocked = true;

    // Warm up every audio element so later SFX calls work reliably.
    warmupEl(document.getElementById('sandSound'));
    warmupEl(document.getElementById('stoneSound'));
    warmupEl(document.getElementById('rewardSound'));
    warmupEl(document.getElementById('compassSound'));
    warmupEl(document.getElementById('pageTurnSound'));
    warmupEl(document.getElementById('evaluateSound'));
    warmupEl(music);
  }

  function armUnlockListeners() {
    // Use multiple event types; iPad Safari can be picky depending on input method.
    const opts = { once: true, passive: true, capture: true };
    document.addEventListener('pointerdown', unlockAllAudioOnce, opts);
    document.addEventListener('touchend', unlockAllAudioOnce, opts);
    document.addEventListener('mousedown', unlockAllAudioOnce, opts);
    document.addEventListener('keydown', unlockAllAudioOnce, opts);
  }

  // Arm on load.
  armUnlockListeners();

  // Re-arm when returning to the tab/app.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      audioUnlocked = false;
      armUnlockListeners();
    }
  });
  
  function toggleMusic() {
    // Ensure we unlock on the same user gesture as the toggle click.
    unlockAllAudioOnce();
    allSoundsMuted = !allSoundsMuted;
    
    if (allSoundsMuted) {
      // Mute all sounds
      music.pause();
      sandSound.pause();
      stoneSound.pause();
      rewardSound.pause();
      compassSound.pause();
	    pageTurnSound.pause();
	    evaluateSound.pause();
      musicIcon.textContent = '🔇';
    } else {
      // Unmute - background music plays, others play as triggered
	    const p = music.play();
	    if (p && typeof p.catch === 'function') p.catch(() => {});
      musicIcon.textContent = '🔊';
    }
  }
