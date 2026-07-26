(function() {
  var meshes = {}; // id -> {mesh, type}
  var towerIds = new Set();
  var enemyIds = new Set();

  // Hover/ghost state
  var hoverCell = null;
  var ghostCells = [];
  var ghostMeshes = [];
  var ghostInvalid = false;
  var ghostType = 'basic';
  // Range (parallel to ghost — does NOT reuse hoverCell/ghostCells)
  var rangeCell = null;
  var rangeCells = [];
  var rangeMeshes = [];
  // Bolts (replaces lasers)
  var bolts = []; // {mesh, x0,y0,x1,y1, t0, durMs}
  var _impacts = []; // impact rings: {mesh, t0}

  // FX timing constants (SEQ-243)
  var KILL_DUR_MS = 360;
  var HOLD_MAX_MS = 500;
  var IMPACT_LIFE_MS = 200;

  // Path glow — separate overlay meshes (SEQ-172)
  var pathGlowMeshes = [];
  var pathGlowMat = null; // single shared material
  var pathGlowKey = '';   // waypoint signature to rebuild when path changes
  var _edgeMat = null;    // shared edge-cell material (soft pulse)
  var _rangeMat = null;   // shared interior-cell material
  var _hpTrackMat = null; // shared HP track material (SEQ-248)
  var _hpFillMat = null;  // shared HP fill material (SEQ-248)

  // Ghost cache key (P1 — SEQ-312)
  var _ghostKey = null;
  // Shared ghost resources (P2 — SEQ-312)
  var _ghostGeo = null;
  var _ghostMatValid = null;
  var _ghostMatInvalid = null;
  // Aura materials — split centre cell from surrounding cells (SEQ-341)
  var _ghostAuraValid = null;
  var _ghostAuraInvalid = null;

  var reticleMesh = null;
  // P3: cached slow-tint lerp target (SEQ-312)
  var _slowTintTarget = new THREE.Color(0.25, 0.45, 1);
  var _reticleEid = -1;

  var _towerTex = null; // {gun: Texture, slow: Texture}
  function ensureTowerTextures() {
    if (_towerTex) return _towerTex;
    var loader = new THREE.TextureLoader();
    function loadOne(url) {
      var t = loader.load(url);
      if (THREE.SRGBColorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace;
      else t.encoding = THREE.sRGBEncoding;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      return t;
    }
    _towerTex = {
      gun: loadOne('assets/tower_gun.png?v=26'),
      slow: loadOne('assets/tower_slow.png?v=26'),
      antibody: loadOne('assets/tower_antibody.png?v=26'),
      tcell: loadOne('assets/tower_tcell.png?v=26')
    };
    return _towerTex;
  }

  var _enemyTex = null; // {normal, fast}
  function ensureEnemyTextures() {
    if (_enemyTex) return _enemyTex;
    var loader = new THREE.TextureLoader();
    function loadOne(url) {
      var t = loader.load(url);
      if (THREE.SRGBColorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace;
      else t.encoding = THREE.sRGBEncoding;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      return t;
    }
    _enemyTex = {
      normal: loadOne('assets/enemy_normal.png?v=26'),
      fast: loadOne('assets/enemy_fast.png?v=26')
    };
    return _enemyTex;
  }

  // Unit sheet cache (SEQ-281 — visual units with frames)
  var _unitSheets = null;
  function ensureUnitSheets() {
    if (_unitSheets) return _unitSheets;
    var loader = new THREE.TextureLoader();
    function loadOne(url) {
      var t = loader.load(url);
      if (THREE.SRGBColorSpace !== undefined) t.colorSpace = THREE.SRGBColorSpace;
      else t.encoding = THREE.sRGBEncoding;
      t.repeat.x = 0.25;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      return t;
    }
    _unitSheets = {
      pathogen_basic: loadOne('assets/units/u_pathogen_basic_sheet.png'),
      pathogen_boss: loadOne('assets/units/u_pathogen_boss_sheet.png'),
      pathogen_fast: loadOne('assets/units/u_pathogen_fast_sheet.png'),
      pathogen_fungus:   loadOne('assets/units/u_pathogen_fungus_sheet.png'),
      pathogen_parasite: loadOne('assets/units/u_pathogen_parasite_sheet.png'),
      pathogen_cancer:   loadOne('assets/units/u_pathogen_cancer_sheet.png'),
      pathogen_spore:    loadOne('assets/units/u_pathogen_spore_sheet.png'),
      pathogen_toxin:    loadOne('assets/units/u_pathogen_toxin_sheet.png'),
      pathogen_prion:    loadOne('assets/units/u_pathogen_prion_sheet.png'),
      pathogen_biofilm:  loadOne('assets/units/u_pathogen_biofilm_sheet.png'),
      tower_neutrophil: loadOne('assets/units/u_tower_neutrophil_sheet.png'),
      tower_macrophage: loadOne('assets/units/u_tower_macrophage_sheet.png'),
      tower_antibody: loadOne('assets/units/u_tower_antibody_sheet.png'),
      tower_tcell: loadOne('assets/units/u_tower_tcell_sheet.png'),
      tower_fever: loadOne('assets/units/u_tower_fever_sheet.png'),
      tower_nk: loadOne('assets/units/u_tower_nk_sheet.png'),
      tower_cytokine: loadOne('assets/units/u_tower_cytokine_sheet.png')
    };
    return _unitSheets;
  }

  // Frame animation — wall-clock rAF-driven (SEQ-281)
  var _frameOffset = new THREE.Vector2(0, 0);
  function updateUnitFrames() {
    var frame = Math.floor(performance.now() / 300) % 4;
    _frameOffset.x = frame * 0.25;
  }

  // Unit shadow helper (depth disc under towers/enemies)
  function makeUnitShadow() {
    var geo = new THREE.CircleGeometry(Grid.TILE * 0.32, 20);
    var mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0, 0, 0),
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    var m = new THREE.Mesh(geo, mat);
    m.position.z = 0.04;
    m.renderOrder = 7;
    m.name = 'unitShadow';
    return m;
  }

  function clearGhostMeshes() {
    for (var i = 0; i < ghostMeshes.length; i++) {
      var g = ghostMeshes[i];
      Grid.scene.remove(g);
      if (g.geometry) g.geometry.dispose();
      // Do NOT dispose shared mats
      if (g.material && g.material !== _ghostMatValid && g.material !== _ghostMatInvalid && g.material !== _ghostAuraValid && g.material !== _ghostAuraInvalid && g.material.dispose) g.material.dispose();
    }
    ghostCells = [];
    ghostMeshes = [];
    ghostInvalid = false;
    _ghostKey = null; // P1: invalidate cache on clear
  }

  function clearLines() {
    // no-op — bolts are meshes, not lines
  }

  function clearFx() {
    for (var i = bolts.length - 1; i >= 0; i--) {
      var b = bolts[i];
      if (b.mesh) { Grid.scene.remove(b.mesh); if (b.mesh.geometry) b.mesh.geometry.dispose(); }
      if (b.beam) { Grid.scene.remove(b.beam); if (b.beam.geometry) b.beam.geometry.dispose(); if (b.beam.material && b.beam.material.dispose) b.beam.material.dispose(); }
      if (b.glow) { Grid.scene.remove(b.glow); if (b.glow.geometry) b.glow.geometry.dispose(); if (b.glow.material && b.glow.material.dispose) b.glow.material.dispose(); }
    }
    bolts = [];
    for (var fi = _fading.length - 1; fi >= 0; fi--) {
      var fd = _fading[fi];
      if (fd.mesh) Grid.scene.remove(fd.mesh);
      if (fd.hpBar) {
        if (fd.hpBar.track) { Grid.scene.remove(fd.hpBar.track); if (fd.hpBar.track.geometry) fd.hpBar.track.geometry.dispose(); }
        if (fd.hpBar.fill) { Grid.scene.remove(fd.hpBar.fill); if (fd.hpBar.fill.geometry) fd.hpBar.fill.geometry.dispose(); }
      }
    }
    _fading = [];
    for (var ci = _impacts.length - 1; ci >= 0; ci--) {
      var imp = _impacts[ci];
      if (imp.mesh) { Grid.scene.remove(imp.mesh); if (imp.mesh.geometry) imp.mesh.geometry.dispose(); if (imp.mesh.material && imp.mesh.material.dispose) imp.mesh.material.dispose(); }
    }
    _impacts = [];
    _hitFlashTimers = {};
    _hitPunchTimers = {};
    _fireFlashTimers = {};
  }

  function clearPathGlow() {
    for (var i = 0; i < pathGlowMeshes.length; i++) {
      var g = pathGlowMeshes[i];
      Grid.scene.remove(g);
      if (g.geometry) g.geometry.dispose();
    }
    pathGlowMeshes = [];
  }

  function rebuildPathGlow() {
    clearPathGlow();
    if (!Grid.scene || !window.Path) return;
    if (!pathGlowMat) {
      pathGlowMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.10, 0.45, 0.55),
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false
      });
    }
    var geo = new THREE.PlaneGeometry(Grid.TILE * 0.92, Grid.TILE * 0.92);
    var n = Path.WAYPOINTS ? Path.WAYPOINTS.length : 0;
    for (var i = 0; i < n; i++) {
      var cell = Path.cellAt(i);
      if (!cell) continue;
      var wp = worldPos(cell[0], cell[1]);
      var mesh = new THREE.Mesh(geo, pathGlowMat);
      mesh.position.set(wp.x, wp.y, 0.15);
      mesh.name = 'pathGlow_' + cell[0] + '_' + cell[1];
      Grid.scene.add(mesh);
      pathGlowMeshes.push(mesh);
    }
    // signature
    pathGlowKey = n + ':' + (n ? (Path.WAYPOINTS[0]+'|'+Path.WAYPOINTS[n-1]) : '');
  }

  function ensurePathGlow() {
    var n = Path.WAYPOINTS ? Path.WAYPOINTS.length : 0;
    var key = n + ':' + (n ? (Path.WAYPOINTS[0]+'|'+Path.WAYPOINTS[n-1]) : '');
    if (key !== pathGlowKey || pathGlowMeshes.length === 0) rebuildPathGlow();
  }


  function ensureReticle() {
    if (reticleMesh) return;
    var geo = new THREE.RingGeometry(Grid.TILE * 0.35, Grid.TILE * 0.48, 32);
    var mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.95, 1.0), side: THREE.DoubleSide, transparent: true, opacity: 0.7 });
    reticleMesh = new THREE.Mesh(geo, mat);
    reticleMesh.visible = false;
    Grid.scene.add(reticleMesh);
  }

  function updateReticle() {
    if (!reticleMesh) ensureReticle();
    if (!reticleMesh) return;
    var eid = -1;
    var all = Towers.all();
    for (var i = 0; i < all.length; i++) {
      var a = Towers.targetOf(all[i].id);
      if (a >= 0 && Enemies.get(a)) { eid = a; break; }
    }
    if (eid < 0) {
      reticleMesh.visible = false;
      _reticleEid = -1;
      return;
    }
    _reticleEid = eid;
    var vp = Enemies.visualProgress(eid);
    var x, y;
    if (vp) {
      // Use mesh position if available (already laned)
      var em = meshes['e'+eid];
      if (em && em.mesh) {
        x = em.mesh.position.x;
        y = em.mesh.position.y;
      } else {
        var p0 = worldPos(vp.x0, vp.y0), p1 = worldPos(vp.x1, vp.y1);
        x = p0.x + (p1.x - p0.x) * vp.frac;
        y = p0.y + (p1.y - p0.y) * vp.frac;
      }
    } else {
      var e = Enemies.get(eid);
      if (!e) { reticleMesh.visible = false; _reticleEid = -1; return; }
      // Use mesh position if available (already laned)
      var em2 = meshes['e'+eid];
      if (em2 && em2.mesh) {
        x = em2.mesh.position.x;
        y = em2.mesh.position.y;
      } else {
        var wp = worldPos(e.x, e.y);
        x = wp.x; y = wp.y;
      }
    }
    reticleMesh.position.set(x, y, 1.8);
    reticleMesh.visible = true;
    reticleMesh.material.opacity = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(performance.now() * 0.01));
  }

  function rebuildGhost() {
    // P1: cache key — skip rebuild when nothing changed
    if (hoverCell) {
      var key = hoverCell.x + ',' + hoverCell.y + ',' + ghostType + ',' + Towers.count() + ',' + Missions.current();
      if (key === _ghostKey) return;
    }
    clearGhostMeshes();
    if (!hoverCell) { _ghostKey = null; return; }
    var hx = hoverCell.x, hy = hoverCell.y;
    var R = Towers.rangeOf(ghostType);
    ghostInvalid = !Grid.isBuildable(hx, hy);
    // P2: reuse shared geometry
    if (!_ghostGeo) _ghostGeo = new THREE.BoxGeometry(Grid.TILE * 0.9, Grid.TILE * 0.9, 0.2);
    var geo = _ghostGeo;
    // P2: reuse or create shared materials
    if (!ghostInvalid && !_ghostMatValid) {
      _ghostMatValid = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.95, 0.75), transparent: true, opacity: 0.32 });
    }
    if (ghostInvalid && !_ghostMatInvalid) {
      _ghostMatInvalid = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.28, 0.28), transparent: true, opacity: 0.38 });
    }
    // Aura materials — slightly more transparent than centre (SEQ-341)
    if (!ghostInvalid && !_ghostAuraValid) {
      _ghostAuraValid = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.95, 0.75), transparent: true, opacity: 0.18 });
    }
    if (ghostInvalid && !_ghostAuraInvalid) {
      _ghostAuraInvalid = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.28, 0.28), transparent: true, opacity: 0.22 });
    }
    for (var y = 0; y < Grid.H; y++) {
      for (var x = 0; x < Grid.W; x++) {
        if (Math.abs(x - hx) + Math.abs(y - hy) > R) continue;
        ghostCells.push({ x: x, y: y });
        var wp = worldPos(x, y);
        var isCentre = (x === hx && y === hy);
        var mat;
        if (ghostInvalid) {
          mat = isCentre ? _ghostMatInvalid : (_ghostAuraInvalid || _ghostMatInvalid);
        } else {
          mat = isCentre ? _ghostMatValid : (_ghostAuraValid || _ghostMatValid);
        }
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(wp.x, wp.y, 0.38);
        Grid.scene.add(mesh);
        ghostMeshes.push(mesh);
      }
    }
    // P1: set cache key at end
    if (hoverCell) {
      _ghostKey = hoverCell.x + ',' + hoverCell.y + ',' + ghostType + ',' + Towers.count() + ',' + Missions.current();
    } else {
      _ghostKey = null;
    }
  }

  function rebuildLines() {
    // no-op — bolts are meshes, not lines
  }

  function clearRangeMeshes() {
    for (var i = 0; i < rangeMeshes.length; i++) {
      var m = rangeMeshes[i];
      Grid.scene.remove(m);
      if (m.geometry) m.geometry.dispose();
      // Do NOT dispose shared mats
      if (m.material && m.material !== _edgeMat && m.material !== _rangeMat && m.material.dispose) m.material.dispose();
    }
    rangeCells = [];
    rangeMeshes = [];
  }

  function rebuildRange() {
    clearRangeMeshes();
    if (!rangeCell) return;
    var rx = rangeCell.x, ry = rangeCell.y;
    var tid = Towers.at(rx, ry);
    var tw = (tid >= 0) ? Towers.get(tid) : null;
    var R = tw ? Towers.rangeOf(tw.type) : Towers.RANGE;
    for (var y = 0; y < Grid.H; y++) {
      for (var x = 0; x < Grid.W; x++) {
        if (Math.abs(x - rx) + Math.abs(y - ry) > R) continue;
        rangeCells.push({ x: x, y: y });
        var wp = worldPos(x, y);
        var geo = new THREE.BoxGeometry(Grid.TILE * 0.9, Grid.TILE * 0.9, 0.2);
        var dx = Math.abs(x - rx), dy = Math.abs(y - ry);
        var isEdge = (dx + dy === R);
        // Edge cells: brighter color, slightly higher opacity
        if (isEdge) {
          if (!_edgeMat) {
            _edgeMat = new THREE.MeshBasicMaterial({
              color: new THREE.Color(0.40, 0.95, 1),
              transparent: true,
              opacity: 0.30
            });
          }
          var mat = _edgeMat;
        } else {
          // Interior cells: share material (SEQ-188)
          if (!_rangeMat) {
            _rangeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.55, 0.65), transparent: true, opacity: 0.15 });
          }
          var mat = _rangeMat;
        }
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(wp.x, wp.y, 0.35);
        Grid.scene.add(mesh);
        rangeMeshes.push(mesh);
      }
    }
  }

  // tower pop-timer storage (presentation-only)
  var _popTimers = {};

  var IDLE_PULSE = 0.035;   // +/- 3.5% membrane pulse
  var IDLE_DRIFT = 0.5;     // world units; TILE is 32, so ~1.5% of a cell — it must
                             // NEVER visibly leave its square

  function worldPos(x, y) {
    var f = Game.frustum();
    return { x: x * Grid.TILE + f.ox, y: -(y * Grid.TILE) + f.oy };
  }

  // Lane offset helper (SEQ-201 — frozen at mesh create)
  function computeLaneOff(e) {
    var lane = (e && e.visLane != null) ? (e.visLane | 0) : 0;
    if (lane < 0) lane = 0;
    var vp = Enemies.visualProgress(e.id);
    var fdx = 1, fdy = 0;
    if (vp) {
      var a = worldPos(vp.x0, vp.y0), b = worldPos(vp.x1, vp.y1);
      fdx = b.x - a.x; fdy = b.y - a.y;
      var fl = Math.sqrt(fdx*fdx + fdy*fdy);
      if (fl < 1e-6) { fdx = 1; fdy = 0; }
      else { fdx /= fl; fdy /= fl; }
    }
    var px = -fdy, py = fdx;
    var T = Grid.TILE;
    var lat = ((lane % 3) - 1) * 0.55 * T;
    var along = Math.min(lane, 2) * 0.2 * T;
    var dx = px * lat - fdx * along;
    var dy = py * lat - fdy * along;
    // clamp |laneOff| <= 0.7*TILE
    var mag = Math.sqrt(dx*dx + dy*dy);
    var maxM = 0.7 * T;
    if (mag > maxM && mag > 1e-6) {
      dx *= maxM / mag;
      dy *= maxM / mag;
    }
    return { dx: dx, dy: dy, z: 1 + lane * 0.05, lane: lane };
  }

  // Fire flash timer map (towerId -> startTime)
  var _fireFlashTimers = {};
  // Hit scale-punch timer map (enemyId -> startTime)
  var _hitPunchTimers = {};
  // Hit flash timer map (enemyId -> startTime)
  var _hitFlashTimers = {};
  // Death pending timer map (enemyId -> startTime)
  var _deathTimers = {};
  var _fading = []; // {mesh, hpBar, t0, eid}
  var _spawnTimers = {}; // enemyId -> spawn start time (ms)
  // HP bar meshes (enemyId -> mesh)
  var _hpBars = {};

  window.Presentation = {
    sync: function() {
      // Sync towers — ensure mesh per id at cell position
      var allTowers = Towers.all();
      for (var i = 0; i < allTowers.length; i++) {
        var t = allTowers[i];
        towerIds.add(t.id);
        if (!meshes['t'+t.id]) {
          ensureTowerTextures();
          var wp = worldPos(t.x, t.y);
          var isSlow = (t.type === 'slow');
          var geo = new THREE.PlaneGeometry(Grid.TILE * 0.95, Grid.TILE * 0.95);
          // Use unit sheet when available (SEQ-281)
          var tex = _towerTex.gun;
          if (!isSlow) {
            ensureUnitSheets();
            var sheetKey = 'tower_' + t.type;
            if (_unitSheets[sheetKey]) tex = _unitSheets[sheetKey];
          }
          // fever/nk/cytokine fall through to gun tex; baseTint provides color identity
          var mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            color: new THREE.Color(1, 1, 1)
          });
          var mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(wp.x, wp.y, 1.05);
          mesh.renderOrder = 8;
          mesh.frustumCulled = false;
          mesh.userData.isSlow = isSlow;
          var tint = [0.75, 0.95, 1]; // basic
          if (isSlow) tint = [1, 0.85, 0.45];
          else if (t.type === 'antibody') tint = [0.7, 0.85, 1];
          else if (t.type === 'tcell') tint = [0.9, 0.9, 1];
          else if (t.type === 'fever') tint = [1, 0.6, 0.2]; // orange
          else if (t.type === 'nk') tint = [0.95, 0.95, 1]; // white
          else if (t.type === 'cytokine') tint = [0.3, 0.5, 1]; // blue
          mesh.userData.baseTint = tint;
          mat.color.setRGB(mesh.userData.baseTint[0], mesh.userData.baseTint[1], mesh.userData.baseTint[2]);
          _popTimers['t'+t.id] = performance.now();
          Grid.scene.add(mesh);
          meshes['t'+t.id] = { mesh: mesh, type: 'tower', shadow: null };
          var shT = makeUnitShadow();
          shT.position.set(wp.x, wp.y, 0.04);
          Grid.scene.add(shT);
          meshes['t'+t.id].shadow = shT;
        } else {
          var wp2 = worldPos(t.x, t.y);
          meshes['t'+t.id].mesh.position.set(wp2.x, wp2.y, 1);

          // Rung 1 idle life — membrane pulse + slow crawl. Presentation only.
          // Skipped while the placement pop is animating (the pop loop later in
          // sync() owns scale during that window; running both would fight).
          if (!_popTimers['t'+t.id]) {
            var nowIdle = performance.now();
            var phI  = (t.id * 1.37) % 6.283;
            var puls = 1 + IDLE_PULSE * Math.sin(nowIdle / 900 + phI);
            meshes['t'+t.id].mesh.scale.set(puls, puls, puls);
            meshes['t'+t.id].mesh.position.set(
              wp2.x + IDLE_DRIFT * Math.sin(nowIdle / 1700 + phI * 1.7),
              wp2.y + IDLE_DRIFT * Math.cos(nowIdle / 2100 + phI * 2.3),
              1);
          }

          if (meshes['t'+t.id].shadow) {
            meshes['t'+t.id].shadow.position.set(wp2.x, wp2.y, 0.04);
          }
          // Emissive pulse — selected tower (rangeCell match)
          if (rangeCell) {
            var isSel = (t.x === rangeCell.x && t.y === rangeCell.y);
            var mesh3 = meshes['t'+t.id].mesh;
            if (isSel) {
              var a2 = 0.15 + 0.35 * (0.5 + 0.5 * Math.sin(performance.now() * 0.008));
              if (mesh3.material.emissive) {
                mesh3.material.emissive.setRGB(a2 * 0.2, a2, a2 * 0.9);
              } else if (mesh3.material.color) {
                var bt = mesh3.userData.baseTint || [1,1,1];
                mesh3.material.color.setRGB(
                  Math.min(1, bt[0] + a2 * 0.5),
                  Math.min(1, bt[1] + a2 * 0.5),
                  Math.min(1, bt[2] + a2 * 0.35)
                );
              }
            } else {
              if (mesh3.material.emissive) {
                mesh3.material.emissive.setRGB(0, 0.15, 0.2);
              } else if (mesh3.material.color && mesh3.userData.baseTint) {
                var b0 = mesh3.userData.baseTint;
                mesh3.material.color.setRGB(b0[0], b0[1], b0[2]);
              }
            }
          }
        }
      }

      // Sync enemies — lerp mesh position using visualProgress (sub-cell interpolation)
      var allEnemies = Enemies.all();
      for (var j = 0; j < allEnemies.length; j++) {
        var e = allEnemies[j];
        enemyIds.add(e.id);
        if (!meshes['e'+e.id]) {
          ensureEnemyTextures();
          var off = computeLaneOff(e);
          var isFast = (e.type === 'fast');
          var isBoss = (e.type === 'boss');
          var baseColor = new THREE.Color(1, 0.55, 0.35);
          if (isBoss) {
            baseColor = new THREE.Color(1.0, 0.95, 0.95);
          } else if (isFast) baseColor = new THREE.Color(0.85, 0.55, 1);
          else if (e.type === 'fungus') baseColor = new THREE.Color(0.55, 0.45, 0.2);
          else if (e.type === 'parasite') baseColor = new THREE.Color(0.4, 0.7, 0.25);
          else if (e.type === 'cancer') baseColor = new THREE.Color(0.5, 0.05, 0.1);
          var geo2;
          if (isBoss) {
            geo2 = new THREE.PlaneGeometry(Grid.TILE * 2.4, Grid.TILE * 2.4);
          } else {
            geo2 = new THREE.PlaneGeometry(Grid.TILE * 1.15, Grid.TILE * 1.15);
          }
          // Use unit sheets for basic/fast enemies (SEQ-281)
          var texE;
          ensureUnitSheets();
          var _ty = (e && e.type) ? e.type : 'basic';
          texE = _unitSheets['pathogen_' + _ty]
              || (isBoss ? _unitSheets.pathogen_boss : null)
              || (isFast ? (_unitSheets.pathogen_fast || _enemyTex.fast)
                         : (_unitSheets.pathogen_basic || _enemyTex.normal));
          var mat2 = new THREE.MeshBasicMaterial({
            map: texE,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            alphaTest: 0.15,
            color: baseColor
          });
          var mesh2 = new THREE.Mesh(geo2, mat2);
          mesh2.userData.visLane = off.lane;
          mesh2.userData.baseColor = baseColor.getHex();
          mesh2.userData.isFast = isFast;
          mesh2.renderOrder = isBoss ? 10 : 9;
          mesh2.frustumCulled = false;
          // freeze lane offset in world space at create
          var vp0 = Enemies.visualProgress(e.id);
          var bx, by;
          if (vp0) {
            var p0 = worldPos(vp0.x0, vp0.y0), p1 = worldPos(vp0.x1, vp0.y1);
            bx = p0.x + (p1.x - p0.x) * vp0.frac;
            by = p0.y + (p1.y - p0.y) * vp0.frac;
          } else { var w3 = worldPos(e.x, e.y); bx = w3.x; by = w3.y; }
          mesh2.position.set(bx + off.dx, by + off.dy, off.z);
          mesh2.userData.laneOff = { dx: off.dx, dy: off.dy, z: off.z };
          mesh2.scale.set(0.2, 0.2, 0.2);
          _spawnTimers[e.id] = performance.now();
          Grid.scene.add(mesh2);
          meshes['e'+e.id] = { mesh: mesh2, type: 'enemy', hpBar: null };
          var shE = makeUnitShadow();
          shE.scale.set(0.85, 0.85, 1);
          shE.position.set(mesh2.position.x, mesh2.position.y, 0.04);
          Grid.scene.add(shE);
          meshes['e'+e.id].shadow = shE;
        } else {
          // UPDATE — use stored laneOff (no per-frame recomputation)
          var vp = Enemies.visualProgress(e.id);
          var lx, ly;
          if (vp) {
            var wp1 = worldPos(vp.x0, vp.y0), wp2 = worldPos(vp.x1, vp.y1);
            lx = wp1.x + (wp2.x - wp1.x) * vp.frac;
            ly = wp1.y + (wp2.y - wp1.y) * vp.frac;
          } else {
            var w4 = worldPos(e.x, e.y); lx = w4.x; ly = w4.y;
          }
          var lo = meshes['e'+e.id].mesh.userData.laneOff;
          if (!lo) { /* legacy: compute once and store */
            var c = computeLaneOff(e);
            lo = { dx: c.dx, dy: c.dy, z: c.z };
            meshes['e'+e.id].mesh.userData.laneOff = lo;
            meshes['e'+e.id].mesh.userData.visLane = c.lane;
          }
          meshes['e'+e.id].mesh.position.set(lx + lo.dx, ly + lo.dy, lo.z);
          if (meshes['e'+e.id].shadow) {
            meshes['e'+e.id].shadow.position.set(lx + lo.dx, ly + lo.dy, 0.04);
          }
          meshes['e'+e.id].mesh.userData.visLane = lo.lane != null ? lo.lane : (meshes['e'+e.id].mesh.userData.visLane || 0);
        }
      }

      // Remove stale tower meshes (id not in all())
      var towerKeys = [];
      for (var k in meshes) { if (meshes[k].type === 'tower') towerKeys.push(k); }
      for (var m = 0; m < towerKeys.length; m++) {
        var tkey = towerKeys[m];
        var tid = Number(tkey.slice(1));
        if (!towerIds.has(tid)) {
          var tm = meshes[tkey].mesh;
          Grid.scene.remove(tm);
          if (tm.geometry) tm.geometry.dispose();
          if (tm.material && tm.material.dispose) tm.material.dispose();
          if (meshes[tkey].shadow) { Grid.scene.remove(meshes[tkey].shadow); meshes[tkey].shadow = null; }
          delete meshes[tkey];
        }
      }

      // Remove stale enemy meshes — push to fading with white pop (SEQ-203)
      var now2 = performance.now();
      var enemyKeys = [];
      for (var n in meshes) { if (meshes[n].type === 'enemy') enemyKeys.push(n); }
      for (var p = 0; p < enemyKeys.length; p++) {
        var ekey = enemyKeys[p];
        var eid = Number(ekey.slice(1));
        if (!enemyIds.has(eid) && meshes[ekey]) {
          _fading.push({ mesh: meshes[ekey].mesh, hpBar: meshes[ekey].hpBar||null, shadow: meshes[ekey].shadow, t0: now2, holdT0: now2, eid: eid, kill: true, holdBolts: true });
          var km = meshes[ekey].mesh;
          if (km) {
            if (km.userData.baseColor==null && km.material&&km.material.color) km.userData.baseColor=km.material.color.getHex();
            if (km.material){
              km.material.transparent=true;
              km.material.opacity=1;
              km.material.color.setRGB(1, 0.5, 0.9);
              if (km.material.emissive) km.material.emissive.setRGB(0.5, 0.15, 0.4);
            }
            km.scale.set(1.25, 1.25, 1.25);
          }
          delete meshes[ekey];
          if (meshes[ekey] && meshes[ekey].shadow) { Grid.scene.remove(meshes[ekey].shadow); }
          delete _deathTimers[eid];
        }
      }
      // Animate / finish fading list (SEQ-203: white pop 80ms, shrink+opacity out, remove at 320ms)
      for (var fi = _fading.length - 1; fi >= 0; fi--) {
        var fd = _fading[fi];
        if (!fd.mesh) { _fading.splice(fi,1); continue; }

        // HOLD until all bolts for this eid land, max 350ms from holdT0 (SEQ-211)
        if (fd.holdBolts) {
          var hasBolt = false;
          for (var biH = 0; biH < bolts.length; biH++) {
            if (bolts[biH].enemyId === fd.eid) { hasBolt = true; break; }
          }
          var holdAge = now2 - (fd.holdT0 != null ? fd.holdT0 : fd.t0);
          // Hold full 500ms only while a bolt for this eid still flies; no-bolt death flash ≤200ms
          if ((hasBolt && holdAge < HOLD_MAX_MS) || (!hasBolt && holdAge < IMPACT_LIFE_MS)) {
            fd.mesh.scale.set(1.25, 1.25, 1.25);
            if (fd.mesh.material) {
              fd.mesh.material.transparent = true;
              fd.mesh.material.opacity = 1;
              fd.mesh.material.color.setRGB(1, 0.5, 0.9);
              if (fd.mesh.material.emissive) fd.mesh.material.emissive.setRGB(0.5, 0.15, 0.4);
            }
            continue;
          }
          // release hold — death pop clock starts NOW (impact)
          fd.holdBolts = false;
          fd.t0 = now2;
        }

        var elF = now2 - fd.t0;
        // Unconditional remove at 320ms after pop start (not sticky)
        if (elF >= 320) {
          if(fd.hpBar){ if(fd.hpBar.track){ Grid.scene.remove(fd.hpBar.track); if(fd.hpBar.track.geometry)fd.hpBar.track.geometry.dispose(); } if(fd.hpBar.fill){ Grid.scene.remove(fd.hpBar.fill); if(fd.hpBar.fill.geometry)fd.hpBar.fill.geometry.dispose(); } }
          if (fd.mesh) Grid.scene.remove(fd.mesh);
          if (fd.shadow) { Grid.scene.remove(fd.shadow); fd.shadow = null; }
          delete _hitFlashTimers[fd.eid]; delete _hitPunchTimers[fd.eid];
          for (var bi2=bolts.length-1;bi2>=0;bi2--) if(bolts[bi2].enemyId===fd.eid){
            var bb=bolts[bi2];
            if(bb.mesh){ Grid.scene.remove(bb.mesh); if(bb.mesh.geometry)bb.mesh.geometry.dispose(); }
            if(bb.beam){ Grid.scene.remove(bb.beam); if(bb.beam.geometry)bb.beam.geometry.dispose(); if(bb.beam.material && bb.beam.material.dispose)bb.beam.material.dispose(); }
            if(bb.glow){ Grid.scene.remove(bb.glow); if(bb.glow.geometry)bb.glow.geometry.dispose(); if(bb.glow.material && bb.glow.material.dispose)bb.glow.material.dispose(); }
            bolts.splice(bi2,1); }
          _fading.splice(fi,1);
          continue;
        }
        if (elF < 80) {
          var sc = 1.25 + 0.20 * (elF / 80); fd.mesh.scale.set(sc,sc,sc);
          if(fd.mesh.material){ fd.mesh.material.transparent=true; fd.mesh.material.opacity=1; fd.mesh.material.color.setHex(0xffffff); }
        } else {
          var tOut = Math.min(1,Math.max(0,(elF-80)/240));
          var sc = Math.max(0.01, 1.45*(1-tOut)); fd.mesh.scale.set(sc,sc,sc);
          if(fd.mesh.material){ fd.mesh.material.transparent=true; fd.mesh.material.opacity=1-tOut; fd.mesh.material.color.setHex(0xffffff); }
        }
      }

      // Target lock glow (SEQ-205)
      var locked = {};
      var tall = Towers.all();
      for (var ti = 0; ti < tall.length; ti++) {
        var tg = Towers.targetOf(tall[ti].id);
        if (tg >= 0) locked[tg] = true;
      }
      for (var k in meshes) {
        if (meshes[k].type !== 'enemy') continue;
        var eidL = Number(k.slice(1));
        var meshL = meshes[k].mesh;
        if (!meshL || !meshL.material || !meshL.material.emissive) continue;
        if (locked[eidL]) {
          var pulse = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(performance.now() * 0.012));
          meshL.material.emissive.setRGB(0.1 * pulse, pulse, pulse);
        } else {
          meshL.material.emissive.setRGB(0, 0, 0);
        }
      }

      // Clear sets for next full-sync
      towerIds.clear();
      enemyIds.clear();

      // HP bar sync — show/hide/update bars on damaged enemies
      var now = performance.now();
      for (var j2 = 0; j2 < allEnemies.length; j2++) {
        var e2 = allEnemies[j2];
        var maxHp = (e2.type === 'fast') ? (Enemies.FAST_HP || 6) : ((e2.type === 'boss') ? (Enemies.BOSS_HP || 100) : (Enemies.DEFAULT_HP || 10));
        var _MAXHP = { fast: Enemies.FAST_HP, boss: Enemies.BOSS_HP, fungus: Enemies.FUNGUS_HP,
                       parasite: Enemies.PARASITE_HP, cancer: Enemies.CANCER_HP, spore: Enemies.SPORE_HP,
                       toxin: Enemies.TOXIN_HP, prion: Enemies.PRION_HP, biofilm: Enemies.BIOFILM_HP };
        maxHp = _MAXHP[e2.type] || Enemies.DEFAULT_HP || 10;
        var ratio = e2.hp / maxHp;
        var barKey = 'e'+e2.id;
        if (!meshes[barKey]) continue;
        if (ratio >= 1) {
          // Full HP — hide/remove bar
          if (meshes[barKey].hpBar) {
            Grid.scene.remove(meshes[barKey].hpBar);
            meshes[barKey].hpBar = null;
          }
        } else {
          // Damaged — ensure bar exists and update scale
          if (!meshes[barKey].hpBar) {
            var bw = Grid.TILE * 0.9;
            var bh = Grid.TILE * 0.15;
            // Shared module-wide materials (SEQ-248)
            if (!_hpTrackMat) _hpTrackMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), transparent: false, opacity: 0.6 });
            
            var trackMesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.08), _hpTrackMat);
            var barOffY = Grid.TILE * 0.45 * (e2.type === 'boss' ? 2.0 : 1.0);
            trackMesh.position.set(0, barOffY, 0.28);
            trackMesh.material.depthTest = true;
            trackMesh.renderOrder = 998;
            // Shared fill material (SEQ-248)
            if (!_hpFillMat) _hpFillMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.3, 0.1), transparent: true });
            
            var fillMesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.08), _hpFillMat);
            fillMesh.position.set(-(1 - ratio) * (bw / 2), barOffY, 0.3);
            fillMesh.material.depthTest = true;
            fillMesh.renderOrder = 999;
            meshes[barKey].hpBar = { track: trackMesh, fill: fillMesh };
            meshes[barKey].mesh.add(trackMesh);
            meshes[barKey].mesh.add(fillMesh);
          } else {
            // Update existing bar scale
            var barW = Grid.TILE * 0.9;
            meshes[barKey].hpBar.fill.scale.x = Math.max(0.01, ratio);
            meshes[barKey].hpBar.fill.position.x = -(1 - ratio) * (barW / 2);
          }
        }
      }

      // Apply pop-timer animation to new towers (presentation-only)
      var now = performance.now();
      for (var k in _popTimers) {
        var elapsed = now - _popTimers[k];
        if (elapsed < IMPACT_LIFE_MS) {
          var tkey = k;
          if (meshes[tkey] && meshes[tkey].type === 'tower') {
            var s = 0.6 + 0.4 * Math.min(elapsed / IMPACT_LIFE_MS, 1);
            meshes[tkey].mesh.scale.set(s, s, s);
          }
        } else {
          // done animating — reset scale to identity
          if (meshes[k] && meshes[k].type === 'tower') {
            meshes[k].mesh.scale.set(1, 1, 1);
          }
          delete _popTimers[k];
        }
      }

      rebuildGhost();
      rebuildLines();

      // Path glow — ensure + animate shared opacity (SEQ-172)
      ensurePathGlow();
      if (pathGlowMat) {
        var pulse = 0.22 + 0.10 * Math.sin(performance.now() * 0.004);
        pathGlowMat.color.setRGB(0.10, 0.45, 0.55).lerp(new THREE.Color(0.30, 0.85, 1.0), pulse);
        pathGlowMat.opacity = 0.06 + 0.08 * pulse;
      }
      // Soft pulse on edge cells
      if (_edgeMat) {
        _edgeMat.opacity = 0.50 + 0.12 * Math.sin(performance.now() * 0.006);
      }

      // Bolt sync — advance each bolt every frame (determinism fold)
      var now = performance.now();
      for (var bi = bolts.length - 1; bi >= 0; bi--) {
        var b = bolts[bi];
        // death mid-flight → home to fading mesh when dead (SEQ-203)
        if (b.enemyId != null) {
          var live = Enemies.get(b.enemyId);
          if (live) {
            var em = meshes['e' + b.enemyId];
            if (em && em.mesh){ b.x1=em.mesh.position.x; b.y1=em.mesh.position.y; }
          } else {
            var fadM=null;
            for(var fbi=0;fbi<_fading.length;fbi++) if(_fading[fbi].eid===b.enemyId&&_fading[fbi].mesh){ fadM=_fading[fbi].mesh; break; }
            if(fadM){ b.x1=fadM.position.x; b.y1=fadM.position.y; }
            else { Grid.scene.remove(b.mesh); if (b.mesh.geometry) b.mesh.geometry.dispose(); if (b.beam) { Grid.scene.remove(b.beam); if (b.beam.geometry) b.beam.geometry.dispose(); if (b.beam.material && b.beam.material.dispose) b.beam.material.dispose(); b.beam = null; }
            if (b.glow) { Grid.scene.remove(b.glow); if (b.glow.geometry) b.glow.geometry.dispose(); if (b.glow.material && b.glow.material.dispose) b.glow.material.dispose(); b.glow = null; } bolts.splice(bi,1); continue; }
          }
        }
        var u = (now - b.t0) / b.durMs;
        if (u >= 1) {
          // SEQ-211: release hold on same frame when u>=1
          if ((b.willKill || b.enemyId != null)) {
            for (var fiR = 0; fiR < _fading.length; fiR++) {
              if (_fading[fiR].eid === b.enemyId && _fading[fiR].holdBolts) {
                _fading[fiR].holdBolts = false;
                _fading[fiR].t0 = now;
              }
            }
          }
          // Impact rings for kill bolts
          if (b.willKill && b.isLaser) {
            var ring1 = new THREE.Mesh(
              new THREE.BoxGeometry(Grid.TILE * 1.6, Grid.TILE * 1.6, 0.3),
              new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.95, 1.0), depthTest: false, depthWrite: false, transparent: true, opacity: 0.7 })
            );
            ring1.position.set(b.x1, b.y1, 3.0);
            ring1.renderOrder = 1004;
            ring1.frustumCulled = false;
            Grid.scene.add(ring1);
            ring1.updateMatrixWorld(true);
            _impacts.push({ mesh: ring1, t0: now });
            var ring2 = new THREE.Mesh(
              new THREE.BoxGeometry(Grid.TILE * 0.9, Grid.TILE * 0.9, 0.3),
              new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.2), depthTest: false, depthWrite: false, transparent: true, opacity: 0.8 })
            );
            ring2.position.set(b.x1, b.y1, 3.05);
            ring2.renderOrder = 1005;
            ring2.frustumCulled = false;
            Grid.scene.add(ring2);
            ring2.updateMatrixWorld(true);
            _impacts.push({ mesh: ring2, t0: now });
          }
          Grid.scene.remove(b.mesh); if (b.mesh.geometry) b.mesh.geometry.dispose();
          if (b.beam) { Grid.scene.remove(b.beam); if (b.beam.geometry) b.beam.geometry.dispose(); if (b.beam.material && b.beam.material.dispose) b.beam.material.dispose(); b.beam = null; }
          if (b.glow) { Grid.scene.remove(b.glow); if (b.glow.geometry) b.glow.geometry.dispose(); if (b.glow.material && b.glow.material.dispose) b.glow.material.dispose(); b.glow = null; }
          // Remove mark on kill completion
          if (b.mark) {
            if (b.mark.parent) b.mark.parent.remove(b.mark);
            else Grid.scene.remove(b.mark);
            b.mark = null;
          }
          bolts.splice(bi, 1);
        } else {
          if (u < 0) u = 0;
          if (u > 1) u = 1;
          var px = b.x0 + (b.x1 - b.x0) * u;
          var py = b.y0 + (b.y1 - b.y0) * u;
          b.mesh.position.set(px, py, b.willKill ? 3.1 : 2.6);
          var dx = b.x1 - b.x0, dy = b.y1 - b.y0;
          var dlen = Math.hypot(dx, dy) || 1;
          var ang2 = Math.atan2(dy, dx);
          var midX = (b.x0 + b.x1) / 2, midY = (b.y0 + b.y1) / 2;
          if (b.beam) {
            var thC = Grid.TILE * (b.willKill ? 0.18 : 0.14);
            b.beam.position.set(midX, midY, b.willKill ? 2.95 : 2.45);
            b.beam.rotation.z = ang2;
            b.beam.scale.set(dlen, thC, thC);
            b.beam.visible = true;
          }
          if (b.glow) {
            var thG = Grid.TILE * (b.willKill ? 0.48 : 0.36);
            var pulse = 0.38 + 0.12 * Math.sin(now * 0.04);
            if (b.glow.material) b.glow.material.opacity = pulse;
            b.glow.position.set(midX, midY, b.willKill ? 2.85 : 2.35);
            b.glow.rotation.z = ang2;
            b.glow.scale.set(dlen, thG, thG);
            b.glow.visible = true;
          }
          var tipS = Grid.TILE * (b.willKill ? 0.55 : 0.4);
          b.mesh.scale.set(1.15, 0.7, 0.7);
          b.mesh.rotation.z = ang2;
        }
      }

      // Process impact rings (SEQ-217)
      for (var ii = _impacts.length - 1; ii >= 0; ii--) {
        var imp = _impacts[ii];
        var ie = now - imp.t0;
        if (ie >= IMPACT_LIFE_MS || !imp.mesh) {
          if (imp.mesh) { Grid.scene.remove(imp.mesh); if (imp.mesh.geometry) imp.mesh.geometry.dispose(); if (imp.mesh.material && imp.mesh.material.dispose) imp.mesh.material.dispose(); }
          _impacts.splice(ii, 1);
        } else if (imp.mesh.material) {
          imp.mesh.material.opacity = 1 - ie / IMPACT_LIFE_MS;
          var sc = 1 + ie / IMPACT_LIFE_MS;
          imp.mesh.scale.set(sc, sc, 1);
        }
      }

      // Apply pop-timer animation to new towers (presentation-only)
      for (var k in _popTimers) {
        var elapsed = now - _popTimers[k];
        if (elapsed < 200) {
          var tkey = k;
          if (meshes[tkey] && meshes[tkey].type === 'tower') {
            var s = 0.6 + 0.4 * Math.min(elapsed / 200, 1);
            meshes[tkey].mesh.scale.set(s, s, s);
          }
        } else {
          // done animating — reset scale to identity
          if (meshes[k] && meshes[k].type === 'tower') {
            meshes[k].mesh.scale.set(1, 1, 1);
          }
          delete _popTimers[k];
        }
      }

      // Apply fire flash timers (presentation-only)
      for (var k in _fireFlashTimers) {
        var elapsed = now - _fireFlashTimers[k];
        if (!meshes[k] || !meshes[k].mesh) { delete _fireFlashTimers[k]; continue; }
        if (elapsed < 100) {
          meshes[k].mesh.scale.set(1.15, 1.15, 1.15);
        } else {
          meshes[k].mesh.scale.set(1, 1, 1);
          delete _fireFlashTimers[k];
        }
      }

      // Unified scale spawn*punch for all living enemy meshes (every frame)
      var now3 = performance.now();
      for (var k in meshes) {
        if (meshes[k].type !== 'enemy') continue;
        var eid = Number(k.slice(1));
        var fad=false;
        for (var fi=0;fi<_fading.length;fi++) { if(_fading[fi].eid===eid){fad=true;break;} }
        if (fad) continue;
        var spawnF=1;
        if (_spawnTimers[eid]!=null) {
          var se=now3-_spawnTimers[eid];
          if (se<200) { spawnF=0.2+0.8*(se/200); }
          else { spawnF=1; delete _spawnTimers[eid]; }
        }
        var punchF=1;
        if (_hitPunchTimers[eid]!=null) {
          var pe=now3-_hitPunchTimers[eid];
          if (pe<120) { punchF=1.25-0.25*Math.min(pe/120,1); }
          else { delete _hitPunchTimers[eid]; }
        }
        var sc=spawnF*punchF;
        meshes[k].mesh.scale.set(sc,sc,sc);
      }

      // Apply hit flash timers (presentation-only)
      for (var k in _hitFlashTimers) {
        var elapsed = now - _hitFlashTimers[k];
        if (elapsed < 150 && meshes['e'+k]) {
          meshes['e'+k].mesh.material.color.setHex(0xffffff);
        } else {
          if (meshes['e'+k] && meshes['e'+k].mesh.userData.baseColor != null) {
            meshes['e'+k].mesh.material.color.setHex(meshes['e'+k].mesh.userData.baseColor);
          }
          delete _hitFlashTimers[k];
        }
      }

      // Slow tint — separate loop after hit flash block (every frame)
      for (var k in meshes) {
        if (meshes[k].type !== 'enemy') continue;
        var eid2=Number(k.slice(1));
        if (_hitFlashTimers[eid2] && (now-_hitFlashTimers[eid2])<150) continue;
        var en=Enemies.get(eid2);
        var mesh=meshes[k].mesh;
        var baseHex=mesh.userData.baseColor;
        if (baseHex==null) continue;
        if (en && en.slowTicks>0) {
          var c=new THREE.Color(baseHex);
          c.lerp(_slowTintTarget, 0.45);
          mesh.material.color.copy(c);
        } else {
          mesh.material.color.setHex(baseHex);
        }
      }

      // F3 juice: z-bob enemies every frame (presentation-only)
      for (var k in meshes) {
        if (meshes[k].type === 'enemy') {
          var lo = meshes[k].mesh.userData.laneOff;
          var baseZ = lo ? lo.z : (1 + (meshes[k].mesh.userData.visLane || 0) * 0.05);
          meshes[k].mesh.position.z = baseZ + 0.05 * Math.sin(now * 0.008 + Number(k.slice(1)));
        }
      }
      // Frame animation — wall-clock rAF-driven (SEQ-281)
      updateUnitFrames();
      // Apply frame offset to animated materials
      for (var k in meshes) {
        var mesh = meshes[k].mesh;
        if (!mesh || !mesh.material || !mesh.material.map) continue;
        var map = mesh.material.map;
        if (map && _unitSheets) {
          // Only apply offset to unit sheets (repeat.x === 0.25)
          if (map.repeat && map.repeat.x === 0.25) {
            map.offset.copy(_frameOffset);
          }
        }
      }
      updateReticle();
    },

    towerCount: function() {
      var count = 0;
      for (var k in meshes) { if (meshes[k].type === 'tower') count++; }
      return count;
    },

    enemyCount: function() {
      var count = 0;
      for (var k in meshes) { if (meshes[k].type === 'enemy') count++; }
      return count;
    },

    towerCell: function(id) {
      // Read from Towers data, not mesh position — mid-cell lerp doesn't affect sim cell
      var t = Towers.get(id);
      if (!t) return null;
      return { x: t.x, y: t.y };
    },

    enemyCell: function(id) {
      // Read from Enemies data, not mesh position — mid-cell lerp doesn't affect sim cell
      var e = Enemies.get(id);
      if (!e) return null;
      return { x: e.x, y: e.y };
    },

    enemyMeshXY: function(id) {
      var m = meshes['e'+id];
      if (!m || !m.mesh) return null;
      return { x: m.mesh.position.x, y: m.mesh.position.y };
    },

    setHoverCell: function(x, y) {
      if (x == null || y == null || x < 0 || y < 0 || x >= Grid.W || y >= Grid.H) {
        hoverCell = null;
        return;
      }
      hoverCell = { x: x, y: y };
    },

    ghostCellCount: function() {
      return ghostCells.length;
    },

    ghostIncludes: function(x, y) {
      for (var i = 0; i < ghostCells.length; i++) {
        if (ghostCells[i].x === x && ghostCells[i].y === y) return true;
      }
      return false;
    },

    ghostTintInvalid: function() {
      return ghostInvalid;
    },

    setSelectedRangeCell: function(x, y) {
      if (x == null || y == null || x < 0 || y < 0 || x >= Grid.W || y >= Grid.H) {
        rangeCell = null;
        rebuildRange();
        return;
      }
      rangeCell = { x: x, y: y };
      rebuildRange();
    },

    rangeCellCount: function() {
      return rangeCells.length;
    },

    rangeIncludes: function(x, y) {
      for (var i = 0; i < rangeCells.length; i++) {
        if (rangeCells[i].x === x && rangeCells[i].y === y) return true;
      }
      return false;
    },

    lineCount: function() {
      return 0; // no lines — bolts are meshes
    },

    lineEndpoints: function(towerId) {
      return null; // no lines drawn
    },

    notifyFire: function(towerId, enemyId, opts) {
      var t = Towers.get(towerId);
      if (!t) return;
      var e = Enemies.get(enemyId);
      if (!e) return;
      var tvp = Enemies.visualProgress(enemyId);
      var tx, ty, ex, ey;
      if (tvp) {
        var twp1 = worldPos(t.x, t.y);
        tx = twp1.x; ty = twp1.y;
        // Use mesh position for bolt end point when available (already laned)
        var em = meshes['e'+enemyId];
        if (em && em.mesh) {
          ex = em.mesh.position.x;
          ey = em.mesh.position.y;
        } else {
          var ewp1 = worldPos(e.x, e.y);
          var ewp2 = worldPos(tvp.x1, tvp.y1);
          ex = ewp1.x + (ewp2.x - ewp1.x) * tvp.frac;
          ey = ewp1.y + (ewp2.y - ewp1.y) * tvp.frac;
        }
      } else {
        var twp = worldPos(t.x, t.y);
        tx = twp.x; ty = twp.y;
        // Use mesh position for bolt end point when available (already laned)
        var em2 = meshes['e'+enemyId];
        if (em2 && em2.mesh) {
          ex = em2.mesh.position.x;
          ey = em2.mesh.position.y;
        } else {
          var ewp = worldPos(e.x, e.y);
          ex = ewp.x; ey = ewp.y;
        }
      }
      var willKill = !!(opts && opts.willKill);
      var durMs = willKill ? KILL_DUR_MS : 220;
      var tipSize = Grid.TILE * (willKill ? 0.55 : 0.4);
      var tipCol = willKill ? new THREE.Color(0.45, 0.98, 1.0) : new THREE.Color(1.0, 0.55, 0.2);
      var mat = new THREE.MeshBasicMaterial({
        color: tipCol, depthTest: false, depthWrite: false, transparent: false, opacity: 1
      });
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(tipSize, tipSize, tipSize), mat);
      var sx = tx, sy = ty;
      mesh.position.set(sx, sy, willKill ? 3.1 : 2.6);
      mesh.renderOrder = willKill ? 1003 : 1002;
      mesh.frustumCulled = false;
      Grid.scene.add(mesh);
      mesh.updateMatrixWorld(true);
      // fire flash on tower
      _fireFlashTimers['t'+towerId] = performance.now();
      // hit punch on enemy
      if (willKill && meshes['e'+enemyId] && meshes['e'+enemyId].mesh) {
        var km2 = meshes['e'+enemyId].mesh;
        if (km2.userData.baseColor == null && km2.material && km2.material.color)
          km2.userData.baseColor = km2.material.color.getHex();
        // NO scale swell on fire — swell is impact-only (iPhone cover fix)
        if (km2.material) {
          km2.material.color.setRGB(1, 0.45, 0.85);
          if (km2.material.emissive) km2.material.emissive.setRGB(0.6, 0.15, 0.5);
        }
      }
      // hit punch on enemy
      if (!willKill) {
        _hitPunchTimers[enemyId] = performance.now();
      }
      // hit flash on enemy mesh
      if (meshes['e'+enemyId]) {
        var mat3 = meshes['e'+enemyId].mesh.material;
        if (!meshes['e'+enemyId].mesh.userData.baseColor) {
          meshes['e'+enemyId].mesh.userData.baseColor = mat3.color.getHex();
        }
      }
      if (!willKill) {
        _hitFlashTimers[enemyId] = performance.now();
      }
      // bolt includes enemyId for stale removal
      var dxB = ex - sx, dyB = ey - sy;
      var dlenB = Math.hypot(dxB, dyB) || 1;
      var ang = Math.atan2(dyB, dxB);
      function makeSeg(col, thick, z, ro, opac) {
        var m = new THREE.MeshBasicMaterial({
          color: col, depthTest: false, depthWrite: false,
          transparent: opac < 1, opacity: opac
        });
        var seg = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), m);
        seg.position.set((sx + ex) / 2, (sy + ey) / 2, z);
        seg.rotation.z = ang;
        seg.scale.set(dlenB, thick, thick);
        seg.renderOrder = ro;
        seg.frustumCulled = false;
        Grid.scene.add(seg);
        seg.updateMatrixWorld(true);
        return seg;
      }
      var coreCol = willKill ? new THREE.Color(1, 1, 0.92) : new THREE.Color(0.55, 1, 1);
      var glowCol = willKill ? new THREE.Color(1, 0.55, 0.05) : new THREE.Color(0.1, 0.75, 1);
      var beam = makeSeg(coreCol, Grid.TILE * (willKill ? 0.18 : 0.14), willKill ? 2.95 : 2.45, willKill ? 1001 : 1000, 1);
      var glow = makeSeg(glowCol, Grid.TILE * (willKill ? 0.48 : 0.36), willKill ? 2.85 : 2.35, willKill ? 999 : 998, 0.42);
      bolts.push({
        mesh: mesh, beam: beam, glow: glow, mark: null,
        x0: sx, y0: sy, x1: ex, y1: ey,
        t0: performance.now(), durMs: durMs, enemyId: enemyId,
        willKill: willKill, isLaser: true
      });
    },

    boltCount: function() { return bolts.length; },

    idleBounds: function() { return { pulse: IDLE_PULSE, drift: IDLE_DRIFT }; },

    // Finish any running placement-pop immediately. The pop animates scale 0.6 -> 1.0
    // over IMPACT_LIFE_MS and OWNS scale while it runs, so idle life is skipped during
    // it. A selftest that places a cell and asserts idle bounds in the same turn would
    // otherwise be reading a pop frame (0.6), not the idle pulse.
    settlePops: function() {
      for (var pk in _popTimers) {
        if (meshes[pk] && meshes[pk].mesh) meshes[pk].mesh.scale.set(1, 1, 1);
        delete _popTimers[pk];
      }
    },

    boltEndXY: function(i) {
      if (!bolts[i]) return null;
      return { x: bolts[i].x1, y: bolts[i].y1 };
    },

    hpBarRatio: function(id) {
      var e = Enemies.get(id);
      if (!e) return null;
      var maxHp = (e.type === 'fast') ? (Enemies.FAST_HP || 6) : (Enemies.DEFAULT_HP || 10);
      var ratio = e.hp / maxHp;
      // Return 1 (no bar visible) when full, or the ratio when damaged
      return ratio >= 1 ? 1 : ratio;
    },

    hitFlashActive: function(id){ return !!_hitFlashTimers[id] && (performance.now()-_hitFlashTimers[id])<150; },

    deathPendingCount: function(){ return _fading.length; },

    impactCount: function() { return _impacts.length; },

    fxConstants: function() {
      return { killDurMs: KILL_DUR_MS, holdMaxMs: HOLD_MAX_MS, impactLifeMs: IMPACT_LIFE_MS };
    },

    fadingCount: function(){ return _fading.length; },

    fadingScale:function(id){ for(var i=0;i<_fading.length;i++) if(_fading[i].eid===id&&_fading[i].mesh) return _fading[i].mesh.scale.x; return null; },
    fadingOpacity:function(id){ for(var i=0;i<_fading.length;i++) if(_fading[i].eid===id&&_fading[i].mesh&&_fading[i].mesh.material) return _fading[i].mesh.material.opacity; return null; },

    hpBarAboveEnemy: function(id) {
      var key = 'e'+id;
      if (!meshes[key]) return false;
      var bar = meshes[key].hpBar;
      if (!bar) return false;
      // Handle new object shape {track, fill}
      var barMesh = bar.fill || bar;
      var barWP = new THREE.Vector3();
      barMesh.getWorldPosition(barWP);
      var enemyWP = new THREE.Vector3();
      meshes[key].mesh.getWorldPosition(enemyWP);
      // Bar world Y must be above (greater than) enemy mesh world Y
      return barWP.y > enemyWP.y;
    },

    // Enemy scale accessor — reads current mesh scale.x
    enemyScale: function(id) {
      var key = 'e'+id;
      if (!meshes[key]) return 1;
      return meshes[key].mesh.scale.x;
    },

    // Age a spawn timer — returns ms since spawn (0 for never-spawned)
    ageSpawn: function(id, ms) {
      if (_spawnTimers[id] != null || meshes['e'+id]) {
        _spawnTimers[id] = performance.now() - (ms || 0);
      }
    },

    // Read baseColor of an enemy mesh (hex int)
    enemyBaseColor: function(id) {
      var key = 'e'+id;
      if (!meshes[key]) return null;
      return meshes[key].mesh.userData.baseColor || null;
    },

    // Current color hex of an enemy mesh
    enemyColorHex: function(id) {
      var key = 'e'+id;
      if (!meshes[key]) return null;
      return meshes[key].mesh.material.color.getHex();
    },

    fadingColorHex: function(id) {
      for (var i = 0; i < _fading.length; i++)
        if (_fading[i].eid === id && _fading[i].mesh && _fading[i].mesh.material)
          return _fading[i].mesh.material.color.getHex();
      return null;
    },

reticleVisible: function() { return !!(reticleMesh && reticleMesh.visible); },
    reticleEnemyId: function() { return _reticleEid; },

    clearFx: clearFx,

    setGhostType: function(t) { ghostType = (t == null) ? 'basic' : t; },

  };
})();
