var VER = 'v85';
var CACHE_NAME = 'bastion-v85'; // literal for VERSTAMP; must match VER
var N = '85';
var JS = ['path','grid','lives','enemies','economy','towers','waves','missions','game','presentation','ambient','sfx'];
var NETFIRST = ['./','./index.html'].concat(JS.map(function(n){ return './js/'+n+'.js?v='+N; }));
var IMMUTABLE = ['./three.min.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
var ASSETS = NETFIRST.concat(IMMUTABLE);

ASSETS.push('./assets/tissue_wall.png');
ASSETS.push('./assets/tissue_wall_b.png');
ASSETS.push('./assets/tissue_wall_c.png');
ASSETS.push('./assets/tower_gun.png');
ASSETS.push('./assets/tower_slow.png');
ASSETS.push('./assets/tower_antibody.png');
ASSETS.push('./assets/tower_tcell.png');
ASSETS.push('./assets/enemy_normal.png');
ASSETS.push('./assets/enemy_fast.png');
// Unit sheets (SEQ-281)
ASSETS.push('./assets/units/u_pathogen_basic_sheet.png');
ASSETS.push('./assets/units/u_pathogen_fast_sheet.png');
ASSETS.push('./assets/units/u_pathogen_boss_sheet.png');
ASSETS.push('./assets/units/u_tower_neutrophil_sheet.png');
ASSETS.push('./assets/units/u_tower_macrophage_sheet.png');
ASSETS.push('./assets/units/u_tower_antibody_sheet.png');
ASSETS.push('./assets/units/u_tower_tcell_sheet.png');
ASSETS.push('./assets/units/u_tower_fever_sheet.png');
ASSETS.push('./assets/units/u_tower_nk_sheet.png');
ASSETS.push('./assets/units/u_tower_cytokine_sheet.png');
// SEQ-324: icon stamps for E6/E8 precache
ASSETS.push('./assets/units/icon_basic.png');
ASSETS.push('./assets/units/icon_slow.png');
ASSETS.push('./assets/units/icon_antibody.png');
ASSETS.push('./assets/units/icon_tcell.png');
ASSETS.push('./assets/units/icon_fever.png');
ASSETS.push('./assets/units/icon_nk.png');
ASSETS.push('./assets/units/icon_cytokine.png');

// Organ tissue maps (SEQ-291)
ASSETS.push('./assets/organs/gut_cell_a.jpg?v=45');
ASSETS.push('./assets/organs/gut_cell_b.jpg?v=45');
ASSETS.push('./assets/organs/gut_lumen.jpg?v=45');
ASSETS.push('./assets/organs/gut_backdrop.jpg?v=45');
// Villi decor (SEQ-294)
ASSETS.push('./assets/organs/gut_villi_a.png?v=45');
ASSETS.push('./assets/organs/gut_villi_b.png?v=45');
ASSETS.push('./assets/organs/gut_villi_c.png?v=45');
ASSETS.push('./assets/organs/stomach_cell_a.jpg?v=44');
ASSETS.push('./assets/organs/stomach_cell_b.jpg?v=44');
ASSETS.push('./assets/organs/stomach_lumen.jpg?v=44');
ASSETS.push('./assets/organs/stomach_backdrop.jpg?v=44');
ASSETS.push('./assets/organs/stomach_rugae_a.png?v=82');
ASSETS.push('./assets/organs/stomach_rugae_b.png?v=82');
ASSETS.push('./assets/organs/stomach_rugae_c.png?v=82');
ASSETS.push('./assets/organs/stomach_board.jpg?v=47');
ASSETS.push('./assets/organs/heart_cell_a.jpg?v=44');
ASSETS.push('./assets/organs/heart_cell_b.jpg?v=44');
ASSETS.push('./assets/organs/heart_lumen.jpg?v=44');
ASSETS.push('./assets/organs/heart_backdrop.jpg?v=44');
ASSETS.push('./assets/organs/kidney_cell_a.jpg?v=44');
ASSETS.push('./assets/organs/kidney_cell_b.jpg?v=44');
ASSETS.push('./assets/organs/kidney_lumen.jpg?v=44');
ASSETS.push('./assets/organs/kidney_backdrop.jpg?v=44');
ASSETS.push('./assets/organs/brain_cell_a.jpg?v=44');
ASSETS.push('./assets/organs/brain_cell_b.jpg?v=44');
ASSETS.push('./assets/organs/brain_lumen.jpg?v=44');
ASSETS.push('./assets/organs/brain_backdrop.jpg?v=44');
// Organ boards (SEQ-297)
ASSETS.push('./assets/organs/gut_board.jpg?v=47');
ASSETS.push('./assets/organs/heart_board.jpg?v=47');
ASSETS.push('./assets/organs/kidney_board.jpg?v=47');
ASSETS.push('./assets/organs/brain_board.jpg?v=47');
// Terrain special cells (SEQ-300)
ASSETS.push('./assets/organs/terrain_patch.png');
ASSETS.push('./assets/organs/terrain_inflamed.png');
self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(function(c){
    return c.addAll(ASSETS.map(function(u){ return new Request(u, {cache:'reload'}); }));
  }));
});

self.addEventListener('activate', function(e){
  self.clients.claim();
  e.waitUntil(caches.keys().then(function(ns){
    return Promise.all(ns.filter(function(n){ return n !== CACHE_NAME; }).map(function(n){ return caches.delete(n); }));
  }));
});

self.addEventListener('fetch', function(e){
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  var netFirst = url.pathname.slice(-1) === '/' || /index\.html$/.test(url.pathname) || url.pathname.indexOf('/js/') !== -1;
  if (!netFirst) {
    e.respondWith(caches.match(e.request, {ignoreSearch:true}).then(function(r){ return r || fetch(e.request); }));
    return;
  }
  e.respondWith(
    fetch(e.request).then(function(resp){
      if (resp && resp.ok) {
        var copy = resp.clone();
        caches.open(CACHE_NAME).then(function(c){ c.put(e.request, copy); });
      }
      return resp;
    }).catch(function(){
      return caches.match(e.request, {ignoreSearch:true}).then(function(r){
        return r || new Response('/* offline: '+url.pathname+' */',
          {status:504, headers:{'Content-Type':'text/plain'}});
      });
    })
  );
});
