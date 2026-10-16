// Open-Meteo の現在値。current.precipitation は「直前 interval 秒(ふつう900秒=15分)の合計 mm」なので
// 時間雨量に直すには 3600/interval 倍する。観測ではなく数値予報モデルの値で、格子は数 km。

export function buildUrl(lat, lon) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    current: 'precipitation,rain,showers',
    timezone: 'auto',
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** @returns {{mmPerHour:number, mm:number, intervalSec:number, time:string}} */
export function parseCurrent(json) {
  const c = json?.current;
  if (!c || typeof c.precipitation !== 'number') throw new Error('Open-Meteo の応答に current.precipitation がありません');
  const intervalSec = typeof c.interval === 'number' && c.interval > 0 ? c.interval : 900;
  return {
    mm: c.precipitation,
    intervalSec,
    mmPerHour: (c.precipitation * 3600) / intervalSec,
    time: c.time ?? '',
  };
}

/**
 * 音の推定と Open-Meteo を並べたときの一言。
 * 推定の幅に入っていれば「一致」。0 と非0 は比をとらない。
 */
export function compare(est, refRate) {
  if (est?.status === 'below-floor') {
    return refRate > (est.floorRate ?? 0)
      ? { verdict: 'miss', text: 'Open-Meteo は雨、音では聞き取れず' }
      : { verdict: 'match', text: 'どちらも雨なし(または検出下限未満)' };
  }
  if (est?.status !== 'ok') return { verdict: 'none', text: '比べられる推定値がありません' };
  if (!(refRate > 0)) return { verdict: 'ref-zero', text: 'Open-Meteo は雨なし(モデルの格子では降っていない扱い)' };
  if (refRate >= est.lo && refRate <= est.hi) return { verdict: 'match', text: '推定の幅の中に入っています' };
  const ratio = est.rate / refRate;
  return ratio > 1
    ? { verdict: 'over', text: `音のほうが ${ratio.toFixed(1)} 倍多め` }
    : { verdict: 'under', text: `音のほうが ${(1 / ratio).toFixed(1)} 倍少なめ` };
}
