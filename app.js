// ===== CONSTANTS =====
const PPM    = 5;    // pixels per meter
const LEVELS = [
  { title: 'テラ川見習い',   min: 0,      max: 1000   },
  { title: '近所のテラ川',   min: 1000,   max: 10000  },
  { title: '散歩するテラ川', min: 10000,  max: 50000  },
  { title: '健脚のテラ川',   min: 50000,  max: 100000 },
  { title: '伝説のテラ川',   min: 100000, max: Infinity },
];

const SPEECHES = {
  start:       ['今日も歩くか', 'さてと、行くか', 'よし、散歩するぞ'],
  walk100:     ['調子いいな', 'まあまあだな'],
  walk500:     ['だいぶ歩いたな', 'いい感じじゃないか'],
  walk1000:    ['1km歩いた。えらい', '1kmか。まずまずだ'],
  walk5000:    ['5km...足が棒だ', '5kmも歩いたぞ。俺すごい'],
  stopped:     ['おい、止まってるぞ', 'もう疲れたのか'],
  fall:        'うわっ！転んだ！',
  fallRecover: 'いてて...復活した',
  dance:       'イェーイ！踊るぞ！',
  pachinko100: 'あ！パチ屋だよ！',
  pachinko50:  '入っちゃおうかな...',
  ramen100:    'あ！ラーメン屋だ！食べなきゃ！',
  ramen50:     'もう匂いがする...',
};

// ===== STATE =====
const state = {
  scene: null,
  originLat: null, originLng: null,
  worldX: 0, worldY: 0,
  currentLat: null, currentLng: null,

  totalDistance: 0, totalSteps: 0,
  todayDistance: 0, todaySteps: 0, todaySeconds: 0,
  milestones: { 100: false, 500: false, 1000: false, 5000: false },

  isMoving: false, stopTimer: null, walkTimer: null,
  walkCycleSeconds: 0, eventIndex: 0, inEvent: false,

  roads: [], buildings: [],
  lastMapFetchPos: null, lastMapFetchTime: 0,
  nearbyPlaces: [],
  lastNearbyFetchPos: null, lastNearbyFetchTime: 0,
  triggeredPlaces: {},
  speechTimeout: null,
};

// ===== STORAGE =====
function loadData() {
  const d = JSON.parse(localStorage.getItem('terakawa_walk_v3') || '{}');
  state.totalDistance = d.totalDistance || 0;
  state.totalSteps    = d.totalSteps    || 0;
  const today = new Date().toLocaleDateString('sv-SE');
  if (d.date === today) {
    state.todayDistance = d.todayDistance || 0;
    state.todaySteps    = d.todaySteps    || 0;
    state.todaySeconds  = d.todaySeconds  || 0;
    state.milestones    = d.milestones    || state.milestones;
  }
}

function saveData() {
  localStorage.setItem('terakawa_walk_v3', JSON.stringify({
    date: new Date().toLocaleDateString('sv-SE'),
    totalDistance: state.totalDistance, totalSteps: state.totalSteps,
    todayDistance: state.todayDistance, todaySteps: state.todaySteps,
    todaySeconds:  state.todaySeconds,  milestones:  state.milestones,
  }));
}

// ===== GPS UTILS =====
function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180, dl = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dp/2)**2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function gpsToWorld(lat, lng) {
  const mLat = 111319;
  const mLng = 111319 * Math.cos(state.originLat * Math.PI / 180);
  return {
    x:  (lng - state.originLng) * mLng * PPM,
    y: -(lat - state.originLat) * mLat * PPM,
  };
}

// ===== PHASER SCENE =====
class WalkScene extends Phaser.Scene {
  constructor() { super({ key: 'WalkScene' }); }

  preload() {
    // nothing to load - textures generated in create
  }

  create() {
    state.scene = this;
    const W = this.scale.width;
    const H = this.scale.height;

    // ---- GRASS BACKGROUND ----
    this.makeGrassTexture();
    this.grassBg = this.add.tileSprite(W / 2, H / 2, W * 8, H * 8, 'grass');

    // ---- LAYERS (draw order: buildings → roads → trees → shadow → POI) ----
    this.buildingGfx = this.add.graphics();
    this.roadGfx     = this.add.graphics();
    this.treeGroup   = this.add.group();
    this.shadowGfx   = this.add.graphics();
    this.poiGroup    = this.add.group();

    // ---- SHADOW under character ----
    this.drawShadow(W / 2, H / 2 + 42);

    // ---- TREES (world-space, pseudo-random) ----
    this.plantTrees();

    // ---- GPS ----
    startGPS();

    this.scale.on('resize', (sz) => this.onResize(sz.width, sz.height), this);
  }

  // ----- TEXTURES -----
  makeGrassTexture() {
    const g = this.make.graphics({ add: false });
    const S = 48;
    g.fillStyle(0x4aae48); g.fillRect(0, 0, S, S);
    // lighter patches
    [[2,6,11,5],[28,2,9,6],[38,36,7,5],[14,34,10,4],[42,16,5,7]].forEach(([x,y,w,h]) => {
      g.fillStyle(0x56c454); g.fillRect(x, y, w, h);
    });
    // darker patches
    [[18,3,7,4],[36,24,5,6],[8,26,6,4],[24,42,8,4]].forEach(([x,y,w,h]) => {
      g.fillStyle(0x3a9838); g.fillRect(x, y, w, h);
    });
    // grass blades
    g.fillStyle(0x2d8030);
    [[5,2],[20,10],[34,6],[46,20],[10,38],[40,44],[26,28],[47,10],[3,42]].forEach(([x,y]) => {
      g.fillRect(x, y, 2, 4);
    });
    g.generateTexture('grass', S, S);
    g.destroy();
  }

  makeTreeTexture() {
    const g = this.make.graphics({ add: false });
    g.fillStyle(0x7a4a1a); g.fillRect(5, 16, 6, 12); // trunk
    g.fillStyle(0x2a6a18); g.fillCircle(8, 12, 12);
    g.fillStyle(0x3a8020); g.fillCircle(5, 8, 9);
    g.fillStyle(0x4a9a28); g.fillCircle(10, 6, 7);
    g.fillStyle(0x5ab830); g.fillCircle(6, 4, 5);
    g.generateTexture('tree', 24, 30);
    g.destroy();
  }

  // ----- DECORATIONS -----
  drawShadow(cx, cy) {
    this.shadowGfx.clear();
    this.shadowGfx.fillStyle(0x000000, 0.25);
    this.shadowGfx.fillEllipse(cx, cy, 48, 16);
  }

  plantTrees() {
    this.makeTreeTexture();
    const CELL = 80;
    for (let gx = -6; gx <= 6; gx++) {
      for (let gy = -6; gy <= 6; gy++) {
        const h = ((gx * 73856093) ^ (gy * 19349663)) >>> 0;
        if ((h & 0xff) > 180) continue;
        const wx = gx * CELL + ((h >> 8) & 0xff) % CELL - CELL / 2;
        const wy = gy * CELL + ((h >> 16) & 0xff) % CELL - CELL / 2;
        const tree = this.add.image(0, 0, 'tree').setOrigin(0.5, 1);
        tree.setData('wx', wx);
        tree.setData('wy', wy);
        this.treeGroup.add(tree);
      }
    }
    this.updateDecoPositions();
  }

  updateDecoPositions() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const W = this.scale.width, H = this.scale.height;
    this.treeGroup.getChildren().forEach(t => {
      const sx = cx + t.getData('wx') - state.worldX;
      const sy = cy + t.getData('wy') - state.worldY;
      t.setPosition(sx, sy);
      t.setVisible(sx > -30 && sx < W + 30 && sy > -30 && sy < H + 30);
    });
  }

  // ----- MAP DRAWING -----
  drawMap() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    const toScreen = (lat, lon) => {
      const w = gpsToWorld(lat, lon);
      return { x: cx + w.x - state.worldX, y: cy + w.y - state.worldY };
    };

    this.buildingGfx.clear();
    this.roadGfx.clear();

    // Buildings
    const bldColors = [0xd49070, 0x88b0c0, 0xb0c888, 0xd4b060, 0xa080c0];
    for (const bld of state.buildings) {
      if (!bld.geometry || bld.geometry.length < 3) continue;
      const pts = bld.geometry.map(n => toScreen(n.lat, n.lon));
      const col = bldColors[Math.abs(bld.id) % bldColors.length];
      this.buildingGfx.fillStyle(col, 1);
      this.buildingGfx.beginPath();
      this.buildingGfx.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach(p => this.buildingGfx.lineTo(p.x, p.y));
      this.buildingGfx.closePath();
      this.buildingGfx.fillPath();
      this.buildingGfx.lineStyle(2, 0x705040, 0.8);
      this.buildingGfx.strokePath();
    }

    // Roads
    for (const road of state.roads) {
      if (!road.geometry || road.geometry.length < 2) continue;
      const hw = road.tags?.highway || '';
      const isPath    = ['footway','path','cycleway','steps'].includes(hw);
      const isPrimary = ['primary','secondary','trunk'].includes(hw);
      const w  = isPath ? 3 : isPrimary ? 22 : 14;
      const fc = isPath ? 0xd4c880 : 0xecd898;
      const bc = isPath ? 0xb0a060 : 0xc8b060;
      const pts = road.geometry.map(n => toScreen(n.lat, n.lon));
      // border
      this.roadGfx.lineStyle(w + 5, bc, 1);
      this.roadGfx.beginPath();
      this.roadGfx.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach(p => this.roadGfx.lineTo(p.x, p.y));
      this.roadGfx.strokePath();
      // surface
      this.roadGfx.lineStyle(w, fc, 1);
      this.roadGfx.beginPath();
      this.roadGfx.moveTo(pts[0].x, pts[0].y);
      pts.slice(1).forEach(p => this.roadGfx.lineTo(p.x, p.y));
      this.roadGfx.strokePath();
    }
  }

  // ----- POI MARKERS -----
  addPOI(lat, lng, type) {
    const exists = this.poiGroup.getChildren().some(
      o => o.getData('lat') === lat && o.getData('lng') === lng
    );
    if (exists) return;

    const color = type === 'pachinko' ? 0xff4444 : 0xff8800;
    const label = type === 'pachinko' ? 'P' : 'R';
    const gfx   = this.add.graphics();
    gfx.fillStyle(0x000000, 0.3); gfx.fillEllipse(0, 14, 20, 6);
    gfx.fillStyle(color, 1);      gfx.fillCircle(0, 0, 13);
    gfx.lineStyle(2, 0xffffff, 1); gfx.strokeCircle(0, 0, 13);
    const txt = this.add.text(0, 0, label, {
      fontSize: '13px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);
    const c = this.add.container(0, 0, [gfx, txt]);
    c.setData('lat', lat); c.setData('lng', lng);
    this.poiGroup.add(c);
    this.updatePOIPositions();
  }

  updatePOIPositions() {
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    this.poiGroup.getChildren().forEach(o => {
      const w = gpsToWorld(o.getData('lat'), o.getData('lng'));
      o.setPosition(cx + w.x - state.worldX, cy + w.y - state.worldY);
    });
  }

  // ----- PLAYER MOVE -----
  movePlayer(lat, lng) {
    if (!state.originLat) { state.originLat = lat; state.originLng = lng; }
    const w = gpsToWorld(lat, lng);
    state.worldX = w.x;
    state.worldY = w.y;
    // scroll grass
    this.grassBg.tilePositionX = state.worldX / 3;
    this.grassBg.tilePositionY = state.worldY / 3;
    this.drawMap();
    this.updateDecoPositions();
    this.updatePOIPositions();
  }

  // ----- RESIZE -----
  onResize(W, H) {
    this.grassBg.setPosition(W / 2, H / 2);
    this.drawShadow(W / 2, H / 2 + 42);
    this.drawMap();
    this.updateDecoPositions();
    this.updatePOIPositions();
  }

  update() {
    // subtle grass shimmer
    this.grassBg.tilePositionX = state.worldX / 3 + this.time.now * 0.002;
  }
}

// ===== GPS =====
function startGPS() {
  if (!navigator.geolocation) { setGPSStatus('GPS非対応'); return; }
  setGPSStatus('GPS取得中...');
  navigator.geolocation.watchPosition(onPosition, onGPSError, {
    enableHighAccuracy: true, timeout: 15000, maximumAge: 3000,
  });
}

function onPosition(pos) {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  setGPSStatus('精度 ' + Math.round(accuracy) + 'm');

  const sc = state.scene;
  if (!sc) return;

  if (!state.currentLat) {
    state.currentLat = lat; state.currentLng = lng;
    sc.movePlayer(lat, lng);
    showSpeech(pick(SPEECHES.start));
    fetchMapData(lat, lng);
    fetchNearby(lat, lng);
    return;
  }

  const dist = calcDistance(state.currentLat, state.currentLng, lat, lng);
  if (dist < 2 || dist > 200) return;

  state.currentLat = lat; state.currentLng = lng;
  state.todayDistance += dist; state.totalDistance += dist;
  const steps = Math.round(dist / 0.75);
  state.todaySteps += steps; state.totalSteps += steps;

  sc.movePlayer(lat, lng);
  checkMilestones();
  onMoving();
  maybeRefetchMap(lat, lng);
  maybeRefetchNearby(lat, lng);
  checkNearbyPlaces(lat, lng);
  updateHUD();
  saveData();
}

function onGPSError() { setGPSStatus('GPS取得失敗'); }
function setGPSStatus(msg) { document.getElementById('gps-badge').textContent = msg; }

// ===== MOVEMENT =====
function onMoving() {
  if (!state.isMoving) { state.isMoving = true; setWalkAnim(true); startWalkTimer(); }
  clearTimeout(state.stopTimer);
  state.stopTimer = setTimeout(() => {
    state.isMoving = false; setWalkAnim(false);
    showSpeech(pick(SPEECHES.stopped));
  }, 30000);
}

function startWalkTimer() {
  if (state.walkTimer) return;
  state.walkTimer = setInterval(() => {
    if (!state.isMoving) return;
    state.todaySeconds++;
    state.walkCycleSeconds++;
    if (state.walkCycleSeconds >= 180) {
      state.walkCycleSeconds = 0;
      state.eventIndex % 2 === 0 ? triggerFall() : triggerDance();
      state.eventIndex++;
    }
    updateBarTime();
  }, 1000);
}

// ===== MILESTONES =====
function checkMilestones() {
  const d = state.todayDistance;
  if (!state.milestones[100]  && d >= 100)  { state.milestones[100]  = true; showSpeech(pick(SPEECHES.walk100));  }
  if (!state.milestones[500]  && d >= 500)  { state.milestones[500]  = true; showSpeech(pick(SPEECHES.walk500));  }
  if (!state.milestones[1000] && d >= 1000) { state.milestones[1000] = true; showSpeech(pick(SPEECHES.walk1000)); }
  if (!state.milestones[5000] && d >= 5000) { state.milestones[5000] = true; showSpeech(pick(SPEECHES.walk5000)); }
}

// ===== ANIMATIONS =====
function getIconEl() { return document.getElementById('tera-icon'); }
function setWalkAnim(on) {
  const el = getIconEl(); if (!el) return;
  el.classList.toggle('walking', on);
}

function triggerFall() {
  if (state.inEvent) return; state.inEvent = true;
  const el = getIconEl(); if (!el) return;
  el.classList.remove('walking'); el.classList.add('falling');
  showSpeech(SPEECHES.fall, 4000);
  setTimeout(() => {
    el.classList.remove('falling');
    if (state.isMoving) el.classList.add('walking');
    showSpeech(SPEECHES.fallRecover);
    state.inEvent = false;
  }, 2500);
}

function triggerDance() {
  if (state.inEvent) return; state.inEvent = true;
  const el = getIconEl(); if (!el) return;
  el.classList.remove('walking'); el.classList.add('dancing');
  showSpeech(SPEECHES.dance, 4000);
  setTimeout(() => {
    el.classList.remove('dancing');
    if (state.isMoving) el.classList.add('walking');
    state.inEvent = false;
  }, 3200);
}

// ===== SPEECH =====
function showSpeech(text, duration = 3000) {
  const el = document.getElementById('speech-bubble');
  el.textContent = text; el.classList.add('visible');
  clearTimeout(state.speechTimeout);
  state.speechTimeout = setTimeout(() => el.classList.remove('visible'), duration);
}

// ===== OVERPASS =====
async function fetchMapData(lat, lng) {
  state.lastMapFetchPos  = [lat, lng];
  state.lastMapFetchTime = Date.now();
  const q = `[out:json][timeout:15];(
way["highway"~"primary|secondary|tertiary|residential|service|footway|path|cycleway|steps"](around:400,${lat},${lng});
way["building"](around:400,${lat},${lng});
);out geom;`;
  try {
    const res  = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q));
    const data = await res.json();
    state.roads     = data.elements.filter(e => e.tags?.highway);
    state.buildings = data.elements.filter(e => e.tags?.building);
    state.scene?.drawMap();
  } catch (e) { console.warn('Map fetch error', e); }
}

async function fetchNearby(lat, lng) {
  state.lastNearbyFetchPos  = [lat, lng];
  state.lastNearbyFetchTime = Date.now();
  const q = `[out:json][timeout:10];(
node["amenity"="gambling"]["gambling"="pachinko"](around:300,${lat},${lng});
way["amenity"="gambling"]["gambling"="pachinko"](around:300,${lat},${lng});
node["amenity"="restaurant"]["cuisine"="ramen"](around:300,${lat},${lng});
node["amenity"="restaurant"]["name"~"ラーメン|らーめん|拉麺",i](around:300,${lat},${lng});
);out center;`;
  try {
    const res  = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q));
    const data = await res.json();
    state.nearbyPlaces = data.elements.map(el => ({
      id:   el.id,
      type: el.tags?.gambling === 'pachinko' ? 'pachinko' : 'ramen',
      lat:  el.lat ?? el.center?.lat,
      lng:  el.lon ?? el.center?.lon,
    })).filter(p => p.lat && p.lng);
    state.nearbyPlaces.forEach(p => state.scene?.addPOI(p.lat, p.lng, p.type));
  } catch (e) { console.warn('Nearby fetch error', e); }
}

function maybeRefetchMap(lat, lng) {
  if (Date.now() - state.lastMapFetchTime < 90000) return;
  if (state.lastMapFetchPos) {
    if (calcDistance(state.lastMapFetchPos[0], state.lastMapFetchPos[1], lat, lng) < 120) return;
  }
  fetchMapData(lat, lng);
}

function maybeRefetchNearby(lat, lng) {
  if (Date.now() - state.lastNearbyFetchTime < 60000) return;
  if (state.lastNearbyFetchPos) {
    if (calcDistance(state.lastNearbyFetchPos[0], state.lastNearbyFetchPos[1], lat, lng) < 100) return;
  }
  fetchNearby(lat, lng);
}

function checkNearbyPlaces(lat, lng) {
  const now = Date.now(), CD = 5 * 60 * 1000;
  for (const p of state.nearbyPlaces) {
    const d = calcDistance(lat, lng, p.lat, p.lng);
    const k50 = p.id + '_50', k100 = p.id + '_100';
    if (p.type === 'pachinko') {
      if (d < 50  && canTrigger(k50,  now, CD)) { trigger(k50,  now); showSpeech(SPEECHES.pachinko50,  4000); }
      else if (d < 100 && canTrigger(k100, now, CD)) { trigger(k100, now); showSpeech(SPEECHES.pachinko100, 3000); }
    } else {
      if (d < 50  && canTrigger(k50,  now, CD)) { trigger(k50,  now); showSpeech(SPEECHES.ramen50,     4000); }
      else if (d < 100 && canTrigger(k100, now, CD)) { trigger(k100, now); showSpeech(SPEECHES.ramen100,   4000); }
    }
  }
}

function canTrigger(k, now, cd) { return !state.triggeredPlaces[k] || now - state.triggeredPlaces[k] > cd; }
function trigger(k, now)         { state.triggeredPlaces[k] = now; }

// ===== UI =====
function updateHUD() {
  document.getElementById('bar-distance').textContent = fmtDist(state.todayDistance);
  document.getElementById('bar-steps').textContent    = state.todaySteps.toLocaleString();
  updateLevel();
}

function updateBarTime() {
  const m = Math.floor(state.todaySeconds / 60), s = state.todaySeconds % 60;
  document.getElementById('bar-time').textContent = pad(m) + ':' + pad(s);
}

function updateLevel() {
  const lv = LEVELS.find(l => state.totalDistance >= l.min && state.totalDistance < l.max) || LEVELS[0];
  document.getElementById('level-badge').textContent = lv.title;
}

function updateStatsPage() {
  document.getElementById('s-steps').textContent       = state.todaySteps.toLocaleString();
  document.getElementById('s-distance').textContent    = fmtDist(state.todayDistance);
  document.getElementById('s-time').textContent        = Math.floor(state.todaySeconds / 60) + '分';
  document.getElementById('s-cal').textContent         = Math.round(state.todayDistance * 0.06) + 'kcal';
  document.getElementById('s-total-steps').textContent = state.totalSteps.toLocaleString();
  document.getElementById('s-total-dist').textContent  = fmtDist(state.totalDistance);
  const lv  = LEVELS.find(l => state.totalDistance >= l.min && state.totalDistance < l.max) || LEVELS[0];
  const pct = lv.max === Infinity ? 100 : ((state.totalDistance - lv.min) / (lv.max - lv.min)) * 100;
  document.getElementById('s-level-title').textContent = lv.title;
  document.getElementById('s-level-bar').style.width   = Math.min(100, pct) + '%';
}

function fmtDist(m) { return m < 1000 ? Math.round(m) + 'm' : (m / 1000).toFixed(2) + 'km'; }
function pad(n)     { return String(n).padStart(2, '0'); }
function pick(arr)  { return arr[Math.floor(Math.random() * arr.length)]; }

// ===== PAGE SWITCH =====
function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelector('[data-page="' + name + '"]').classList.add('active');
  if (name === 'stats') updateStatsPage();
  if (name === 'map') {
    setTimeout(() => {
      state.scene?.scale.refresh();
      state.scene?.drawMap();
      state.scene?.updateDecoPositions();
      state.scene?.updatePOIPositions();
    }, 50);
  }
}

// ===== PHASER INIT =====
loadData();

const gameH = window.innerHeight - 62; // minus nav only (HUD is inside game page)

const game = new Phaser.Game({
  type:            Phaser.AUTO,
  parent:          'game-container',
  width:           window.innerWidth > 480 ? 480 : window.innerWidth,
  height:          gameH,
  backgroundColor: '#3a9830',
  scene:           WalkScene,
  scale: {
    mode:       Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: { antialias: false, pixelArt: false },
});

updateHUD();
updateBarTime();

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.warn);
}
