// 実数入力の radix-2 FFT。マイクにもデモ音にもテストにも同じ解析を通すため自前で持つ。

/** 長さが2の冪かどうか */
export function isPow2(n) {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

/**
 * ハン窓を掛けた片側パワースペクトル(長さ n/2、bin 0 = DC)。
 * 窓のパワー(Σw²)で割ってあるので、白色雑音の分散 σ² なら各binの期待値は ≈ 2σ²/n、
 * 全binの和は ≈ σ²(=信号の平均パワー)になる。
 */
export function powerSpectrum(input) {
  const n = input.length;
  if (!isPow2(n)) throw new Error(`FFT length must be a power of 2, got ${n}`);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let wPow = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
    re[i] = input[i] * w;
    wPow += w * w;
  }
  fftInPlace(re, im);
  const half = n / 2;
  const out = new Float64Array(half);
  const scale = 1 / (wPow * n);
  out[0] = (re[0] * re[0] + im[0] * im[0]) * scale;
  for (let k = 1; k < half; k++) out[k] = 2 * (re[k] * re[k] + im[k] * im[k]) * scale;
  return out;
}

function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    const h = len / 2;
    for (let i = 0; i < n; i += len) {
      let cRe = 1;
      let cIm = 0;
      for (let k = 0; k < h; k++) {
        const a = i + k;
        const b = a + h;
        const bRe = re[b] * cRe - im[b] * cIm;
        const bIm = re[b] * cIm + im[b] * cRe;
        re[b] = re[a] - bRe;
        im[b] = im[a] - bIm;
        re[a] += bRe;
        im[a] += bIm;
        const nRe = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = nRe;
      }
    }
  }
}
