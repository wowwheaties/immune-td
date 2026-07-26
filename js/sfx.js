(function() {
  var ctx = null;
  var ready = false;
  var unlocked = false;
  var muted = false;
  var played = [];
  var hitVoiceEnds = []; // timestamps when voices free

  var FREQS = { place: 480, fire: 620, hit: 300, death: 220, win: 700, lose: 160 };
  var DURS  = { place: 0.07, fire: 0.05, hit: 0.06, death: 0.12, win: 0.15, lose: 0.18 };

  function tryCreateCtx() {
    if (ctx) { ready = true; return; }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      ready = true;
    } catch (e) { /* headless */ }
  }

  function onGesture(e) {
    if (!e || !e.isTrusted) return;
    unlocked = true;
    tryCreateCtx();
    if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch(ex) {} }
    document.removeEventListener('click', onGesture, true);
    document.removeEventListener('keydown', onGesture, true);
    document.removeEventListener('touchend', onGesture, true);
  }

  function init() {
    if (unlocked && ctx) { ready = true; return; }
    // Do NOT create AudioContext without trusted gesture / userActivation
    var hasActivation = (navigator.userActivation && navigator.userActivation.hasBeenActive);
    if (hasActivation) {
      unlocked = true;
      tryCreateCtx();
      return;
    }
    if (!unlocked) {
      document.addEventListener('click', onGesture, true);
      document.addEventListener('keydown', onGesture, true);
      document.addEventListener('touchend', onGesture, true);
    }
  }

  function play(name) {
    if (!name || !(name in FREQS)) return false;
    played.push(name);
    if (muted) return true;
    if (!ready || !ctx) return true; // log only until unlock
    try {
      if (ctx.state === 'suspended') ctx.resume();
      var t0 = ctx.currentTime;

      if (name === 'fire') {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, t0);
        osc.frequency.exponentialRampToValueAtTime(380, t0 + 0.10);
        gain.gain.setValueAtTime(0.12, t0);
        gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.10);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.11);

        var osc2 = ctx.createOscillator();
        var gain2 = ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(2400, t0);
        osc2.frequency.exponentialRampToValueAtTime(760, t0 + 0.10);
        gain2.gain.setValueAtTime(0.06, t0);
        gain2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.10);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(t0);
        osc2.stop(t0 + 0.11);

        return true;
      }

      if (name === 'hit') {
        var now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        hitVoiceEnds = hitVoiceEnds.filter(function(t){ return t > now; });
        if (hitVoiceEnds.length >= 3) { return true; }
        hitVoiceEnds.push(now + 80);
        try {
          var t0 = ctx.currentTime;
          // Create ~80ms white noise buffer
          var sr = ctx.sampleRate;
          var len = Math.round(0.08 * sr);
          var buf = ctx.createBuffer(1, len, sr);
          var data = buf.getChannelData(0);
          for (var i = 0; i < len; i++) { data[i] = (Math.random() * 2 - 1); }
          var src = ctx.createBufferSource();
          src.buffer = buf;
          // Lowpass ~400Hz
          var lp = ctx.createBiquadFilter();
          lp.type = 'lowpass';
          lp.frequency.value = 400;
          var g = ctx.createGain();
          g.gain.setValueAtTime(0.05, t0);
          g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
          src.connect(lp);
          lp.connect(g);
          g.connect(ctx.destination);
          src.start(t0);
        } catch (e) { /* policy */ }
        return true;
      }

      if (name === 'death') {
        try {
          var t0 = ctx.currentTime;
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(180, t0);
          osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.12);
          gain.gain.setValueAtTime(0.14, t0);
          gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(t0);
          osc.stop(t0 + 0.14);
        } catch (e) { /* policy */ }
        return true;
      }

      if (name === 'win') {
        try {
          var t0 = ctx.currentTime;
          var notes = [523, 659, 784]; // C5 E5 G5
          for (var i = 0; i < notes.length; i++) {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.type = 'sine';
            var nt = t0 + i * 0.06;
            osc.frequency.setValueAtTime(notes[i], nt);
            gain.gain.setValueAtTime(0, nt);
            gain.gain.linearRampToValueAtTime(0.12, nt + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, nt + 0.14);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(nt);
            osc.stop(nt + 0.15);
          }
        } catch (e) { /* policy */ }
        return true;
      }

      if (name === 'lose') {
        try {
          var t0 = ctx.currentTime;
          var notes = [280, 235, 196]; // minor-ish descent
          for (var i = 0; i < notes.length; i++) {
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.type = 'triangle';
            var nt = t0 + i * 0.07;
            osc.frequency.setValueAtTime(notes[i], nt);
            gain.gain.setValueAtTime(0, nt);
            gain.gain.linearRampToValueAtTime(0.12, nt + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, nt + 0.16);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(nt);
            osc.stop(nt + 0.17);
          }
        } catch (e) { /* policy */ }
        return true;
      }

      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = FREQS[name];
      gain.gain.value = 0.12;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + (DURS[name] || 0.08));
    } catch (e) { /* policy */ }
    return true;
  }

  function resetPlayed() { played.length = 0; }
  function setMuted(m) { muted = !!m; }
  function isMuted() { return !!muted; }
  function readyFn() { return !!ready && !!ctx; }
  function isUnlocked() { return !!unlocked; }

  window.Sfx = {
    init: init,
    play: play,
    played: played,
    resetPlayed: resetPlayed,
    setMuted: setMuted,
    isMuted: isMuted,
    ready: readyFn,
    isUnlocked: isUnlocked
  };
})();
