// ===== LEVELS =====
const LEVELS = [
  { title: 'テラ川見習い',   min: 0,      max: 1000   },
  { title: '近所のテラ川',   min: 1000,   max: 10000  },
  { title: '散歩するテラ川', min: 10000,  max: 50000  },
  { title: '健脚のテラ川',   min: 50000,  max: 100000 },
  { title: '伝説のテラ川',   min: 100000, max: Infinity },
];

// ===== SPEECHES =====
const SPEECHES = {
  start:     ['今日も歩くか', 'さてと、行くか', 'よし、散歩するぞ'],
  walk100:   ['調子いいな', 'まあまあだな'],
  walk500:   ['だいぶ歩いたな', 'いい感じじゃないか'],
  walk1000:  ['1km歩いた。えらい', '1kmか。まずまずだ'],
  walk5000:  ['5km...足が棒だ', '5kmも歩いたぞ。俺すごい'],
  stopped:   ['おい、止まってるぞ', 'もう疲れたのか', 'ちょっと休憩か'],
  fall:      'うわっ！転んだ！',
  fallRecover: 'いてて...復活した',
  dance:     'イェーイ！踊るぞ！',
  pachinko100: 'あ！パチ屋だよ！',
  pachinko50:  '入っちゃおうかな...',
  pachiPass:   '...素通りした。えらい',
  ramen100:    'あ！ラーメン屋だ！食べなきゃ！',
  ramen50:     'もう匂いがする...',
};

// ===== STATE =====
const state = {
  map: null,
  marker: null,
  currentPos: null,

  // Stats
  totalDistance: 0,
  totalSteps: 0,
  todayDistance: 0,
  todaySteps: 0,
  todaySeconds: 0,

  // Moving detection
  isMoving: false,
  stopTimer: null,
  walkTimer: null,

  // 3-minute event cycle
  walkCycleSeconds: 0,
  eventIndex: 0,
  inEvent: false,

  // Milestone tracking
  milestones: { 100: false, 500: false, 1000: false, 5000: false },

  // Nearby places
  nearbyPlaces: [],
  lastQueryPos: null,
  lastQueryTime: 0,
  triggeredPlaces: {},

  // Speech
  speechTimeout: null,
};

// ===== STORAGE =====
function loadData() {
  const d = JSON.parse(localStorage.getItem('terakawa_walk_v2') || '{}');
  state.totalDistance = d.totalDistance || 0;
  state.totalSteps    = d.totalSteps    || 0;

  const today = todayStr();
  if (d.date === today) {
    state.todayDistance = d.todayDistance || 0;
    state.todaySteps    = d.todaySteps    || 0;
    state.todaySeconds  = d.todaySeconds  || 0;
    state.milestones    = d.milestones    || { 100: false, 500: false, 1000: false, 5000: false };
  }
}

function saveData() {
  localStorage.setItem('terakawa_walk_v2', JSON.stringify({
    date:          todayStr(),
    totalDistance: state.totalDistance,
    totalSteps:    state.totalSteps,
    todayDistance: state.todayDistance,
    todaySteps:    state.todaySteps,
    todaySeconds:  state.todaySeconds,
    milestones:    state.milestones,
  }));
}

function todayStr() {
  return new Date().toLocaleDateString('sv-SE');
}

// ===== MAP =====
function initMap() {
  state.map = L.map('map', { zoomControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(state.map);
  L.control.zoom({ position: 'topright' }).addTo(state.map);
  state.map.setView([35.6762, 139.6503], 15);
}

function createIcon() {
  return L.divIcon({
    className: 'leaflet-div-icon-tera',
    html: `<div class="tera-char" id="tera-icon">
      <div class="tera-face">
        <img src="assets/face.jpg" alt="テラ川">
      </div>
      <div class="tera-body-row">
        <div class="arm arm-l"></div>
        <div class="tera-torso"></div>
        <div class="arm arm-r"></div>
      </div>
      <div class="tera-legs">
        <div class="leg leg-l"></div>
        <div class="leg leg-r"></div>
      </div>
    </div>`,
    iconSize:   [58, 106],
    iconAnchor: [29, 106],
  });
}

// ===== GPS =====
function startGPS() {
  if (!navigator.geolocation) {
    setGPSStatus('GPS非対応');
    return;
  }
  setGPSStatus('GPS取得中...');
  navigator.geolocation.watchPosition(onPosition, onGPSError, {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 3000,
  });
}

function onPosition(pos) {
  const { latitude: lat, longitude: lng, accuracy } = pos.coords;
  setGPSStatus('精度 ' + Math.round(accuracy) + 'm');

  if (!state.marker) {
    state.marker = L.marker([lat, lng], { icon: createIcon() }).addTo(state.map);
    state.map.setView([lat, lng], 17);
    state.currentPos = [lat, lng];
    showSpeech(pick(SPEECHES.start));
    return;
  }

  const dist = calcDistance(state.currentPos[0], state.currentPos[1], lat, lng);

  // Filter GPS jitter
  if (dist < 2) return;
  if (dist > 200) return;

  const prev = state.currentPos;
  state.currentPos = [lat, lng];

  state.marker.setLatLng([lat, lng]);
  state.map.panTo([lat, lng], { animate: true, duration: 0.8 });

  // Update stats
  state.todayDistance += dist;
  state.totalDistance += dist;
  const steps = Math.round(dist / 0.75);
  state.todaySteps  += steps;
  state.totalSteps  += steps;

  checkMilestones();
  onMoving();
  maybeQueryNearby(lat, lng);
  checkNearbyPlaces(lat, lng);
  updateBarStats();
  saveData();
}

function onGPSError(err) {
  setGPSStatus('GPS取得失敗');
}

function setGPSStatus(msg) {
  document.getElementById('gps-status').textContent = msg;
}

// ===== MOVEMENT DETECTION =====
function onMoving() {
  if (!state.isMoving) {
    state.isMoving = true;
    setWalkAnim(true);
    startWalkTimer();
  }
  clearTimeout(state.stopTimer);
  state.stopTimer = setTimeout(() => {
    state.isMoving = false;
    setWalkAnim(false);
    showSpeech(pick(SPEECHES.stopped));
  }, 30000);
}

function startWalkTimer() {
  if (state.walkTimer) return;
  state.walkTimer = setInterval(() => {
    if (!state.isMoving) return;
    state.todaySeconds++;
    state.walkCycleSeconds++;

    // 3-minute (180s) event cycle
    if (state.walkCycleSeconds >= 180) {
      state.walkCycleSeconds = 0;
      if (state.eventIndex % 2 === 0) triggerFall();
      else triggerDance();
      state.eventIndex++;
    }

    updateBarTime();
  }, 1000);
}

// ===== MILESTONE SPEECHES =====
function checkMilestones() {
  const d = state.todayDistance;
  if (!state.milestones[100]  && d >= 100)  { state.milestones[100]  = true; showSpeech(pick(SPEECHES.walk100)); }
  if (!state.milestones[500]  && d >= 500)  { state.milestones[500]  = true; showSpeech(pick(SPEECHES.walk500)); }
  if (!state.milestones[1000] && d >= 1000) { state.milestones[1000] = true; showSpeech(pick(SPEECHES.walk1000)); }
  if (!state.milestones[5000] && d >= 5000) { state.milestones[5000] = true; showSpeech(pick(SPEECHES.walk5000)); }
}

// ===== ANIMATIONS =====
function getIconEl() {
  return document.getElementById('tera-icon');
}

function setWalkAnim(on) {
  const el = getIconEl();
  if (!el) return;
  if (on) el.classList.add('walking');
  else    el.classList.remove('walking');
}

function triggerFall() {
  if (state.inEvent) return;
  state.inEvent = true;
  const el = getIconEl();
  if (!el) return;
  el.classList.remove('walking');
  el.classList.add('falling');
  showSpeech(SPEECHES.fall, 4000);
  setTimeout(() => {
    el.classList.remove('falling');
    if (state.isMoving) el.classList.add('walking');
    showSpeech(SPEECHES.fallRecover);
    state.inEvent = false;
  }, 2500);
}

function triggerDance() {
  if (state.inEvent) return;
  state.inEvent = true;
  const el = getIconEl();
  if (!el) return;
  el.classList.remove('walking');
  el.classList.add('dancing');
  showSpeech(SPEECHES.dance, 4000);
  setTimeout(() => {
    el.classList.remove('dancing');
    if (state.isMoving) el.classList.add('walking');
    state.inEvent = false;
  }, 3200);
}

// ===== SPEECH BUBBLE =====
function showSpeech(text, duration = 3000) {
  const el = document.getElementById('speech-bubble');
  el.textContent = text;
  el.classList.add('visible');
  clearTimeout(state.speechTimeout);
  state.speechTimeout = setTimeout(() => el.classList.remove('visible'), duration);
}

// ===== OVERPASS API =====
async function maybeQueryNearby(lat, lng) {
  const now = Date.now();
  if (now - state.lastQueryTime < 60000) return;
  if (state.lastQueryPos) {
    if (calcDistance(state.lastQueryPos[0], state.lastQueryPos[1], lat, lng) < 100) return;
  }

  state.lastQueryTime = now;
  state.lastQueryPos  = [lat, lng];

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
      name: el.tags?.name || '',
    })).filter(p => p.lat && p.lng);
  } catch (e) {
    console.warn('Overpass error', e);
  }
}

function checkNearbyPlaces(lat, lng) {
  const now = Date.now();
  const COOLDOWN = 5 * 60 * 1000;

  for (const place of state.nearbyPlaces) {
    const dist = calcDistance(lat, lng, place.lat, place.lng);
    const key50  = place.id + '_50';
    const key100 = place.id + '_100';

    if (place.type === 'pachinko') {
      if (dist < 50 && canTrigger(key50, now, COOLDOWN)) {
        trigger(key50, now);
        showSpeech(SPEECHES.pachinko50, 4000);
      } else if (dist < 100 && canTrigger(key100, now, COOLDOWN)) {
        trigger(key100, now);
        showSpeech(SPEECHES.pachinko100, 3000);
      }
    } else if (place.type === 'ramen') {
      if (dist < 50 && canTrigger(key50, now, COOLDOWN)) {
        trigger(key50, now);
        showSpeech(SPEECHES.ramen50, 4000);
      } else if (dist < 100 && canTrigger(key100, now, COOLDOWN)) {
        trigger(key100, now);
        showSpeech(SPEECHES.ramen100, 4000);
      }
    }
  }
}

function canTrigger(key, now, cooldown) {
  return !state.triggeredPlaces[key] || now - state.triggeredPlaces[key] > cooldown;
}

function trigger(key, now) {
  state.triggeredPlaces[key] = now;
}

// ===== UTILS =====
function calcDistance(lat1, lng1, lat2, lng2) {
  const R  = 6371000;
  const p1 = lat1 * Math.PI / 180;
  const p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180;
  const dl = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(dp/2)**2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDist(m) {
  return m < 1000 ? Math.round(m) + 'm' : (m / 1000).toFixed(2) + 'km';
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ===== UI UPDATES =====
function updateBarStats() {
  document.getElementById('bar-distance').textContent = formatDist(state.todayDistance);
  document.getElementById('bar-steps').textContent    = state.todaySteps.toLocaleString();
}

function updateBarTime() {
  const m = Math.floor(state.todaySeconds / 60);
  const s = state.todaySeconds % 60;
  document.getElementById('bar-time').textContent =
    String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function updateStatsPage() {
  document.getElementById('s-steps').textContent       = state.todaySteps.toLocaleString();
  document.getElementById('s-distance').textContent    = formatDist(state.todayDistance);
  document.getElementById('s-time').textContent        = Math.floor(state.todaySeconds / 60) + '分';
  document.getElementById('s-cal').textContent         = Math.round(state.todayDistance * 0.06) + 'kcal';
  document.getElementById('s-total-steps').textContent = state.totalSteps.toLocaleString();
  document.getElementById('s-total-dist').textContent  = formatDist(state.totalDistance);

  const level = LEVELS.find(l => state.totalDistance >= l.min && state.totalDistance < l.max) || LEVELS[0];
  document.getElementById('level-title').textContent = level.title;
  const pct = level.max === Infinity ? 100
    : ((state.totalDistance - level.min) / (level.max - level.min)) * 100;
  document.getElementById('level-bar').style.width = Math.min(100, pct) + '%';
}

// ===== PAGE SWITCHING =====
function switchPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelector('[data-page="' + name + '"]').classList.add('active');
  if (name === 'stats') updateStatsPage();
  if (name === 'map')   setTimeout(() => state.map?.invalidateSize(), 50);
}

// ===== INIT =====
loadData();
initMap();
startGPS();
updateBarStats();
updateBarTime();

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.warn);
}
