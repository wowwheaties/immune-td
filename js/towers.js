window.Towers = {
  RANGE: 2, // Manhattan
  DAMAGE: 5,
  COOLDOWN: 20,
  PATCH_COOLDOWN: 15,
  INFLAMED_COOLDOWN: 30,
  SLOW_COST: 75,
  ANTIBODY_COST: 100,
  TCELL_COST: 125,
  TCELL_DAMAGE: 10,
  TYPE_BASIC: "basic",
  TYPE_SLOW: "slow",
  TYPE_ANTIBODY: "antibody",
  TYPE_TCELL: "tcell",
  TYPE_FEVER: "fever",
  TYPE_NK: "nk",
  TYPE_CYTOKINE: "cytokine",
  FEVER_COST: 150,
  NK_COST: 130,
  CYTOKINE_COST: 140,
  FEVER_BURN_RADIUS: 3,
  CYTOKINE_AURA_RADIUS: 3,

  _nextId: 1,
  _towers: {},   // id → {id,x,y}
  _grid: null,   // [y][x] tower id or -1

  reset: function() {
    this._nextId = 1;
    this._towers = {};
    var W = Grid.W, H = Grid.H;
    this._grid = [];
    for (var y = 0; y < H; y++) {
      this._grid[y] = new Array(W);
      for (var x = 0; x < W; x++) {
        this._grid[y][x] = -1;
      }
    }
  },

  place: function(x, y, type) {
    if (type == null) type = this.TYPE_BASIC;
    var cost = Economy.PLACE_COST;
    if (type === this.TYPE_SLOW) cost = this.SLOW_COST;
    else if (type === this.TYPE_ANTIBODY) cost = this.ANTIBODY_COST;
    else if (type === this.TYPE_TCELL) cost = this.TCELL_COST;
    else if (type === this.TYPE_FEVER) cost = this.FEVER_COST;
    else if (type === this.TYPE_NK) cost = this.NK_COST;
    else if (type === this.TYPE_CYTOKINE) cost = this.CYTOKINE_COST;
    // a. out of bounds
    if (x < 0 || x >= Grid.W || y < 0 || y >= Grid.H) return false;
    // b. not buildable
    if (!Grid.isBuildable(x, y)) return false;
    // c. occupied
    if (this._grid[y][x] !== -1) return false;
    // d. insufficient gold
    var spent = Economy.spend(cost);
    if (!spent) return false;

    // create tower
    var id = this._nextId++;
    var t = { id: id, x: x, y: y, cd: this.COOLDOWN + ((id - 1) % 5), acquiredTarget: -1, focusEnemyId: -1, type: type };
    t.cdMax = (Grid.specialAt(x,y) === 'patch') ? this.PATCH_COOLDOWN
             : (Grid.specialAt(x,y) === 'inflamed') ? this.INFLAMED_COOLDOWN
             : this.COOLDOWN;
    this._towers[id] = t;
    this._grid[y][x] = id;
    return id;
  },

  sell: function(id) {
    var t = this._towers[id];
    if (!t) return false;
    Economy.refund(Economy.SELL_REFUND);
    delete this._towers[id];
    this._grid[t.y][t.x] = -1;
    return true;
  },

  cdMaxOf: function(id) {
    var t = this._towers[id];
    return t ? (t.cdMax || this.COOLDOWN) : -1;
  },

  get: function(id) {
    var t = this._towers[id];
    if (!t) return null;
    return { id: t.id, x: t.x, y: t.y, type: t.type };
  },

  all: function() {
    var result = [];
    for (var id in this._towers) {
      var t = this._towers[id];
      if (t) result.push({ id: t.id, x: t.x, y: t.y, type: t.type });
    }
    return result;
  },

  at: function(x, y) {
    if (x < 0 || x >= Grid.W || y < 0 || y >= Grid.H) return -1;
    return this._grid[y][x];
  },

  rangeOf: function(type) {
    if (type === "slow" || type === "tcell") return 1;
    if (type === "antibody") return 3;
    if (type === "nk") return 3;
    if (type === "fever") return 2; // main range
    if (type === "cytokine") return 2; // main range
    return this.RANGE; // default basic = 2
  },

  inRange: function(tx, ty, ex, ey, r) {
    var dx = Math.abs(tx - ex);
    var dy = Math.abs(ty - ey);
    return (dx + dy) <= (r !== undefined ? r : this.RANGE);
  },

  count: function() {
    var c = 0;
    for (var id in this._towers) { if (this._towers[id]) c++; }
    return c;
  },

  targetOf: function(id) {
    var t = this._towers[id];
    if (!t) return -1;
    return t.acquiredTarget;
  },

  cdOf: function(id) {
    var t = this._towers[id];
    if (!t) return -1;
    return t.cd;
  },

  tick: function() {
    var ids = [];
    for (var id in this._towers) { if (this._towers[id]) ids.push(parseInt(id)); }
    ids.sort(function(a, b) { return a - b; });

    var claimed = {}; // enemyId -> true, claimed this tick by earlier tower

    for (var i = 0; i < ids.length; i++) {
      var t = this._towers[ids[i]];
      if (!t) continue;

      var allEnemies = Enemies.all();
      var keepId = -1;

      // F-STAB: keep current target if still living + in range
      if (t.acquiredTarget >= 0) {
        var cur = Enemies.get(t.acquiredTarget);
        if (cur && this.inRange(t.x, t.y, cur.x, cur.y, this.rangeOf(t.type))) {
          keepId = cur.id;
        }
      }

      var bestId = keepId;
      function pickBest(preferUnclaimed) {
        var bid = -1, bwp = -1;
        for (var j = 0; j < allEnemies.length; j++) {
          var e = allEnemies[j];
          if (!this.inRange(t.x, t.y, e.x, e.y, this.rangeOf(t.type))) continue;
          if (preferUnclaimed && claimed[e.id]) continue;
          if (e.wpIndex > bwp || (e.wpIndex === bwp && (bid < 0 || e.id < bid))) {
            bid = e.id; bwp = e.wpIndex;
          }
        }
        return bid;
      }
      if (bestId < 0) {
        // (re)acquire: prefer unclaimed, else allow share
        bestId = pickBest.call(this, true);
        if (bestId < 0) bestId = pickBest.call(this, false);
      } else if (claimed[bestId]) {
        // SEQ-217: soft yield block replace — only the tower that last hit this enemy refuses yield
        var curE = Enemies.get(bestId);
        var maxHp = (curE && curE.type === 'fast') ? (Enemies.FAST_HP || 6) : (Enemies.DEFAULT_HP || 10);
        var wounded = curE && curE.hp < maxHp;
        if (!(wounded && t.focusEnemyId === bestId)) {
          var alt = pickBest.call(this, true);
          if (alt >= 0) bestId = alt;
        }
      }

      if (bestId >= 0) claimed[bestId] = true;

      if (bestId !== t.acquiredTarget) {
        var prev = t.acquiredTarget;
        t.acquiredTarget = bestId;
        // SEQ-213: only rewind CD when going from NO target → target
        // SEQ-215: only prime when cold (place/post-fire full CD); keep mid-CD on re-acquire
        if (bestId >= 0 && prev < 0 && t.cd >= this.COOLDOWN) t.cd = this.COOLDOWN - 1;
      } else if (bestId >= 0) {
        t.cd -= 1;
        if (t.cd === 0) {
          var dmg = (t.type === this.TYPE_TCELL) ? this.TCELL_DAMAGE : this.DAMAGE;
          var tgt = Enemies.get(bestId);
          if (t.type === this.TYPE_NK && tgt && tgt.type === 'fast') dmg = 8;
          var willKill = !!(tgt && tgt.hp <= dmg);
          Presentation.notifyFire(t.id, bestId, { willKill: willKill });
          var victim = Enemies.get(bestId);
          var vtype = victim && victim.type || 'basic';
          Enemies.damage(bestId, dmg);
          if (!Enemies.get(bestId)) Economy.earn(Economy.KILL_REWARD[vtype] || Economy.KILL_REWARD.basic);
          t.focusEnemyId = bestId;
          Sfx.play('fire');
          if (t.type === this.TYPE_SLOW) Enemies.applySlow(bestId, 45);
          if (t.type === this.TYPE_ANTIBODY) Enemies.applySlow(bestId, 50);
          if (t.type === this.TYPE_FEVER) {
            for (var k = 0; k < allEnemies.length; k++) {
              var fe = allEnemies[k];
              if (this.inRange(t.x, t.y, fe.x, fe.y, this.FEVER_BURN_RADIUS)) {
                var ftype = fe && fe.type || 'basic';
                Enemies.damage(fe.id, 1);
                if (!Enemies.get(fe.id)) Economy.earn(Economy.KILL_REWARD[ftype] || Economy.KILL_REWARD.basic);
              }
            }
          }
          if (t.type === this.TYPE_CYTOKINE) {
            var tx2 = t.x, ty2 = t.y;
            for (var m = 0; m < ids.length; m++) {
              var t2 = this._towers[ids[m]];
              if (!t2 || t2.id === t.id) continue;
              var ddx = Math.abs(tx2 - t2.x), ddy = Math.abs(ty2 - t2.y);
              if (ddx + ddy <= this.CYTOKINE_AURA_RADIUS && t2.cd > 2) t2.cd -= 2;
            }
          }
          t.cd = t.cdMax || this.COOLDOWN;
        }
      }
      // bestId < 0 and already -1: no-op
    }
  }
};

Towers.reset();
