var ORGAN_BY_MISSION = { 0:'stomach', 1:'heart', 2:'kidney', 3:'brain' };
window.Grid = {
  W: 16,
  H: 9,
  TILE: 32,
  scene: null,
  _types: null, // flat array length W*H
  _special: null, // flat array length W*H — 'patch' | 'inflamed' | null
  _meshes: null, // [y][x] THREE.Mesh
  _treeTextures: null, // array of THREE.Texture (legacy — kept for compat)
  _organTreeCache: null, // organ-keyed decor cache {gut:[], heart:[], ...}
  _tissueCache: null,
  _terrainCache: null, // shared patch/inflamed textures // organ-keyed cache {gut:{}, heart:{}, kidney:{}, brain:{}}

  init: function(seed) {
    var W = this.W, H = this.H;
    this._types = new Array(W * H);
    this._special = new Array(W * H);   // SEQ-299 crash fix: was never allocated
    for (var si = 0; si < W * H; si++) this._special[si] = null;
    this._meshes = [];
    for (var y = 0; y < H; y++) {
      this._meshes[y] = [];
      for (var x = 0; x < W; x++) {
        var idx = y * W + x;
        if (window.Path.isPath(x, y)) {
          this._types[idx] = 1; // path
        } else {
          this._types[idx] = 0; // default floor
        }
      }
    }

    // seed non-path cells with mulberry32
    var rng = mulberry32(seed);
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var idx = y * W + x;
        if (this._types[idx] !== 1) { // only non-path cells
          this._types[idx] = 0; // always floor — blockers deleted
        }
      }
    }

    // seed special terrain from same rng immediately after type pass
    var e0 = Path.cellAt(0), e1 = Path.cellAt(1); // E1: entry cells for Manhattan exclusion
    for (var y2 = 0; y2 < H; y2++) {
      for (var x2 = 0; x2 < W; x2++) {
        var idx2 = y2 * W + x2;
        if (this._types[idx2] !== 1) { // non-path only
          // E1: skip cells within Manhattan distance 2 of either entry cell
          var nearEntry = false;
          if (e0) { var d0 = Math.abs(x2 - e0[0]) + Math.abs(y2 - e0[1]); if (d0 <= 2) nearEntry = true; }
          if (!nearEntry && e1) { var d1 = Math.abs(x2 - e1[0]) + Math.abs(y2 - e1[1]); if (d1 <= 2) nearEntry = true; }
          if (nearEntry) continue;
          var r = rng();
          this._special[idx2] = (r < 0.12) ? 'patch' : (r < 0.24) ? 'inflamed' : null;
        }
      }
    }

    this.buildMeshes();
  },

  specialAt: function(x, y) {
    if (x < 0 || x >= this.W || y < 0 || y >= this.H) return null;
    var s = this._special[y * this.W + x];
    return s === undefined ? null : s;
  },

  _ensureTreeTextures: function(organ) {
    if (this._treeTextures) return this._treeTextures;
    // organ-keyed decor cache
    var key = organ || 'gut';
    if (!this._organTreeCache) this._organTreeCache = {};
    if (this._organTreeCache[key]) return this._organTreeCache[key];
    // tissue wall planes (blocked type-2)
    var paths = [
      'assets/tissue_wall.png?v=45',
      'assets/tissue_wall_b.png?v=45',
      'assets/tissue_wall_c.png?v=45'
    ];
    if (key === 'stomach') {
      paths = [
        'assets/organs/stomach_rugae_a.png?v=82',
        'assets/organs/stomach_rugae_b.png?v=82',
        'assets/organs/stomach_rugae_c.png?v=82'
      ];
    }
    var loader = new THREE.TextureLoader();
    var organTrees = [];
    for (var i = 0; i < paths.length; i++) {
      var tex = loader.load(paths[i]);
      if (THREE.SRGBColorSpace !== undefined) {
        tex.colorSpace = THREE.SRGBColorSpace;
      } else {
        tex.encoding = THREE.sRGBEncoding;
      }
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      organTrees.push(tex);
    }
    this._organTreeCache[key] = organTrees;
    return organTrees;
  },

  _ensureTerrainTextures: function() {
    if (this._terrainCache) return this._terrainCache;
    var loader = new THREE.TextureLoader();
    var out = {};
    var names = { patch: 'terrain_patch', inflamed: 'terrain_inflamed' };
    for (var k in names) {
      var tex = loader.load('assets/organs/' + names[k] + '.png?v=49');
      if (THREE.SRGBColorSpace !== undefined) { tex.colorSpace = THREE.SRGBColorSpace; }
      else { tex.encoding = THREE.sRGBEncoding; }
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      out[k] = tex;
    }
    this._terrainCache = out;
    return out;
  },

  _ensureTissueTextures: function(organ) {
    if (!this._tissueCache) this._tissueCache = {};
    var key = organ || 'gut';
    if (this._tissueCache[key]) return this._tissueCache[key];
    var paths = [
      'assets/organs/' + key + '_cell_a.jpg?v=44',
      'assets/organs/' + key + '_cell_b.jpg?v=44',
      'assets/organs/' + key + '_lumen.jpg?v=44',
    ];
    var loader = new THREE.TextureLoader();
    var tissue = {};
    for (var i = 0; i < paths.length; i++) {
      var tex = loader.load(paths[i]);
      if (THREE.SRGBColorSpace !== undefined) {
        tex.colorSpace = THREE.SRGBColorSpace;
      } else {
        tex.encoding = THREE.sRGBEncoding;
      }
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      if (i === 0) tissue.cell_a = tex;
      else if (i === 1) tissue.cell_b = tex;
      else if (i === 2) tissue.lumen = tex;
    }
    this._tissueCache[key] = tissue;
    return tissue;
  },

  buildMeshes: function() {
    var scene = this.scene;
    if (!scene) return;
    // clear old tile meshes only (keep camera/lights if present)
    var keep = [];
    for (var i = scene.children.length - 1; i >= 0; i--) {
      var ch = scene.children[i];
      if (ch.isLight || ch.isCamera || (ch.name === 'camera' && ch !== scene)) {
        keep.push(ch);
      } else {
        if (ch.geometry) ch.geometry.dispose();
        if (ch.material) ch.material.dispose();
        scene.remove(ch);
      }
    }

    var W = this.W, H = this.H, TILE = this.TILE;
    // world center offset
    var ox = -W * TILE / 2 + TILE / 2;
    var oy = +H * TILE / 2 - TILE / 2;

    var mi = (window.Missions && Missions.current() >= 0) ? Missions.current() : 0;
    var organ = ORGAN_BY_MISSION[mi] || 'gut';

    // load tree textures once — pass organ for decor cache
    var treeTexs = this._ensureTreeTextures(organ);
    var tissue = this._ensureTissueTextures(organ);
    var terrainTex = this._ensureTerrainTextures();

    var colors = {
      0: new THREE.Color(0.82, 0.78, 0.79), // buildable cell — mucosa tissue base (map shows)
      1: new THREE.Color(1.0, 1.0, 1.0),     // path — pure white with map (hero lumen)
      2: new THREE.Color(0.30, 0.20, 0.24)   // wall — darkened with cell_b map
    };

    var geo = new THREE.PlaneGeometry(TILE - 1, TILE - 1);
    // shared decor plane — sits inside its own cell
    var treeGeo = new THREE.PlaneGeometry(TILE * 0.92, TILE * 0.92);

    // quadrant UV geometries — four quarters of [0,1]^2 so each tile shows a texture QUARTER
    var _quadGeos = null;
    function getQuadGeo() {
      if (_quadGeos) return _quadGeos;
      var qg = [];
      // A=[0,.5]x[0,.5], B=[.5,1]x[0,.5], C=[0,.5]x[.5,1], D=[.5,1]x[.5,1]
      var uvs = [
        [0.0, 1.0, 0.5, 1.0, 0.0, 0.5, 0.5, 0.5],
        [0.5, 1.0, 1.0, 1.0, 0.5, 0.5, 1.0, 0.5],
        [0.0, 0.5, 0.5, 0.5, 0.0, 0.0, 0.5, 0.0],
        [0.5, 0.5, 1.0, 0.5, 0.5, 0.0, 1.0, 0.0]
      ];
      for (var i = 0; i < 4; i++) {
        var g = new THREE.PlaneGeometry(TILE - 1, TILE - 1);
        // PlaneGeometry (1x1 segment) uv vertex order: (0,1) (1,1) (0,0) (1,0)
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs[i]), 2));
        qg.push(g);
      }
      _quadGeos = qg;
      return qg;
    }

    for (var y = 0; y < H; y++) {
      this._meshes[y] = [];
      for (var x = 0; x < W; x++) {
        var idx = y * W + x;
        var type = this._types[idx];
        // VISUAL ONLY jitter — do NOT touch _types
        var h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        var col = colors[type].clone();
        if (type === 0) {
          // FLOOR_NOISE: multi-channel micro-variation on buildable grass only
          var n0 = ((h % 1000) / 1000 - 0.5);
          var n1 = (((h >>> 10) % 1000) / 1000 - 0.5);
          var n2 = (((h >>> 20) % 1000) / 1000 - 0.5);
          col.r = Math.max(0.68, Math.min(0.88, col.r + n0 * 0.05 + n1 * 0.02));
          col.g = Math.max(0.64, Math.min(0.84, col.g + n1 * 0.04 + n2 * 0.02));
          col.b = Math.max(0.66, Math.min(0.86, col.b + n2 * 0.04 + n0 * 0.015));
        } else if (type === 2) {
          var j2 = ((h % 1000) / 1000 - 0.5) * 0.04;
          col.addScalar(j2);
        }
        // type === 1 path: pure white, NO jitter

        // texture cache for cells — organ-keyed object
        var cellA = tissue.cell_a, cellB = tissue.cell_b;
        var map = null, repeatX = 1, repeatY = 1, offsetX = 0, offsetY = 0;
        if (type === 0) {
          map = cellA;
        } else if (type === 1) {
          var lumen = tissue.lumen;
          map = lumen;
        }

        // quadrant UV picker — no texture clones, just geometry windowing
        var quadGeos = getQuadGeo();
        var quad = (h >>> 4) % 4;
        var meshMat = new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide });
        if (map) {
          meshMat.map = map;
        }
        // tiles become invisible overlays on the organ canvas
        if (type === 0 || type === 1) {
          meshMat.transparent = true;
          meshMat.opacity = 0.0;
        } else {
          meshMat.transparent = true;
          meshMat.opacity = 0.20;
        }
        var mesh = new THREE.Mesh(quadGeos[quad], meshMat);
        // SEQ-312 G1: type 0/1 tiles are invisible overlays — hide from rasterizer
        if (type === 0 || type === 1) { mesh.visible = false; }
        mesh.position.set(x * TILE + ox, -(y * TILE) + oy, 0);
        mesh.name = 'tile_' + x + '_' + y;
        scene.add(mesh);
        this._meshes[y][x] = mesh;

        // terrain/special decor — runs on special cells (patch/inflamed)
        var special = Grid.specialAt(x, y);
        if (special) {
          var cx = mesh.position.x, cy = mesh.position.y;   // SEQ-299 fix: cx/cy were scoped to the deleted type-2 branch
          var tTex = terrainTex[special];
          var tMat = new THREE.MeshBasicMaterial({ map: tTex, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
          tMat.color = new THREE.Color(0.72, 0.72, 0.72);
          var terrainMesh = new THREE.Mesh(treeGeo, tMat);
          terrainMesh.position.set(cx, cy, 0.12);
          terrainMesh.rotation.z = ((h % 360) * Math.PI) / 180;
          var sc2 = 0.80 + ((h % 20) / 100);
          terrainMesh.scale.set(sc2, sc2, 1);
          terrainMesh.renderOrder = 6;
          terrainMesh.name = 'tree_' + x + '_' + y;
          terrainMesh.frustumCulled = false;
          scene.add(terrainMesh);
        } else if (organ !== 'stomach' && (h >>> 7) % 6 === 0) {
          // light scenery on null-special cells — organ decor sprite at opacity 0.55
          var texs2 = treeTexs;
          var ti2 = h % texs2.length;
          var lMat = new THREE.MeshBasicMaterial({ map: texs2[ti2], transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
          lMat.color = new THREE.Color(0.72, 0.72, 0.72);
          var lightMesh = new THREE.Mesh(treeGeo, lMat);
          lightMesh.position.set(cx, cy, 0.12);
          lightMesh.rotation.z = ((h % 360) * Math.PI) / 180;
          var sc3 = 0.80 + ((h % 20) / 100);
          lightMesh.scale.set(sc3, sc3, 1);
          lightMesh.renderOrder = 6;
          lightMesh.name = 'tree_' + x + '_' + y;
          lightMesh.frustumCulled = false;
          scene.add(lightMesh);
        }
      }
    }

    // BOARD_FRAME: dark wooded rim (not buildable, not in _types)
    var fw = W * TILE + TILE * 0.55;
    var fh = H * TILE + TILE * 0.55;
    var frameGeo = new THREE.PlaneGeometry(fw, fh);
    var frameMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.102, 0.055, 0.071),
      side: THREE.DoubleSide,
      depthWrite: false
    });
    var frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, 0, -0.05);
    frame.name = 'boardFrame';
    frame.renderOrder = -1;
    scene.add(frame);
    // outer darker margin
    var outerGeo = new THREE.PlaneGeometry(fw + TILE * 0.9, fh + TILE * 0.9);
    var outerMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.102, 0.055, 0.071),
      side: THREE.DoubleSide,
      depthWrite: false
    });
    var outer = new THREE.Mesh(outerGeo, outerMat);
    outer.position.set(0, 0, -0.08);
    outer.name = 'boardOuter';
    outer.renderOrder = -2;
    scene.add(outer);

    // organ canvas — continuous painted scene (tiles become invisible overlays)
    var boardPath = 'assets/organs/' + organ + '_board.jpg?v=107';
    var boardLoader = new THREE.TextureLoader();
    var boardTex = boardLoader.load(boardPath);
    if (THREE.SRGBColorSpace !== undefined) {
      boardTex.colorSpace = THREE.SRGBColorSpace;
    } else {
      boardTex.encoding = THREE.sRGBEncoding;
    }
    boardTex.magFilter = THREE.LinearFilter;
    boardTex.minFilter = THREE.LinearMipmapLinearFilter;
    var organGeo = new THREE.PlaneGeometry(W * TILE, H * TILE);
    var organMat = new THREE.MeshBasicMaterial({ map: boardTex, side: THREE.DoubleSide });
    var organCanvas = new THREE.Mesh(organGeo, organMat);
    organCanvas.position.set(0, 0, -0.03); // in FRONT of boardFrame (-0.05)
    organCanvas.renderOrder = 0;            // frame is -1, so canvas paints over it
    organCanvas.name = 'organCanvas';
    scene.add(organCanvas);

  },


  at: function(x, y) {
    if (x < 0 || x >= this.W || y < 0 || y >= this.H) return -1;
    return this._types[y * this.W + x];
  },

  isBuildable: function(x, y) {
    return this.at(x, y) !== 1 && x >= 0 && x < this.W && y >= 0 && y < this.H;
  },

  reset: function() {
    this.init(1);
  },

  gridTypes: function() {
    var copy = new Array(this._types.length);
    for (var i = 0; i < this._types.length; i++) copy[i] = this._types[i];
    return copy;
  }
};


function mulberry32(a) {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
