import { describe, it, expect } from 'vitest';
import { estimate, fmtRate, intensityLabel } from '../src/lib/estimate.js';
import { fitModel, makeRainPoint } from '../src/lib/model.js';
import { measure } from './helpers.js';

const rainSummary = { power: 1e-5, flatness: 0.9, tonalFraction: 0, blockCv: 0.1, blocks: 8 };
const bg = { power: 1e-6 };
const model = fitModel([{ rate: 4, excess: 9e-6 }]);

describe('estimate の正直さ', () => {
  it('背景が無ければ数値を出さない', () => {
    const e = estimate({ summary: rainSummary, background: null, model: null });
    expect(e.status).toBe('no-background');
    expect(e.rate).toBeUndefined();
  });

  it('雨の校正が無ければ dB 差だけ出して数値は出さない', () => {
    const e = estimate({ summary: rainSummary, background: bg, model: null });
    expect(e.status).toBe('no-rain-cal');
    expect(e.excessDb).toBeCloseTo(10, 6);
    expect(e.rate).toBeUndefined();
  });

  it('背景と区別できなければ検出下限を言う', () => {
    const e = estimate({ summary: { ...rainSummary, power: 1.1e-6 }, background: bg, model });
    expect(e.status).toBe('below-floor');
    expect(e.floorRate).toBeGreaterThan(0);
    expect(e.message).toMatch(/未満/);
  });

  it('倍音だらけ・途切れ途切れの音は推定しない', () => {
    expect(estimate({ summary: { ...rainSummary, tonalFraction: 0.5 }, background: bg, model }).status).toBe('not-rain');
    expect(estimate({ summary: { ...rainSummary, blockCv: 1.2 }, background: bg, model }).status).toBe('not-rain');
  });

  it('校正と同じ音なら校正の雨量を返し、幅がそれを含む', () => {
    const e = estimate({ summary: rainSummary, background: bg, model });
    expect(e.status).toBe('ok');
    expect(e.rate).toBeCloseTo(4, 6);
    expect(e.lo).toBeLessThan(4);
    expect(e.hi).toBeGreaterThan(4);
    expect(e.extrapolated).toBe(false);
  });

  it('校正範囲から大きく外れたら外挿と明示する', () => {
    const e = estimate({ summary: { ...rainSummary, power: 1e-2 }, background: bg, model });
    expect(e.status).toBe('ok');
    expect(e.extrapolated).toBe(true);
    expect(e.message).toMatch(/外挿/);
  });

  it('ゆらぎが大きい窓ほど幅が広い', () => {
    const calm = estimate({ summary: rainSummary, background: bg, model });
    const shaky = estimate({ summary: { ...rainSummary, blockCv: 0.5 }, background: bg, model });
    expect(shaky.hi / shaky.lo).toBeGreaterThan(calm.hi / calm.lo);
  });
});

describe('合成の雨で端から端まで(背景→雨1回で校正→別の雨量を推定)', () => {
  const background = measure({ rate: 0, seed: 100 }, 10);
  const cal = makeRainPoint(measure({ rate: 5, seed: 101 }, 10), background, 5);
  const m = fitModel([cal.point]);

  it.each([
    [2, 102],
    [5, 103],
    [12, 104],
    [30, 105],
  ])('%s mm/h の雨は幅の中に入り、中心も 1.5 倍以内', (rate, seed) => {
    const e = estimate({ summary: measure({ rate, seed }, 4), background, model: m });
    expect(e.status).toBe('ok');
    expect(e.lo).toBeLessThanOrEqual(rate);
    expect(e.hi).toBeGreaterThanOrEqual(rate);
    expect(e.rate / rate).toBeGreaterThan(1 / 1.5);
    expect(e.rate / rate).toBeLessThan(1.5);
  });

  it('雨なしは背景と区別できない扱い', () => {
    const e = estimate({ summary: measure({ rate: 0, seed: 106 }, 4), background, model: m });
    expect(e.status).toBe('below-floor');
  });

  it('話し声だけなら雨音らしくないと言う', () => {
    const e = estimate({ summary: measure({ rate: 0, voice: true, seed: 107 }, 4), background, model: m });
    expect(e.status).toBe('not-rain');
  });

  it('窓やマイクが違っても(全体が6dB大きくても)校正すれば同じ雨量に戻る', () => {
    const bg2 = measure({ rate: 0, seed: 200, gain: 2 }, 10);
    const m2 = fitModel([makeRainPoint(measure({ rate: 5, seed: 201, gain: 2 }, 10), bg2, 5).point]);
    const e = estimate({ summary: measure({ rate: 12, seed: 202, gain: 2 }, 4), background: bg2, model: m2 });
    expect(e.rate / 12).toBeGreaterThan(1 / 1.5);
    expect(e.rate / 12).toBeLessThan(1.5);
  });

  it('本当の傾きが仮定とずれていても(p=1.6)、幅は真値を含む', () => {
    const o = { ampExp: 0.3 };
    const bg3 = measure({ rate: 0, seed: 300, ...o }, 10);
    const m3 = fitModel([makeRainPoint(measure({ rate: 5, seed: 301, ...o }, 10), bg3, 5).point]);
    const e = estimate({ summary: measure({ rate: 20, seed: 302, ...o }, 4), background: bg3, model: m3 });
    expect(e.lo).toBeLessThanOrEqual(20);
    expect(e.hi).toBeGreaterThanOrEqual(20);
  });
});

describe('表示', () => {
  it('桁', () => {
    expect(fmtRate(0.456)).toBe('0.46');
    expect(fmtRate(3.21)).toBe('3.2');
    expect(fmtRate(23.6)).toBe('24');
    expect(fmtRate(NaN)).toBe('—');
  });
  it('気象庁の用語', () => {
    expect(intensityLabel(0)).toBe('雨なし');
    expect(intensityLabel(2)).toBe('弱い雨');
    expect(intensityLabel(25)).toBe('強い雨');
    expect(intensityLabel(85)).toBe('猛烈な雨');
  });
});
