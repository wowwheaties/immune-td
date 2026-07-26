window.Missions = {
  LIST: [
    // Mission 0 (default / boot)
    { seed: 1, gold: 200, lives: 5, schedule: [[0,2],[170,3],[360,3,'spore'],[570,4],[790,3,'fast'],[1020,4,'spore'],[1260,5],[1510,3,'toxin'],[1770,4,'fast'],[2040,5,'toxin'],[2320,4,'fungus'],[2610,5,'fast'],[2910,4,'parasite'],[3220,1,'boss']], waypoints: [[0,4],[1,4],[2,4],[3,4],[3,5],[3,6],[4,6],[5,6],[6,6],[7,6],[7,5],[7,4],[7,3],[8,3],[9,3],[10,3],[10,4],[10,5],[11,5],[12,5],[13,5],[13,4],[14,4],[15,4]] },
    // Mission 1
    { seed: 7, gold: 250, lives: 3, schedule: [[0,2],[40,2],[100,4]], waypoints: [[0,1],[1,1],[2,1],[3,1],[4,1],[5,1],[5,2],[5,3],[5,4],[6,4],[7,4],[8,4],[8,3],[8,2],[9,2],[10,2],[11,2],[11,3],[11,4],[11,5],[12,5],[13,5],[14,5],[15,5]] },
    // Mission 2
    { seed: 42, gold: 150, lives: 7, schedule: [[0,1],[20,1],[60,3],[120,2],[150,1,'fast']], waypoints: [[0,7],[1,7],[2,7],[3,7],[3,6],[3,5],[3,4],[4,4],[5,4],[5,5],[5,6],[6,6],[7,6],[8,6],[9,6],[9,5],[9,4],[9,3],[10,3],[11,3],[12,3],[13,3],[13,2],[14,2],[15,2]] },
    // Mission 3
    { seed: 99, gold: 200, lives: 4, schedule: [[0,1],[40,2],[100,3],[160,2,'fast']], waypoints: [[0,6],[1,6],[2,6],[2,5],[2,4],[2,3],[3,3],[4,3],[5,3],[6,3],[6,4],[6,5],[6,6],[7,6],[8,6],[9,6],[10,6],[10,5],[10,4],[10,3],[10,2],[11,2],[12,2],[13,2],[14,2],[14,3],[14,4],[15,4]] }
  ],

  _current: -1,

  count: function() { return this.LIST.length; },

  current: function() { return this._current; },

  load: function(i) {
    if (i < 0 || i >= this.LIST.length) return false;
    this._current = i;
    var m = this.LIST[i];

    // Path — use public setWaypoints (no WAYPOINTS mutation)
    window.Path.setWaypoints(m.waypoints);

    // Waves — schedule + reset counter
    window.Waves.setSchedule(m.schedule);

    // Economy + Lives — public reset APIs
    window.Economy.reset(m.gold);
    window.Lives.reset(m.lives);

    // Towers + Enemies reset
    window.Towers.reset();
    window.Enemies.reset();

    // Grid seed
    window.Grid.init(m.seed);

    return true;
  }
};
