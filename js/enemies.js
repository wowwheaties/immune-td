window.Enemies = {
  SPEED_TICKS: 10,
  DEFAULT_HP: 10,
  FAST_HP: 6,
  FAST_SPEED_TICKS: 6,
  FUNGUS_HP: 16,
  PARASITE_HP: 14,
  CANCER_HP: 40,
  FUNGUS_SPEED: 14,
  PARASITE_SPEED: 16,
  CANCER_SPEED: 12,
  SPORE_HP: 4,    SPORE_SPEED: 5,
  TOXIN_HP: 8,    TOXIN_SPEED: 7,
  PRION_HP: 22,   PRION_SPEED: 11,
  BIOFILM_HP: 28, BIOFILM_SPEED: 20,
  BOSS_HP: 100,
  BOSS_SPEED: 14,
  PACK_STAGGER: 3,
  _nextId: 1,
  _enemies: {},

  reset: function() {
    this._nextId = 1;
    this._enemies = {};
  },

  spawn: function(type, holdTicks, visLane) {
    type = type || 'basic';
    var id = this._nextId++;
    var cell = Path.cellAt(0); // [0,3]
    var hp = this.DEFAULT_HP;
    var speedTicks = this.SPEED_TICKS;
    if (type === 'fast') { hp = this.FAST_HP; speedTicks = this.FAST_SPEED_TICKS; }
    else if (type === 'fungus') { hp = this.FUNGUS_HP; speedTicks = this.FUNGUS_SPEED; }
    else if (type === 'parasite') { hp = this.PARASITE_HP; speedTicks = this.PARASITE_SPEED; }
    else if (type === 'cancer') { hp = this.CANCER_HP; speedTicks = this.CANCER_SPEED; }
    else if (type === 'spore')   { hp = this.SPORE_HP;   speedTicks = this.SPORE_SPEED; }
    else if (type === 'toxin')   { hp = this.TOXIN_HP;   speedTicks = this.TOXIN_SPEED; }
    else if (type === 'prion')   { hp = this.PRION_HP;   speedTicks = this.PRION_SPEED; }
    else if (type === 'biofilm') { hp = this.BIOFILM_HP; speedTicks = this.BIOFILM_SPEED; }
    else if (type === 'boss') { hp = this.BOSS_HP; speedTicks = this.BOSS_SPEED; }
    holdTicks = holdTicks | 0;
    if (holdTicks < 0) holdTicks = 0;
    visLane = visLane | 0;
    if (visLane < 0) visLane = 0;
    this._enemies[id] = {
      id: id,
      x: cell[0],
      y: cell[1],
      wpIndex: 0,
      hp: hp,
      alive: true,
      tickCount: 0,
      speedTicks: speedTicks,
      slowTicks: 0,
      slowPhase: 0,
      type: type,
      holdTicks: holdTicks,
      visLane: visLane
    };
    return id;
  },

  get: function(id) {
    var e = this._enemies[id];
    if (!e || !e.alive) return null;
    return {
      id: e.id,
      x: e.x,
      y: e.y,
      wpIndex: e.wpIndex,
      hp: e.hp,
      alive: e.alive,
      type: e.type,
      speedTicks: e.speedTicks,
      slowTicks: e.slowTicks || 0,
      tickCount: e.tickCount,
      visLane: e.visLane || 0
    };
  },

  all: function() {
    var result = [];
    for (var id in this._enemies) {
      if (this._enemies[id].alive) {
        var e = this._enemies[id];
        result.push({
          id: e.id,
          x: e.x,
          y: e.y,
          wpIndex: e.wpIndex,
          hp: e.hp,
          alive: e.alive,
          type: e.type,
          speedTicks: e.speedTicks,
          slowTicks: e.slowTicks || 0,
          tickCount: e.tickCount,
          visLane: e.visLane || 0
        });
      }
    }
    return result;
  },

  tick: function() {
    var ids = [];
    for (var id in this._enemies) {
      if (this._enemies[id].alive) ids.push(parseInt(id));
    }
    ids.sort(function(a, b) { return a - b; });

    for (var i = 0; i < ids.length; i++) {
      var e = this._enemies[ids[i]];
      if (!e || !e.alive) continue;

      /* hold: skip tickCount++, wp advance while holding */
      if (e.holdTicks > 0) { e.holdTicks--; continue; }

      /* slow: skip every other progress tick (do not advance tickCount on skip) */
      var _slowSkip = false;
      if (e.slowTicks > 0) {
        e.slowPhase = (e.slowPhase || 0) + 1;
        e.slowTicks--;
        if ((e.slowPhase % 2) === 1) { _slowSkip = true; }
      }
      if (_slowSkip) continue;
      e.tickCount++;

      if (e.tickCount >= (e.speedTicks || this.SPEED_TICKS)) {
        e.tickCount = 0;
        e.wpIndex += 1;
        var cell = Path.cellAt(e.wpIndex);
        if (cell !== null) {
          e.x = cell[0];
          e.y = cell[1];
        }
        // Check exit: wpIndex >= Path.length means past last waypoint
        if (e.wpIndex >= Path.length) {
          e.alive = false;
          Lives.lose(1);
        }
      }
    }
  },

  damage: function(id, amount) {
    var e = this._enemies[id];
    if (!e || !e.alive) return false;
    e.hp -= amount;
    if (e.hp <= 0) {
      e.hp = 0;
      e.alive = false;
      if (window.Sfx) Sfx.play('death');
    } else if (amount > 0) {
      if (window.Sfx) Sfx.play('hit');
    }
    return true;
  },

  count: function() {
    var c = 0;
    for (var id in this._enemies) {
      if (this._enemies[id].alive) c++;
    }
    return c;
  },

  at: function(x, y) {
    for (var id in this._enemies) {
      var e = this._enemies[id];
      if (e.alive && e.x === x && e.y === y) return parseInt(id);
    }
    return -1;
  },

  applySlow: function(id, n) {
    var e = this._enemies[id];
    if (!e || !e.alive) return;
    e.slowTicks = Math.max(e.slowTicks || 0, n);
  },

visualProgress: function(id) {
    var e = this._enemies[id];
    if (!e || !e.alive) return null;
    // current sim cell
    var x0 = e.x, y0 = e.y;
    // next waypoint cell (wpIndex+1)
    var nextCell = Path.cellAt(e.wpIndex + 1);
    var x1, y1;
    if (nextCell !== null) {
      x1 = nextCell[0];
      y1 = nextCell[1];
    } else {
      x1 = x0;
      y1 = y0;
    }
    // frac = (tickCount + sub) / SPEED_TICKS
    var sub = 0;
    if (window.__lastGameTickMs != null) {
      var now = performance.now();
      var msPerSim = window.SIM_TICK_MS || (1000 / 30);
      sub = Math.min((now - window.__lastGameTickMs) / msPerSim, 0.999);
    }
    var frac = (e.tickCount + sub) / (e.speedTicks || this.SPEED_TICKS);
    return { x0: x0, y0: y0, x1: x1, y1: y1, frac: frac };
  }
};
