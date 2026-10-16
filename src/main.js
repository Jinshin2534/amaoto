// 配線: 音源(マイク/デモ/外部注入) → フレーム解析 → 窓の要約 → 推定 → 表示・答え合わせ

import { analyzeFrame, summarize, RAIN_BAND } from './lib/features.js';
import { makeRainPoint, fitModel, P_ASSUMED_RANGE } from './lib/model.js';
import { estimate, fmtRate, intensityLabel, FLOOR_DB } from './lib/estimate.js';
import { buildUrl, parseCurrent, compare } from './lib/openmeteo.js';
import { createRainSynth } from './lib/synth.js';
import { createMic } from './audio.js';

const N = 2048;
const LIVE_SEC = 4;
const REC_SEC = 10;
const DEMO_SR = 48000;
const STORE_KEY = 'amaoto:v1';
const OM_REFRESH_MS = 5 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const el = {
  sourceLabel: $('source-label'),
  btnMic: $('btn-mic'),
  btnDemo: $('btn-demo'),
  demoBar: $('demo-bar'),
  demoRate: $('demo-rate'),
  demoRateVal: $('demo-rate-val'),
  demoVoice: $('demo-voice'),
  rate: $('rate'),
  range: $('range'),
  label: $('label'),
  message: $('message'),
  meterFill: $('meter-fill'),
  meterFloor: $('meter-floor'),
  diag: $('diag'),
  cmpEst: $('cmp-est'),
  cmpRef: $('cmp-ref'),
  cmpVerdict: $('cmp-verdict'),
  btnLocate: $('btn-locate'),
  btnLog: $('btn-log'),
  locLabel: $('loc-label'),
  log: $('log'),
  spec: $('spec'),
  bgStatus: $('bg-status'),
  btnBg: $('btn-bg'),
  refRate: $('ref-rate'),
  btnRefOm: $('btn-ref-om'),
  points: $('points'),
  btnRain: $('btn-rain'),
  recProgress: $('rec-progress'),
  recFill: $('rec-fill'),
  recText: $('rec-text'),
  calibMsg: $('calib-msg'),
  modelDesc: $('model-desc'),
  btnReset: $('btn-reset'),
};

// ---- 保存(マイク用の校正だけ。デモは保存しない) ----
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (s && typeof s === 'object') return { background: s.background ?? null, points: s.points ?? [], log: s.log ?? [], loc: s.loc ?? null };
  } catch {
    /* 壊れていたら作り直す */
  }
  return { background: null, points: [], log: [], loc: null };
}
function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(stores.mic));
  } catch {
    /* プライベートモード等では保存しない */
  }
}

const stores = { mic: loadStore(), demo: { background: null, points: [], log: [], loc: null } };

const state = {
  source: null, // 'mic' | 'demo' | 'fed'
  sampleRate: DEMO_SR,
  frames: [], // 直近 LIVE_SEC 秒
  t: 0,
  rec: null, // { kind:'bg'|'rain', frames:[], until, ref }
  summary: null,
  est: { status: 'no-signal', message: 'マイクかデモを選んでください' },
  om: null, // { mmPerHour, time, fetchedAt }
  omError: '',
  micInfo: '',
};

let mic = null;
let synth = null;
let demoTimer = null;
let omTimer = null;

const store = () => stores[state.source === 'mic' || state.source === null ? 'mic' : 'demo'];
const model = () => fitModel(store().points);

// ---- フレームの受け口(マイク/デモ/__app.feed 共通) ----
function onFrame(wave, sampleRate) {
  state.sampleRate = sampleRate;
  const f = analyzeFrame(wave, sampleRate, state.t);
  state.t += wave.length / sampleRate;
  state.frames.push(f);
  while (state.frames.length && state.t - state.frames[0].t > LIVE_SEC) state.frames.shift();
  if (state.rec) {
    state.rec.frames.push(f);
    if (state.t >= state.rec.until) finishRecording();
  }
}

let lastUpdate = 0;
function update(force = false) {
  const now = performance.now();
  if (!force && now - lastUpdate < 400) return;
  lastUpdate = now;
  state.summary = state.frames.length > 4 ? summarize(state.frames, state.sampleRate) : null;
  state.est = estimate({ summary: state.summary, background: store().background, model: model() });
  render();
}

function loop() {
  update();
  if (state.rec) renderProgress();
  requestAnimationFrame(loop);
}

// ---- 音源 ----
function stopSource() {
  mic?.stop();
  mic = null;
  clearInterval(demoTimer);
  demoTimer = null;
  synth = null;
  state.frames = [];
  state.rec = null;
  el.recProgress.hidden = true;
}

async function startMic() {
  stopSource();
  state.source = 'mic';
  el.demoBar.hidden = true;
  el.sourceLabel.textContent = 'マイク起動中…';
  try {
    mic = await createMic(onFrame);
    const s = mic.settings;
    const off = s.autoGainControl === false && s.noiseSuppression === false;
    state.micInfo = `${mic.label || 'マイク'} · ${mic.sampleRate} Hz${off ? '' : ' · ⚠ 自動音量/ノイズ除去が切れていない可能性'}`;
    el.sourceLabel.textContent = '🎤 マイク';
  } catch (e) {
    state.source = null;
    el.sourceLabel.textContent = '停止中';
    el.message.textContent = `マイクを使えません: ${e.message}。デモで試せます`;
  }
  setActive();
  renderCalib();
}

function startDemo() {
  stopSource();
  state.source = 'demo';
  state.micInfo = '';
  el.demoBar.hidden = false;
  el.sourceLabel.textContent = '▶ デモ(合成音)';
  synth = createRainSynth({ sampleRate: DEMO_SR, rate: Number(el.demoRate.value), seed: Date.now() % 1e9, voice: el.demoVoice.checked });
  // 実時間で 2048 サンプルずつ。setInterval が遅れたぶんは追いつく
  let due = performance.now();
  demoTimer = setInterval(() => {
    const now = performance.now();
    let guard = 0;
    while (due <= now && guard++ < 20) {
      onFrame(synth.next(N), DEMO_SR);
      due += (N / DEMO_SR) * 1000;
    }
  }, 20);
  setActive();
  renderCalib();
}

function rebuildSynth() {
  if (state.source !== 'demo') return;
  synth = createRainSynth({ sampleRate: DEMO_SR, rate: Number(el.demoRate.value), seed: Date.now() % 1e9, voice: el.demoVoice.checked });
}

function setActive() {
  el.btnMic.classList.toggle('active', state.source === 'mic');
  el.btnDemo.classList.toggle('active', state.source === 'demo');
}

// ---- 校正の録音 ----
function startRecording(kind) {
  if (!state.source) {
    calibNote('先にマイクかデモを始めてください');
    return false;
  }
  if (state.rec) return false;
  let ref = null;
  if (kind === 'rain') {
    ref = Number(el.refRate.value);
    if (!(ref > 0)) {
      calibNote('基準の雨量(mm/h)を入れてください');
      el.refRate.focus();
      return false;
    }
  }
  state.rec = { kind, frames: [], until: state.t + REC_SEC, ref, startT: state.t };
  calibNote('');
  el.recProgress.hidden = false;
  return true;
}

function calibNote(text, ok = false) {
  el.calibMsg.textContent = text;
  el.calibMsg.classList.toggle('ok', ok);
}

function finishRecording() {
  const rec = state.rec;
  state.rec = null;
  el.recProgress.hidden = true;
  const summary = summarize(rec.frames, state.sampleRate);
  const st = store();
  if (rec.kind === 'bg') {
    st.background = { power: summary.power, powerDb: summary.powerDb, bands: summary.bands, takenAt: Date.now() };
    // 雨の点は残す: 点が持つ超過パワーは録った時点の背景を引いた絶対量なので、背景を取り直しても使える
    const raining = state.om && state.om.mmPerHour > 0;
    if (raining) {
      calibNote(`背景を記録しました。ただし Open-Meteo では今 ${fmtRate(state.om.mmPerHour)} mm/h の雨です。雨音が混ざっていたら晴れの日に取り直してください`);
    } else {
      calibNote(`背景を記録しました(雨帯域 ${summary.powerDb.toFixed(1)} dB)`, true);
    }
  } else {
    const r = makeRainPoint(summary, st.background, rec.ref);
    if (r.ok) {
      st.points.push({ ...r.point, bands: summary.bands, takenAt: Date.now() });
      calibNote(`雨の校正点を追加しました(${fmtRate(rec.ref)} mm/h、背景より +${r.point.excessDb.toFixed(1)} dB)`, true);
    } else {
      calibNote(r.reason);
    }
  }
  if (state.source === 'mic') saveStore();
  renderCalib();
  update(true);
}

// ---- Open-Meteo ----
async function fetchOm() {
  const loc = stores.mic.loc;
  if (!loc) return;
  try {
    const res = await fetch(buildUrl(loc.lat, loc.lon));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    state.om = { ...parseCurrent(await res.json()), fetchedAt: Date.now() };
    state.omError = '';
  } catch (e) {
    state.omError = `Open-Meteo を取得できません: ${e.message}`;
  }
  renderCompare();
}

function locate() {
  if (!navigator.geolocation) {
    state.omError = 'この端末では位置情報が使えません';
    renderCompare();
    return;
  }
  el.locLabel.textContent = '位置を取得中…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setLocation(pos.coords.latitude, pos.coords.longitude);
    },
    (err) => {
      state.omError = `位置を取得できません(${err.message})`;
      renderCompare();
    },
    { maximumAge: 10 * 60 * 1000, timeout: 15000 },
  );
}

function setLocation(lat, lon) {
  stores.mic.loc = { lat, lon };
  saveStore();
  fetchOm();
  clearInterval(omTimer);
  omTimer = setInterval(fetchOm, OM_REFRESH_MS);
}

function addLog() {
  const est = state.est;
  const ref = state.om?.mmPerHour;
  if (est.status !== 'ok' && est.status !== 'below-floor') {
    state.omError = '推定値が出ているときだけ記録できます';
    renderCompare();
    return;
  }
  const entry = {
    at: Date.now(),
    source: state.source,
    est: est.status === 'ok' ? { rate: est.rate, lo: est.lo, hi: est.hi } : { below: est.floorRate },
    ref: ref ?? null,
    verdict: ref != null ? compare(est, ref).text : 'Open-Meteo 未取得',
  };
  const st = store();
  st.log.unshift(entry);
  st.log = st.log.slice(0, 50);
  if (state.source === 'mic') saveStore();
  renderCompare();
}

// ---- 描画 ----
function render() {
  const e = state.est;
  if (e.status === 'ok') {
    el.rate.textContent = fmtRate(e.rate);
    el.range.textContent = `${fmtRate(e.lo)} 〜 ${fmtRate(e.hi)} mm/h`;
    el.label.textContent = intensityLabel(e.rate);
  } else if (e.status === 'below-floor') {
    el.rate.textContent = `< ${fmtRate(e.floorRate)}`;
    el.range.textContent = '';
    el.label.textContent = '雨なし、または聞き取れない弱さ';
  } else {
    el.rate.textContent = '—';
    el.range.textContent = '';
    el.label.textContent = '';
  }
  el.rate.parentElement.classList.toggle('dim', e.status !== 'ok');
  el.message.textContent = e.message || (state.source ? '' : 'マイクかデモを選んでください');
  el.message.classList.toggle('warn', e.status === 'not-rain' || !!e.extrapolated);

  // メーター: 背景との差 -5〜+40 dB
  const db = e.excessDb;
  const toPct = (v) => Math.max(0, Math.min(100, ((v + 5) / 45) * 100));
  el.meterFill.style.width = db == null ? '0%' : `${toPct(db)}%`;
  el.meterFloor.style.left = `${toPct(FLOOR_DB)}%`;

  const s = state.summary;
  const parts = [];
  if (db != null) parts.push(`背景比 ${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`);
  else if (s) parts.push(`雨帯域 ${s.powerDb.toFixed(1)} dB`);
  if (s) {
    parts.push(`倍音フレーム ${Math.round(s.tonalFraction * 100)}%`);
    parts.push(`変動 ${s.blockCv.toFixed(2)}`);
    parts.push(`窓 ${s.seconds.toFixed(1)} 秒`);
  }
  if (state.micInfo) parts.push(state.micInfo);
  if (state.source === 'demo') parts.push(`真値 ${el.demoRate.value} mm/h`);
  el.diag.textContent = parts.join(' · ');

  drawSpectrum();
  renderCompare();
}

function renderCompare() {
  const e = state.est;
  el.cmpEst.textContent =
    e.status === 'ok' ? `${fmtRate(e.rate)} mm/h` : e.status === 'below-floor' ? `< ${fmtRate(e.floorRate)} mm/h` : '—';
  if (state.om) {
    const t = state.om.time ? state.om.time.slice(11, 16) : '';
    el.cmpRef.textContent = `${fmtRate(state.om.mmPerHour)} mm/h`;
    el.cmpRef.title = `${t} までの15分 ${state.om.mm} mm`;
    const c = compare(e, state.om.mmPerHour);
    el.cmpVerdict.textContent = state.omError || c.text;
    el.cmpVerdict.dataset.verdict = c.verdict;
  } else {
    el.cmpRef.textContent = '—';
    el.cmpVerdict.textContent = state.omError || '「現在地で取得」で並べて比べます';
    el.cmpVerdict.dataset.verdict = 'none';
  }
  const loc = stores.mic.loc;
  el.locLabel.textContent = loc
    ? `地点 ${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}${state.om ? ` · ${state.om.time.slice(11, 16)} 時点(5分ごとに更新)` : ''}`
    : '';
  const log = store().log;
  el.log.innerHTML = '';
  for (const g of log.slice(0, 10)) {
    const li = document.createElement('li');
    const d = new Date(g.at);
    const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const est = g.est.rate != null ? `${fmtRate(g.est.rate)} (${fmtRate(g.est.lo)}〜${fmtRate(g.est.hi)})` : `< ${fmtRate(g.est.below)}`;
    li.textContent = `${when} 音 ${est} / OM ${g.ref != null ? fmtRate(g.ref) : '—'} mm/h — ${g.verdict}`;
    el.log.appendChild(li);
  }
}

function renderCalib() {
  const st = store();
  el.bgStatus.textContent = st.background
    ? `記録済み ${fmtTime(st.background.takenAt)} · 雨帯域 ${st.background.powerDb.toFixed(1)} dB`
    : '未記録';
  el.bgStatus.classList.toggle('done', !!st.background);
  el.points.innerHTML = '';
  st.points.forEach((p, i) => {
    const li = document.createElement('li');
    li.textContent = `${fmtTime(p.takenAt)} · ${fmtRate(p.rate)} mm/h · 背景より +${p.excessDb.toFixed(1)} dB `;
    const del = document.createElement('button');
    del.className = 'link';
    del.textContent = '削除';
    del.onclick = () => {
      st.points.splice(i, 1);
      if (state.source === 'mic') saveStore();
      renderCalib();
      update(true);
    };
    li.appendChild(del);
    el.points.appendChild(li);
  });
  el.btnRain.disabled = !st.background;
  const m = model();
  if (!m) {
    el.modelDesc.textContent = '';
  } else if (m.fitted) {
    el.modelDesc.textContent = `${m.n} 点から傾き p = ${m.p.toFixed(2)}(幅 ${m.pLo.toFixed(2)}〜${m.pHi.toFixed(2)})を当てました`;
  } else {
    el.modelDesc.textContent = `校正点 ${m.n} 個。傾き p は仮定(${P_ASSUMED_RANGE[0].toFixed(1)}〜${P_ASSUMED_RANGE[1].toFixed(1)})。雨量が2倍以上違う日にもう1回録ると p を当てられます`;
  }
  el.btnReset.hidden = !st.background && !st.points.length;
  const label = state.source === 'demo' ? '(デモ用・保存しません)' : '';
  el.btnBg.textContent = `背景を録る(10秒)${label}`;
}

function renderProgress() {
  const r = state.rec;
  if (!r) return;
  const p = Math.min(1, (state.t - r.startT) / REC_SEC);
  el.recFill.style.width = `${p * 100}%`;
  el.recText.textContent = `${r.kind === 'bg' ? '背景' : '雨'}を録音中… ${Math.ceil((1 - p) * REC_SEC)} 秒`;
}

const fmtTime = (ms) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawSpectrum() {
  const c = el.spec;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== Math.round(w * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const LO = 100;
  const HI = 16000;
  const xOf = (f) => (Math.log(f / LO) / Math.log(HI / LO)) * w;
  // 雨帯域の網掛け
  g.fillStyle = cssVar('--band');
  g.fillRect(xOf(RAIN_BAND[0]), 0, xOf(RAIN_BAND[1]) - xOf(RAIN_BAND[0]), h);
  // 目盛り
  g.fillStyle = cssVar('--muted');
  g.font = '10px system-ui, sans-serif';
  for (const f of [100, 300, 1000, 3000, 8000]) g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, xOf(f) + 2, h - 3);

  const st = store();
  const lines = [];
  if (st.background) lines.push({ bands: st.background.bands, color: cssVar('--bg-line'), dash: [4, 3] });
  const lastPt = st.points[st.points.length - 1];
  if (lastPt?.bands) lines.push({ bands: lastPt.bands, color: cssVar('--cal-line'), dash: [2, 2] });
  if (state.summary) lines.push({ bands: state.summary.bands, color: cssVar('--accent'), dash: [] });
  if (!lines.length) return;
  const all = lines.flatMap((l) => l.bands);
  const top = Math.max(...all) + 3;
  const bottom = top - 60;
  const yOf = (db) => h - 14 - ((db - bottom) / (top - bottom)) * (h - 20);
  for (const l of lines) {
    g.strokeStyle = l.color;
    g.setLineDash(l.dash);
    g.lineWidth = 1.6;
    g.beginPath();
    l.bands.forEach((db, i) => {
      const x = ((i + 0.5) / l.bands.length) * w;
      const y = Math.max(0, Math.min(h - 14, yOf(db)));
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
  }
  g.setLineDash([]);
}

// ---- イベント ----
el.btnMic.onclick = startMic;
el.btnDemo.onclick = startDemo;
el.demoRate.oninput = () => {
  el.demoRateVal.textContent = el.demoRate.value;
  synth?.setRate(Number(el.demoRate.value));
};
el.demoVoice.onchange = rebuildSynth;
el.btnBg.onclick = () => startRecording('bg');
el.btnRain.onclick = () => startRecording('rain');
el.btnRefOm.onclick = () => {
  if (state.source === 'demo') el.refRate.value = el.demoRate.value;
  else if (state.om) el.refRate.value = fmtRate(state.om.mmPerHour);
  else calibNote('先に「答え合わせ」で Open-Meteo を取得してください');
};
el.btnLocate.onclick = locate;
el.btnLog.onclick = addLog;
el.btnReset.onclick = () => {
  const st = store();
  st.background = null;
  st.points = [];
  if (state.source !== 'demo') saveStore();
  calibNote('校正を消しました');
  renderCalib();
  update(true);
};
window.addEventListener('resize', () => drawSpectrum());

renderCalib();
render();
if (stores.mic.loc) setLocation(stores.mic.loc.lat, stores.mic.loc.lon);
requestAnimationFrame(loop);

// ---- ヘッドレス検証用 ----
window.__app = {
  state,
  stores,
  /** 外部から波形を流し込む(長さ 2048) */
  feed(wave, sampleRate = DEMO_SR) {
    if (!state.source) state.source = 'fed';
    onFrame(wave, sampleRate);
  },
  startDemo,
  setDemoRate(r) {
    el.demoRate.value = String(r);
    el.demoRate.oninput();
  },
  /** デモ音を seconds 秒ぶん即座に流す(実時間を待たない) */
  fastForward(seconds) {
    if (!synth) throw new Error('demo not running');
    const n = Math.round((seconds * DEMO_SR) / N);
    for (let i = 0; i < n; i++) onFrame(synth.next(N), DEMO_SR);
    update(true);
  },
  recordBackground: () => startRecording('bg'),
  recordRain(ref) {
    el.refRate.value = String(ref);
    return startRecording('rain');
  },
  setLocation,
  estimate: () => (update(true), state.est),
};
