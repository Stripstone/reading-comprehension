// ===================================
  // ðŸ”¥ FIRE EMBERS CANVAS ANIMATION
  // ===================================
  const rootStyles = getComputedStyle(document.documentElement);
  const EMBER_QUANTITY = parseInt(rootStyles.getPropertyValue('--ember-quantity'));
  const EMBER_SIZE_MIN = parseFloat(rootStyles.getPropertyValue('--ember-size-min'));
  const EMBER_SIZE_MAX = parseFloat(rootStyles.getPropertyValue('--ember-size-max'));
  const EMBER_SPEED_MIN = parseFloat(rootStyles.getPropertyValue('--ember-speed-min'));
  const EMBER_SPEED_MAX = parseFloat(rootStyles.getPropertyValue('--ember-speed-max'));
  const EMBER_LIFE_MIN = parseFloat(rootStyles.getPropertyValue('--ember-life-min'));
  const EMBER_LIFE_MAX = parseFloat(rootStyles.getPropertyValue('--ember-life-max'));
  const EMBER_FADE_THRESHOLD = parseInt(rootStyles.getPropertyValue('--ember-fade-threshold'));

  var ww = window.innerWidth;
  var wh = window.innerHeight;
  var canvas = document.getElementById("fireCanvas");
  canvas.width = ww;
  canvas.height = wh;
  var ctx = canvas.getContext('2d');

  function between(min, max) {
    return Math.random() * (max - min) + min;
  }

  var particles = [];
  for (i = 0; i < EMBER_QUANTITY; i++) {
    particles.push(new createP());
  }

  function createP() {
    this.x = between(ww * 0.1, ww * 0.9);
    this.y = between(wh * 0.9, wh * 1);
    this.size = between(EMBER_SIZE_MIN, EMBER_SIZE_MAX);
    this.vx = Math.random() * 1 - 0.5;
    this.vy = -between(EMBER_SPEED_MIN, EMBER_SPEED_MAX);
    this.g = -0.001 * Math.random() * 10;
    this.life = between(wh * EMBER_LIFE_MIN, wh * EMBER_LIFE_MAX);

    var one = '#FF2200';    // Bright scarlet
    var two = '#FF6600';    // Bright orange
    var three = '#FFA500';  // Golden orange
    var array = [one, two, three];
    this.color = array[Math.floor(Math.random() * 3)];

    this.reset = function() {
      this.x = between(ww * 0.1, ww * 0.9);
      this.y = between(wh * 0.9, wh * 1);
      this.size = between(EMBER_SIZE_MIN, EMBER_SIZE_MAX);
      this.vx = Math.random() * 1 - 0.5;
      this.vy = -between(EMBER_SPEED_MIN, EMBER_SPEED_MAX);
      this.g = -0.001 * Math.random() * 10;
      this.life = between(wh * EMBER_LIFE_MIN, wh * EMBER_LIFE_MAX);
      var array = [one, two, three];
      this.color = array[Math.floor(Math.random() * 3)];
    }
  }

  var draw = function() {
    ctx.clearRect(0, 0, ww, wh);

    for (t = 0; t < particles.length; t++) {
      var p = particles[t];

      ctx.beginPath();
      ctx.fillStyle = p.color;
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2, false);
      ctx.fill();

      p.x += p.vx;
      p.y += p.vy += p.g;
      p.life--;

      if (p.life < EMBER_FADE_THRESHOLD) {
        p.color = 'rgba(25, 25, 25, 0.3)';
      }
      if (p.life < 1) {
        p.reset();
      }
    }
  }

  setInterval(draw, 16);

  window.addEventListener('resize', function() {
    ww = window.innerWidth;
    wh = window.innerHeight;
    canvas.width = ww;
    canvas.height = wh;
  });
