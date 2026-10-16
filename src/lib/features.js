// 1フレームの特徴と、数秒分のフレームをまとめた「窓」の要約。
// 雨音は 1〜8 kHz に広く平らに出る。低域(車・空調)と高域(マイクの自己雑音)は使わない。

import { powerSpectrum } from './fft.js';

export const RAIN_BAND = [1000, 8000];
/** 1フレームの平坦度がこれ未満なら「倍音の筋がある」フレームとして数える */
export const TONAL_FRAME_FLATNESS = 0.2;
/** 定常さを見るブロック長(秒) */
export const BLOCK_SEC = 0.5;
/** 表示用の対数バンド数(100 Hz〜16 kHz) */
export const DISPLAY_BANDS = 40;
const DISPLAY_LO = 100;
const DISPLAY_HI = 16000;

const binHz = (n, sr) => sr / n; // n = FFT長

/** パワースペクトルの [lo, hi) Hz の和 */
export function bandPower(psd, sampleRate, lo, hi) {
  const hz = binHz(psd.length * 2, sampleRate);
  const k0 = Math.max(1, Math.ceil(lo / hz));
  const k1 = Math.min(psd.length, Math.ceil(hi / hz));
  let s = 0;
  for (let k = k0; k < k1; k++) s += psd[k];
  return s;
}

/** スペクトル平坦度(幾何平均/算術平均、0〜1)。雑音は1に近く、声や音楽の倍音は小さい */
export function spectralFlatness(psd, sampleRate, lo, hi) {
  const hz = binHz(psd.length * 2, sampleRate);
  const k0 = Math.max(1, Math.ceil(lo / hz));
  const k1 = Math.min(psd.length, Math.ceil(hi / hz));
  let logSum = 0;
  let sum = 0;
  let n = 0;
  for (let k = k0; k < k1; k++) {
    const v = psd[k] + 1e-30;
    logSum += Math.log(v);
    sum += v;
    n++;
  }
  if (n === 0 || sum <= 0) return 0;
  return Math.exp(logSum / n) / (sum / n);
}

/** 表示用: 対数間隔バンドの dB */
export function displayBands(psd, sampleRate, count = DISPLAY_BANDS) {
  const out = new Array(count);
  const r = Math.log(DISPLAY_HI / DISPLAY_LO);
  for (let i = 0; i < count; i++) {
    const lo = DISPLAY_LO * Math.exp((r * i) / count);
    const hi = DISPLAY_LO * Math.exp((r * (i + 1)) / count);
    // 帯域幅で割ったパワー密度。狭い低域バンドが空にならないよう最低1bin
    const hz = binHz(psd.length * 2, sampleRate);
    const k0 = Math.max(1, Math.floor(lo / hz));
    const k1 = Math.max(k0 + 1, Math.min(psd.length, Math.ceil(hi / hz)));
    let s = 0;
    for (let k = k0; k < k1; k++) s += psd[k];
    out[i] = 10 * Math.log10(s / (k1 - k0) + 1e-20);
  }
  return out;
}

/** 1フレーム分の解析 */
export function analyzeFrame(wave, sampleRate, t) {
  const psd = powerSpectrum(wave);
  return {
    t,
    psd,
    band: bandPower(psd, sampleRate, RAIN_BAND[0], RAIN_BAND[1]),
    flatness: spectralFlatness(psd, sampleRate, RAIN_BAND[0], RAIN_BAND[1]),
  };
}

/**
 * 複数フレームの要約。
 * - power: 雨帯域のパワー。0.5 秒ブロック平均の中央値をとるので、
 *   半分未満の時間しか鳴らない音(話し声・通過車・物音)にはほとんど引っぱられない
 * - meanPower: 単純なフレーム平均(比較用)
 * - flatness: 平均スペクトルの雨帯域での平坦度
 * - tonalFraction: 倍音の筋が立っているフレームの割合。声はビブラートで平均すると筋がぼやけるので、
 *   平均ではなくフレームごと(約 43 ms)に見る
 * - blockCv: 0.5 秒ブロックごとの平均パワーの変動係数(声のように途切れる音は大きい)
 */
export function summarize(frames, sampleRate) {
  if (!frames.length) return null;
  const nb = frames[0].psd.length;
  const mean = new Float64Array(nb);
  let power = 0;
  let tonal = 0;
  for (const f of frames) {
    if (f.flatness < TONAL_FRAME_FLATNESS) tonal++;
    for (let k = 0; k < nb; k++) mean[k] += f.psd[k];
    power += f.band;
  }
  for (let k = 0; k < nb; k++) mean[k] /= frames.length;
  power /= frames.length;

  const t0 = frames[0].t;
  const blocks = new Map();
  for (const f of frames) {
    const b = Math.floor((f.t - t0) / BLOCK_SEC);
    const e = blocks.get(b) ?? { s: 0, n: 0 };
    e.s += f.band;
    e.n++;
    blocks.set(b, e);
  }
  const bm = [...blocks.values()].map((e) => e.s / e.n);
  const sorted = [...bm].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const mu = bm.reduce((a, b) => a + b, 0) / bm.length;
  const sd = Math.sqrt(bm.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, bm.length - 1));
  return {
    power: median,
    powerDb: 10 * Math.log10(median + 1e-20),
    meanPower: power,
    flatness: spectralFlatness(mean, sampleRate, RAIN_BAND[0], RAIN_BAND[1]),
    tonalFraction: tonal / frames.length,
    blockCv: bm.length > 1 && mu > 0 ? sd / mu : 0,
    blocks: bm.length,
    seconds: frames[frames.length - 1].t - t0,
    bands: displayBands(mean, sampleRate),
  };
}
