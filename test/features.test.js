import { describe, it, expect } from 'vitest';
import { bandPower, spectralFlatness, summarize, analyzeFrame, displayBands, DISPLAY_BANDS } from '../src/lib/features.js';
import { mulberry32 } from '../src/lib/rng.js';
import { measure, SR, N } from './helpers.js';

describe('bandPower / spectralFlatness', () => {
  it('帯域外は数えない', () => {
    const psd = new Float64Array(1024).fill(1);
    // bin幅 = 48000/2048 ≈ 23.4 Hz → 1000〜2000Hz は約43bin
    const p = bandPower(psd, SR, 1000, 2000);
    expect(p).toBeGreaterThan(40);
    expect(p).toBeLessThan(46);
  });

  it('平らなスペクトルは平坦度1、1本だけ立つと0に近い', () => {
    const flat = new Float64Array(1024).fill(2);
    expect(spectralFlatness(flat, SR, 1000, 8000)).toBeCloseTo(1, 6);
    const peaky = new Float64Array(1024).fill(1e-9);
    peaky[100] = 1;
    expect(spectralFlatness(peaky, SR, 1000, 8000)).toBeLessThan(0.05);
  });

  it('表示バンドは決まった本数で有限値', () => {
    const b = displayBands(new Float64Array(1024).fill(1e-6), SR);
    expect(b).toHaveLength(DISPLAY_BANDS);
    expect(b.every(Number.isFinite)).toBe(true);
  });
});

describe('summarize', () => {
  it('空なら null', () => {
    expect(summarize([], SR)).toBeNull();
  });

  it('白色雑音は平坦で定常', () => {
    const rng = mulberry32(5);
    const frames = [];
    for (let i = 0; i < 90; i++) {
      const x = new Float32Array(N).map(() => rng() * 2 - 1);
      frames.push(analyzeFrame(x, SR, (i * N) / SR));
    }
    const s = summarize(frames, SR);
    expect(s.flatness).toBeGreaterThan(0.5);
    expect(s.blockCv).toBeLessThan(0.1);
    expect(s.blocks).toBeGreaterThanOrEqual(7);
  });

  it('合成の雨は平坦で定常、声は倍音か途切れで引っかかる', () => {
    const rain = measure({ rate: 3, ambient: 1, seed: 7 });
    expect(rain.flatness).toBeGreaterThan(0.3);
    expect(rain.blockCv).toBeLessThan(0.3);
    expect(rain.tonalFraction).toBeLessThan(0.05);
    const voice = measure({ rate: 0, ambient: 1, voice: true, seed: 7 });
    expect(voice.tonalFraction).toBeGreaterThan(0.3);
  });

  it('ときどき鳴る音には中央値で引っぱられにくい(平均よりは小さい)', () => {
    const rng = mulberry32(9);
    const frames = [];
    for (let i = 0; i < 94; i++) {
      const t = (i * N) / SR;
      // 4秒のうち最初の1秒だけ大きな音
      const amp = t < 1 ? 1 : 0.1;
      const x = new Float32Array(N).map(() => (rng() * 2 - 1) * amp);
      frames.push(analyzeFrame(x, SR, t));
    }
    const s = summarize(frames, SR);
    expect(s.meanPower / s.power).toBeGreaterThan(10);
  });

  it('雨量が増えると雨帯域のパワーが増える(単調)', () => {
    const ps = [0.5, 2, 8, 32].map((rate) => measure({ rate, ambient: 0, seed: 11 }).power);
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThan(ps[i - 1]);
  });

  it('合成雨のパワーは R^1.3 に乗る(log-log の傾き)', () => {
    const a = measure({ rate: 1, ambient: 0, seed: 2 }, 6).power;
    const b = measure({ rate: 16, ambient: 0, seed: 3 }, 6).power;
    const slope = Math.log10(b / a) / Math.log10(16);
    expect(slope).toBeGreaterThan(1.15);
    expect(slope).toBeLessThan(1.45);
  });
});
