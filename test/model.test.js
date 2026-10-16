import { describe, it, expect } from 'vitest';
import { fitModel, makeRainPoint, rateFromExcess, rateWithRange, excessDb, P_ASSUMED } from '../src/lib/model.js';

const pt = (rate, excess) => ({ rate, excess, excessDb: 10 });

describe('makeRainPoint', () => {
  const bg = { power: 1e-6 };
  it('背景なし・基準0は拒否', () => {
    expect(makeRainPoint({ power: 1e-4 }, null, 3).ok).toBe(false);
    expect(makeRainPoint({ power: 1e-4 }, bg, 0).ok).toBe(false);
  });
  it('背景との差が3dB未満なら校正しない', () => {
    const r = makeRainPoint({ power: 1.5e-6 }, bg, 3);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/dB/);
  });
  it('十分大きければ超過パワーを記録する', () => {
    const r = makeRainPoint({ power: 1e-5 }, bg, 3);
    expect(r.ok).toBe(true);
    expect(r.point.excess).toBeCloseTo(9e-6, 12);
    expect(r.point.excessDb).toBeCloseTo(10, 6);
  });
});

describe('fitModel', () => {
  it('点が無ければ null', () => {
    expect(fitModel([])).toBeNull();
  });

  it('1点なら p は仮定で、校正点ではその雨量を返す', () => {
    const m = fitModel([pt(4, 1e-5)]);
    expect(m.fitted).toBe(false);
    expect(m.p).toBe(P_ASSUMED);
    expect(rateFromExcess(m, 1e-5)).toBeCloseTo(4, 9);
  });

  it('1点の幅は校正点で狭く、離れるほど広い', () => {
    const m = fitModel([pt(4, 1e-5)]);
    const near = rateWithRange(m, 1e-5);
    const far = rateWithRange(m, 1e-3);
    expect(near.lo).toBeLessThan(4);
    expect(near.hi).toBeGreaterThan(4);
    expect(far.hi / far.lo).toBeGreaterThan((near.hi / near.lo) * 2);
  });

  it('雨量が離れた2点以上なら傾きを当てる', () => {
    const p = 1.5;
    const pts = [1, 4, 16].map((r) => pt(r, 2e-6 * r ** p));
    const m = fitModel(pts);
    expect(m.fitted).toBe(true);
    expect(m.p).toBeCloseTo(1.5, 6);
    expect(rateFromExcess(m, 2e-6 * 8 ** p)).toBeCloseTo(8, 6);
  });

  it('雨量がほぼ同じ点ばかりなら傾きは決めない(仮定のまま)', () => {
    const m = fitModel([pt(3, 1e-5), pt(4, 1.2e-5)]);
    expect(m.fitted).toBe(false);
    expect(m.p).toBe(P_ASSUMED);
  });

  it('おかしな傾きはクランプする', () => {
    const m = fitModel([pt(1, 1e-5), pt(10, 1.01e-5), pt(100, 1.02e-5)]);
    expect(m.p).toBeGreaterThanOrEqual(0.5);
  });
});

describe('excessDb', () => {
  it('10倍で10dB', () => {
    expect(excessDb(1e-5, 1e-6)).toBeCloseTo(10, 9);
  });
});
