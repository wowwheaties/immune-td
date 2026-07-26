// Ambient flow ribbon + field overlay — SEQ-335 (L2 FIELD engine)
window.Ambient = {
  _mesh: null,
  _offset: 0,
  _lastMission: -1,
  _canvas: null,
  _texture: null,

  // FLOW constants
  FLOW_SPEED: 0.12,
  SAMPLES_PER_SEG: 8,
  HALF_WIDTH: 0.34,

  // FIELD constants (exactly 2x the 16x9 grid)
  FIELD_W: 32,
  FIELD_H: 18,

  init: function() {
    var mesh = this._mesh;

    // DEFECT 4 FIX: check scene BEFORE teardown so _mesh doesn't point at disposed mesh
    if (!Grid.scene) { this._mesh = null; return; }

    if (mesh) {
      mesh.geometry.dispose();
      mesh.material.map && mesh.material.map.dispose();
      mesh.material.dispose();
    }

    // dispose old field overlay on rebuild
    var fm = this._fieldMesh;
    if (fm) {
      fm.geometry.dispose();
      fm.material.map && fm.material.map.dispose();
      fm.material.dispose();
      Grid.scene.remove(fm);
    }
    this._lastMission = window.Missions ? window.Missions.current() : 0;

    // build texture once
    var tex = this._buildTexture();
    if (this._texture) this._texture.dispose();
    this._texture = tex;

    // build centreline with proper Catmull-Rom indexing
    var WPs = Path.WAYPOINTS;
    var K = WPs.length;
    var S = this.SAMPLES_PER_SEG;
    var HALF_W = this.HALF_WIDTH;
    var TILE = Grid.TILE;
    var ox = -Grid.W * TILE / 2 + TILE / 2;
    var oy = +Grid.H * TILE / 2 - TILE / 2;

    // Build centreline array cl of length (K-1)*S+1 using control-point indexing
    var totalPts = (K - 1) * S + 1;
    var cl = [];
    for (var i = 0; i < totalPts; i++) {
      var j = Math.min(Math.floor(i / S), K - 2);
      var t = (i - j * S) / S;
      // Control points, index-clamped into Path.WAYPOINTS
      var P0 = WPs[Math.max(j - 1, 0)];
      var P1 = WPs[j];
      var P2 = WPs[j + 1];
      var P3 = WPs[Math.min(j + 2, K - 1)];
      // Catmull-Rom per component
      var cx = 0.5 * (2*P1[0] + (-P0[0]+P2[0])*t + (2*P0[0]-5*P1[0]+4*P2[0]-P3[0])*t*t + (-P0[0]+3*P1[0]-3*P2[0]+P3[0])*t*t*t);
      var cy = 0.5 * (2*P1[1] + (-P0[1]+P2[1])*t + (2*P0[1]-5*P1[1]+4*P2[1]-P3[1])*t*t + (-P0[1]+3*P1[1]-3*P2[1]+P3[1])*t*t*t);
      cl.push({x: cx, y: cy});
    }

    var positions = new Float32Array(totalPts * 2 * 3); // 2 verts per point, xyz
    var uvs = new Float32Array(totalPts * 2 * 2);        // 2 verts per point, uv

    for (var i = 0; i < totalPts; i++) {
      var c = cl[i];
      // DEFECT 1 FIX: normals by CENTRAL DIFFERENCE over cl
      var prev = cl[Math.max(i - 1, 0)];
      var next = cl[Math.min(i + 1, totalPts - 1)];
      var dx = next.x - prev.x;
      var dy = next.y - prev.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = dy / len;
      var ny = -dx / len;

      var worldX = c.x * TILE + ox;
      var worldY = -(c.y * TILE) + oy;

      var hw = HALF_W * TILE;
      // two vertices: left edge (v=0) and right edge (v=1)
      for (var v = 0; v < 2; v++) {
        var idx = i * 6 + v * 3;
        positions[idx]     = worldX + nx * hw * (v === 0 ? -1 : 1);
        positions[idx + 1] = worldY + ny * hw * (v === 0 ? -1 : 1);
        positions[idx + 2] = 0.02; // z — between organCanvas (-0.03) and decor (0.12)

        var u = i / S;
        uvs[i * 4 + v * 2]     = u;
        uvs[i * 4 + v * 2 + 1] = v === 0 ? 0.0 : 1.0;
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    var mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      color: new THREE.Color(0.95, 0.88, 0.88)
    });

    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = 0.02;
    mesh.renderOrder = 4;
    mesh.name = 'flowRibbon';

    if (!Grid.scene) { this._mesh = null; return; }
    Grid.scene.add(mesh);
    this._mesh = mesh;

    // === FIELD overlay (SEQ-335) ===
    var FW = this.FIELD_W, FH = this.FIELD_H;
    var fieldTex = new THREE.DataTexture(
      new Uint8Array(FW * FH * 4),
      FW, FH,
      THREE.RGBAFormat
    );
    fieldTex.minFilter = THREE.LinearFilter;
    fieldTex.magFilter = THREE.LinearFilter;
    fieldTex.needsUpdate = true;

    this._fieldInf   = new Float32Array(FW * FH);
    this._fieldHold  = new Float32Array(FW * FH);
    this._fieldNec   = new Float32Array(FW * FH);
    this._fieldTex   = fieldTex;
    this._fieldData  = fieldTex.image.data;
    this._livesStart = window.Lives ? window.Lives.get() : 10;
    this._lastNow    = 0;

    var fieldGeo = new THREE.PlaneGeometry(Grid.W * Grid.TILE, Grid.H * Grid.TILE);
    var fieldMat = new THREE.MeshBasicMaterial({
      map: fieldTex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    var fieldMesh = new THREE.Mesh(fieldGeo, fieldMat);
    fieldMesh.position.z = 0.03;
    fieldMesh.renderOrder = 5;
    fieldMesh.name = 'fieldOverlay';

    if (!Grid.scene) { this._mesh = null; return; }
    Grid.scene.add(fieldMesh);
    this._fieldMesh = fieldMesh;
  },

  frame: function(nowMs) {
    var mesh = this._mesh;
    // rebuild when detached or mission changed (buildMeshes destroys ribbon)
    if (!mesh || mesh.parent !== Grid.scene ||
        (window.Missions && window.Missions.current() !== this._lastMission) ||
        !this._fieldMesh || this._fieldMesh.parent !== Grid.scene) {
      this.init();
      return;
    }

    var offset = -(nowMs / 1000) * this.FLOW_SPEED;
    // wrap into [0,1) — texture repeats every cell (u = arcLength/TILE)
    while (offset < -1) offset += 1;
    while (offset >= 0) offset -= 1;
    mesh.material.map.offset.x = offset + 1; // keep in positive range for RepeatWrapping

    // === FIELD frame update (SEQ-335) ===
    this._fieldFrame(nowMs);
  },

  ribbon: function() { return this._mesh; },

  _buildTexture: function() {
    var canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 64, 64);

    // DEFECT 2 FIX: use ImageData so alpha varies along U (the scrolling axis)
    var img = ctx.createImageData(64, 64);
    for (var x = 0; x < 64; x++) {
      var u = x / 64;
      var s = Math.sin(2*Math.PI*1*u) + 0.5*Math.sin(2*Math.PI*3*u)
            + 0.25*Math.sin(2*Math.PI*7*u) + 0.125*Math.sin(2*Math.PI*11*u);
      var streak = (s / 1.875 + 1) / 2;
      for (var y = 0; y < 64; y++) {
        var edge = Math.sin(Math.PI * (y / 64));
        var a = Math.max(0, Math.min(255, Math.round(streak * edge * 255)));
        var o = (y * 64 + x) * 4;
        img.data[o] = img.data[o+1] = img.data[o+2] = 255;
        img.data[o+3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);

    var tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  },

  // === FIELD methods (SEQ-335) ===

  _fieldFrame: function(nowMs) {
    var FW = this.FIELD_W, FH = this.FIELD_H;
    var inf = this._fieldInf, hold = this._fieldHold, nec = this._fieldNec;
    var data = this._fieldData;
    var dt = Math.min(Math.max(nowMs - this._lastNow, 0), 100);
    this._lastNow = nowMs;

    // 1. DECAY (time-based)
    var k = Math.exp(-dt / 6000);
    for (var i = 0; i < FW * FH; i++) { inf[i] *= k; }

    // 2. INFECTION — read-only from Enemies.all()
    if (window.Enemies && window.Enemies.all) {
      var enemies = window.Enemies.all();
      for (var e = 0; e < enemies.length; e++) {
        var ex = Math.round(enemies[e].x * 2);
        var ey = Math.round(enemies[e].y * 2);
        var dx = dt / 1000 * 2.5;
        for (var dy = -1; dy <= 1; dy++) {
          var ny = ey + dy;
          if (ny < 0 || ny >= FH) continue;
          for (var ddx = -1; ddx <= 1; ddx++) {
            var nx = ex + ddx;
            if (nx < 0 || nx >= FW) continue;
            var ni = ny * FW + nx;
            inf[ni] = Math.min(1, inf[ni] + dx);
          }
        }
      }
    }

    // 3. HOLD — recompute from scratch each frame
    for (var i = 0; i < FW * FH; i++) { hold[i] = 0; }
    if (window.Towers && window.Towers.all) {
      var towers = window.Towers.all();
      for (var t = 0; t < towers.length; t++) {
        var tx = Math.round(towers[t].x * 2);
        var ty = Math.round(towers[t].y * 2);
        var r3sq = 9; // radius 3 squared
        for (var dy = -3; dy <= 3; dy++) {
          var ny = ty + dy;
          if (ny < 0 || ny >= FH) continue;
          var ddy = dy * dy;
          for (var dx = -3; dx <= 3; dx++) {
            var nx = tx + dx;
            if (nx < 0 || nx >= FW) continue;
            var ddx = dx * dx;
            if (ddx + ddy > r3sq) continue;
            var dist = Math.sqrt(ddx + ddy);
            var hi = ny * FW + nx;
            hold[hi] = Math.max(hold[hi], 1 - dist / 3);
          }
        }
      }
    }

    // 4. NECROSIS — from lives lost, splat at EXIT (last waypoint)
    var frac = this._livesStart > 0 ? (this._livesStart - (window.Lives ? window.Lives.get() : 10)) / this._livesStart : 0;
    if (frac > 0 && window.Path && window.Path.WAYPOINTS) {
      var wps = window.Path.WAYPOINTS;
      var lastWP = wps[wps.length - 1];
      var ex2 = Math.round(lastWP[0] * 2);
      var ey2 = Math.round(lastWP[1] * 2);
      var rNec = 2 + 6 * frac;
      var rNecSq = rNec * rNec;
      for (var dy = -Math.ceil(rNec) - 1; dy <= Math.ceil(rNec) + 1; dy++) {
        var ny = ey2 + dy;
        if (ny < 0 || ny >= FH) continue;
        for (var dx = -Math.ceil(rNec) - 1; dx <= Math.ceil(rNec) + 1; dx++) {
          var nx = ex2 + dx;
          if (nx < 0 || nx >= FW) continue;
          var ddx = dx * dx, ddy = dy * dy;
          if (ddx + ddy > rNecSq) continue;
          var dist = Math.sqrt(ddx + ddy);
          var ni = ny * FW + nx;
          nec[ni] = Math.max(nec[ni], frac * (1 - dist / rNec));
        }
      }
    }

    // 5. COMPOSE into Uint8Array, per texel i
    for (var i = 0; i < FW * FH; i++) {
      var o = i * 4;
      var infV = inf[i], holdV = hold[i], necV = nec[i];
      var w = infV + holdV + necV + 1e-6;
      data[o]   = Math.max(0, Math.min(255, Math.round((150 * infV + 215 * holdV + 45 * necV) / w)));
      data[o+1] = Math.max(0, Math.min(255, Math.round((40 * infV + 205 * holdV + 35 * necV) / w)));
      data[o+2] = Math.max(0, Math.min(255, Math.round((45 * infV + 180 * holdV + 50 * necV) / w)));
      data[o+3] = Math.max(0, Math.min(255, Math.round(255 * Math.min(0.90, 0.55 * infV + 0.35 * holdV + 0.85 * necV))));
    }

    this._fieldTex.needsUpdate = true;
  },

  // expose field state for selftest verification
  _getFieldState: function() {
    return {
      inf: this._fieldInf,
      hold: this._fieldHold,
      nec: this._fieldNec,
      tex: this._fieldTex,
      mesh: this._fieldMesh
    };
  }
};
