import { describe, it, expect } from 'vitest';
import { powerSpectrum, isPow2 } from '../src/lib/fft.js';
import { mulberry32 } from '../src/lib/rng.js';

describe('powerSpectrum', () => {
  it('2の冪以外は拒否する', () => {
    expect(isPow2(1024)).toBe(true);
    expect(isPow2(1000)).toBe(false);
    expect(() => powerSpectrum(new Float32Array(1000))).toThrow();
  });

  it('正弦波は正しいbinにピークが立つ', () => {
    const n = 1024;
    const sr = 8192;
    const x = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 1000 * i) / sr));
    const p = powerSpectrum(x);
    let best = 0;
    for (let k = 1; k < p.length; k++) if (p[k] > p[best]) best = k;
    expect(best).toBe(125);
  });

  it('全binの和は信号の平均パワーに近い(白色雑音)', () => {
    const rng = mulberry32(3);
    const n = 4096;
    let acc = 0;
    const trials = 20;
    for (let t = 0; t < trials; t++) {
      const x = new Float32Array(n).map(() => (rng() * 2 - 1) * 0.5);
      acc += powerSpectrum(x).reduce((a, b) => a + b, 0);
    }
    const variance = 0.25 / 3;
    expect(acc / trials).toBeCloseTo(variance, 2);
  });
});
