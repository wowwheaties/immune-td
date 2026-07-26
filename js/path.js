window.Path = {
  WAYPOINTS: [
    [0,4],[1,4],[2,4],[3,4],[3,5],[3,6],[4,6],[5,6],
    [6,6],[7,6],[7,5],[7,4],[7,3],[8,3],[9,3],[10,3],
    [10,4],[10,5],[11,5],[12,5],[13,5],[13,4],[14,4],[15,4]
  ],
  get length() { return this.WAYPOINTS.length; },

  _set: null, // flat Set of "x,y" strings for O(1) lookup

  init: function() {
    var s = [];
    for (var i = 0; i < this.WAYPOINTS.length; i++) {
      s.push(this.WAYPOINTS[i][0] + ',' + this.WAYPOINTS[i][1]);
    }
    this._set = new Set(s);
  },

  isPath: function(x, y) {
    return this._set.has(x + ',' + y);
  },

  indexAt: function(x, y) {
    var key = x + ',' + y;
    for (var i = 0; i < this.WAYPOINTS.length; i++) {
      if (this.WAYPOINTS[i][0] === x && this.WAYPOINTS[i][1] === y) return i;
    }
    return -1;
  },

  cellAt: function(i) {
    if (i < 0 || i >= this.WAYPOINTS.length) return null;
    return [this.WAYPOINTS[i][0], this.WAYPOINTS[i][1]];
  },

  setWaypoints: function(arr) {
    var s = [];
    for (var i = 0; i < arr.length; i++) {
      this.WAYPOINTS[i] = [arr[i][0], arr[i][1]];
      s.push(this.WAYPOINTS[i][0] + ',' + this.WAYPOINTS[i][1]);
    }
    // trim or extend
    while (this.WAYPOINTS.length > arr.length) this.WAYPOINTS.pop();
    while (this.WAYPOINTS.length < arr.length) {
      var last = this.WAYPOINTS[this.WAYPOINTS.length - 1] || [0,0];
      this.WAYPOINTS.push([last[0], last[1]]);
    }
    this._set = new Set(s);
  }
};

Path.init();
