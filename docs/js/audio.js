// ===================================
  // ðŸŽµ MUSIC TOGGLE
  // ===================================
  const music = document.getElementById('bgMusic');
  const musicIcon = document.getElementById('musicIcon');
  let allSoundsMuted = true; // Start muted - user can enable with button
  
  function toggleMusic() {
    allSoundsMuted = !allSoundsMuted;
    
    if (allSoundsMuted) {
      // Mute all sounds
      music.pause();
      sandSound.pause();
      stoneSound.pause();
      rewardSound.pause();
      compassSound.pause();
      musicIcon.textContent = '🔇';
    } else {
      // Unmute - background music plays, others play as triggered
      music.play();
      musicIcon.textContent = '🔊';
    }
  }
