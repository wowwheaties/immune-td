window.Game = (function() {
  var _state = 'idle';

  function frustum() {
    var TILE = Grid.TILE;
    var barH = 0, barW = 0; try { var _r = document.getElementById('bottom-bar').getBoundingClientRect(); barH = _r.height || 0; barW = _r.width || 0; } catch(e) {}
    var worldW = Grid.W * TILE;
    var worldH = Grid.H * TILE;
    var vw = window.innerWidth, vh = window.innerHeight;
    var portrait = vh > vw;
    var sideDock = barH > vh * 0.8 && barW < vw * 0.5;
    barH = sideDock ? 0 : barH;
    barW = sideDock ? barW : 0;
    var visH = portrait ? vh : Math.max(100, vh - barH);
    var occupancy = portrait ? 0.88 : 0.94;
    var visW = Math.max(100, vw - barW);
    var visAspect = visW / visH;
    var worldAspect = worldW / worldH;
    var halfW, halfH;
    if (worldAspect > visAspect) { halfW = (worldW / 2) / occupancy; halfH = halfW / visAspect; }
    else { halfH = (worldH / 2) / occupancy; halfW = halfH * visAspect; }
    var camSizeX = halfW * vw / visW;
    var camSizeY = halfH * vh / visH;
    var cy = portrait ? 0 : -(barH * camSizeY / vh);
    var ox = -Grid.W * TILE / 2 + TILE / 2;
    var oy = +Grid.H * TILE / 2 - TILE / 2;
    var cx = +(barW * camSizeX / vw);
    return { camSizeX: camSizeX, camSizeY: camSizeY, cy: cy, cx: cx, ox: ox, oy: oy, TILE: TILE, PORTRAIT_ZOOM: 0.88 };
  }

  return {
    frustum: frustum,
    PORTRAIT_ZOOM: 0.88,

    state: function() { return _state; },

    reset: function() {
      var i = Missions.current();
      Missions.load(i >= 0 ? i : 0);
      _state = 'idle';
    },

    start: function() {
      if (_state === 'running') return;
      _state = 'running';
    },

    pause: function() {
      if (_state === 'running') _state = 'idle';
    },

    tick: function() {
      if (_state !== 'running') return;
      Waves.tick();
      Enemies.tick();
      Towers.tick();
      if (Waves.isLose()) { _state = 'lost'; if (window.Sfx) Sfx.play('lose'); }
      else if (Waves.isWin()) { _state = 'won'; if (window.Sfx) Sfx.play('win'); }
    },

    cellFromClient: function(clientX, clientY) {
      if (!isFinite(clientX) || !isFinite(clientY)) return null;
      var canvas = document.getElementById('c');
      if (!canvas) return null;
      var f = Game.frustum();
      var rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      var ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      var ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
      var worldX = f.cx + ndcX * f.camSizeX;
      var worldY = f.cy + ndcY * f.camSizeY;
      var gx = Math.round((worldX - f.ox) / f.TILE);
      var gy = Math.round((f.oy - worldY) / f.TILE);
      if (gx < 0 || gy < 0 || gx >= Grid.W || gy >= Grid.H) return null;
      return { x: gx, y: gy };
    },

    clientCenterOfCell: function(gx, gy) {
      if (!isFinite(gx) || !isFinite(gy)) return null;
      if (gx < 0 || gy < 0 || gx >= Grid.W || gy >= Grid.H) return null;
      var canvas = document.getElementById('c');
      if (!canvas) return null;
      var f = Game.frustum();
      var rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      var worldX = gx * f.TILE + f.ox;
      var worldY = -(gy * f.TILE) + f.oy;
      var ndcX = (worldX - f.cx) / f.camSizeX;
      var ndcY = (worldY - f.cy) / f.camSizeY;
      return {
        clientX: rect.left + (ndcX + 1) / 2 * rect.width,
        clientY: rect.top + (1 - ndcY) / 2 * rect.height
      };
    }
  };
})();
