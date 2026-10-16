// 雨量モデル: 雨音の超過パワー E = (いまの雨帯域パワー − 晴れの日の背景) が E ∝ R^p に従うとする。
// 雨粒の数は雨量にほぼ比例し、大雨ほど粒が大きく一粒の音も大きいので p は 1 より少し大きい。
// 校正点が1つなら p は仮定(1.0〜1.6)で、そのぶんの幅を誤差として必ず見せる。
// 校正点が雨量2倍以上離れて2つ以上あれば、log-log の最小二乗で p を当てる。

export const P_ASSUMED = 1.3;
export const P_ASSUMED_RANGE = [1.0, 1.6];
const P_FIT_CLAMP = [0.5, 2.5];
/** 同じ雨を測り直したときの再現性の仮定(log10 単位で 0.1 ≈ ±1 dB) */
const BASE_RESID = 0.1;
/** 校正に使える雨音は背景より 3 dB 以上大きいこと */
export const MIN_CAL_EXCESS_DB = 3;

/** 背景に対する超過パワー(負なら0) */
export function excessPower(power, bgPower) {
  return Math.max(0, power - bgPower);
}

/** 背景に対する dB 差 */
export function excessDb(power, bgPower) {
  return 10 * Math.log10((power + 1e-20) / (bgPower + 1e-20));
}

/**
 * 雨の校正点を作る。失敗理由は日本語で返す。
 * @returns {{ok:true, point:{rate:number, excess:number, excessDb:number}} | {ok:false, reason:string}}
 */
export function makeRainPoint(summary, background, refRate) {
  if (!background) return { ok: false, reason: '先に晴れの日の背景を録ってください' };
  if (!(refRate > 0)) return { ok: false, reason: '基準の雨量(mm/h)が0より大きくないと校正できません' };
  const db = excessDb(summary.power, background.power);
  if (db < MIN_CAL_EXCESS_DB) {
    return {
      ok: false,
      reason: `雨音が背景より ${db.toFixed(1)} dB しか大きくありません(${MIN_CAL_EXCESS_DB} dB 以上必要)。マイクを窓に近づけるか、強めの雨の日に録ってください`,
    };
  }
  return { ok: true, point: { rate: refRate, excess: excessPower(summary.power, background.power), excessDb: db } };
}

/** 校正点からモデルを作る。点が無ければ null */
export function fitModel(points) {
  if (!points?.length) return null;
  const xs = points.map((p) => Math.log10(p.rate));
  const ys = points.map((p) => Math.log10(p.excess));
  const n = points.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const span = Math.max(...xs) - Math.min(...xs);

  if (n === 1 || span < Math.log10(2)) {
    // 雨量がほぼ同じ点しかない → 傾きは決められない。平均点を軸に仮定の p を使う
    const resid = n > 1 ? Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0) / (n - 1)) : 0;
    return {
      pivotLogR: mx,
      pivotLogE: my,
      p: P_ASSUMED,
      pLo: P_ASSUMED_RANGE[0],
      pHi: P_ASSUMED_RANGE[1],
      resid: Math.max(BASE_RESID, resid),
      n,
      fitted: false,
      rateMin: Math.min(...points.map((p) => p.rate)),
      rateMax: Math.max(...points.map((p) => p.rate)),
    };
  }
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const p = Math.min(P_FIT_CLAMP[1], Math.max(P_FIT_CLAMP[0], sxy / sxx));
  const sse = ys.reduce((a, y, i) => a + (y - (my + p * (xs[i] - mx))) ** 2, 0);
  const resid = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
  // 2点だと誤差が推定できないので、仮定の幅と同じ ±0.3 を残す
  const se = n > 2 ? resid / Math.sqrt(sxx) : 0;
  const halfW = Math.max(0.3, 2 * se);
  return {
    pivotLogR: mx,
    pivotLogE: my,
    p,
    pLo: Math.max(P_FIT_CLAMP[0], p - halfW),
    pHi: Math.min(P_FIT_CLAMP[1], p + halfW),
    resid: Math.max(BASE_RESID, resid),
    n,
    fitted: true,
    rateMin: Math.min(...points.map((p) => p.rate)),
    rateMax: Math.max(...points.map((p) => p.rate)),
  };
}

/** 超過パワー E → 雨量(中心値) */
export function rateFromExcess(model, excess, p = model.p) {
  return 10 ** (model.pivotLogR + (Math.log10(excess) - model.pivotLogE) / p);
}

/**
 * 超過パワー E → 雨量と幅。
 * 幅は「p の不確かさ」×「再現性+今回の測定のゆらぎ(measLog, log10単位)」の組み合わせの最小〜最大。
 * 校正点から離れるほど p の不確かさが効いて幅が開く。
 */
export function rateWithRange(model, excess, measLog = 0) {
  const rate = rateFromExcess(model, excess);
  const dy = model.resid + measLog;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of [model.pLo, model.p, model.pHi]) {
    for (const s of [-dy, dy]) {
      const r = rateFromExcess(model, excess * 10 ** s, p);
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
  }
  return { rate, lo, hi };
}
