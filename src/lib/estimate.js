// 窓の要約 + 背景 + 校正 → 表示してよい推定値か、出せない理由か。
// 「測れないときは測れないと言う」をここで一か所に集める。

import { excessPower, excessDb, rateWithRange, rateFromExcess } from './model.js';

/** これより背景との差が小さければ雨音と言えない(dB) */
export const FLOOR_DB = 1;
/** 倍音の筋が立つフレームがこの割合を超えたら、声・音楽・機械音とみなす */
export const MAX_TONAL_FRACTION = 0.2;
/** 0.5 秒ごとのパワーの変動係数がこれを超えたら、途切れる音(声・足音・通過車)とみなす */
export const MAX_BLOCK_CV = 0.6;
/** 校正した雨量の範囲から何倍外れたら「外挿」と明示するか */
export const EXTRAPOLATE_FACTOR = 4;

/**
 * @returns {{status:string, message:string, excessDb?:number, rate?:number, lo?:number, hi?:number, floorRate?:number, extrapolated?:boolean}}
 */
export function estimate({ summary, background, model }) {
  if (!summary) return { status: 'no-signal', message: '音を待っています' };
  if (!background) {
    return { status: 'no-background', message: '校正前のため数値を出しません(手順1: 晴れの日の背景)' };
  }
  const db = excessDb(summary.power, background.power);
  if (!model) {
    return {
      status: 'no-rain-cal',
      excessDb: db,
      message: '校正前のため数値を出しません(手順2: 雨の日に1回録る)',
    };
  }
  const floorExcess = background.power * (10 ** (FLOOR_DB / 10) - 1);
  const floorRate = rateFromExcess(model, floorExcess);
  if (db < FLOOR_DB) {
    return {
      status: 'below-floor',
      excessDb: db,
      floorRate,
      message: `背景と区別できません(雨なし、または約 ${fmtRate(floorRate)} mm/h 未満)`,
    };
  }
  const reasons = [];
  if (summary.tonalFraction > MAX_TONAL_FRACTION) {
    reasons.push(`倍音の筋がある音が ${Math.round(summary.tonalFraction * 100)}% の時間で鳴っている(声・音楽・機械音?)`);
  }
  if (summary.blockCv > MAX_BLOCK_CV) reasons.push(`音量が途切れ途切れ(変動 ${summary.blockCv.toFixed(2)})`);
  if (reasons.length) {
    return {
      status: 'not-rain',
      excessDb: db,
      message: `雨音らしくないので推定しません: ${reasons.join('、')}`,
    };
  }
  const excess = excessPower(summary.power, background.power);
  // 今回の窓のゆらぎ: ブロック平均の標準誤差を超過パワーに対する比に直す
  const sigma = (summary.blockCv * summary.power) / Math.sqrt(Math.max(1, summary.blocks));
  const measLog = Math.log10(1 + Math.min(10, sigma / excess));
  const { rate, lo, hi } = rateWithRange(model, excess, measLog);
  const extrapolated = rate > model.rateMax * EXTRAPOLATE_FACTOR || rate < model.rateMin / EXTRAPOLATE_FACTOR;
  return {
    status: 'ok',
    excessDb: db,
    rate,
    lo,
    hi,
    floorRate,
    extrapolated,
    message: extrapolated ? '校正した雨量から大きく外れています(外挿なので幅は目安)' : '',
  };
}

/** 雨量の表示桁: 1 未満は小数2桁、10 未満は1桁、それ以上は整数 */
export function fmtRate(r) {
  if (!Number.isFinite(r)) return '—';
  if (r < 1) return r.toFixed(2);
  if (r < 10) return r.toFixed(1);
  return Math.round(r).toString();
}

/** 気象庁の雨の強さの用語(1 mm/h 未満と 3〜10 は気象庁に用語がないので補った) */
export function intensityLabel(r) {
  if (!(r > 0)) return '雨なし';
  if (r < 1) return 'ぱらぱら';
  if (r < 3) return '弱い雨';
  if (r < 10) return '本降り';
  if (r < 20) return 'やや強い雨';
  if (r < 30) return '強い雨';
  if (r < 50) return '激しい雨';
  if (r < 80) return '非常に激しい雨';
  return '猛烈な雨';
}
