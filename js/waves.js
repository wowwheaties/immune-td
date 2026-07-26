window.Waves = {
  SCHEDULE: [[0,1],[30,2],[90,3],[180,5]],

  _t: 0,
  _spawnedIds: null,

  reset: function() {
    this._t = 0;
    this._spawnedIds = [];
  },

  setSchedule: function(arr) {
    this.SCHEDULE = [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i][2] !== undefined) {
        this.SCHEDULE.push([arr[i][0], arr[i][1], arr[i][2]]);
      } else {
        this.SCHEDULE.push([arr[i][0], arr[i][1]]);
      }
    }
    this.reset();
  },

  getSchedule: function() {
    var out = [];
    for (var i = 0; i < this.SCHEDULE.length; i++) {
      if (this.SCHEDULE[i][2] !== undefined) {
        out.push([this.SCHEDULE[i][0], this.SCHEDULE[i][1], this.SCHEDULE[i][2]]);
      } else {
        out.push([this.SCHEDULE[i][0], this.SCHEDULE[i][1]]);
      }
    }
    return out;
  },

  tickCount: function() {
    return this._t;
  },

  // SEQ-197: map pack index j to full lateral slots for eye-bar spread
  packVisLane: function(j, n) {
    if (n <= 1) return 1;          // center → (1%3-1)=0 lateral
    if (n === 2) return j === 0 ? 0 : 2;  // left + right extremes
    if (j <= 2) return j;           // 0,1,2 for first three
    return j % 3;                   // 3+ wrap slots
  },

  done: function() {
    var lastTick = 0;
    for (var i = 0; i < this.SCHEDULE.length; i++) {
      if (this.SCHEDULE[i][0] > lastTick) lastTick = this.SCHEDULE[i][0];
    }
    return this._t > lastTick;
  },

  isWin: function() {
    return this.done() && window.Enemies.count() === 0 && window.Lives.get() > 0;
  },

  isLose: function() {
    return window.Lives.get() <= 0;
  },

  tick: function() {
    var spawned = [];
    for (var i = 0; i < this.SCHEDULE.length; i++) {
      var entry = this.SCHEDULE[i];
      if (entry[0] === this._t) {
        var n = entry[1];
        for (var j = 0; j < n; j++) {
          var typ = entry[2] || 'basic';
          var id = window.Enemies.spawn(typ, 0, this.packVisLane(j, n));
          spawned.push(id);
        }
      }
    }
    this._spawnedIds = spawned;
    this._t += 1;
    return spawned;
  }
};
