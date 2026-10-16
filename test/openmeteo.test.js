import { describe, it, expect } from 'vitest';
import { buildUrl, parseCurrent, compare } from '../src/lib/openmeteo.js';

describe('Open-Meteo', () => {
  it('URL に current=precipitation が入る', () => {
    const u = new URL(buildUrl(35.6812, 139.7671));
    expect(u.hostname).toBe('api.open-meteo.com');
    expect(u.searchParams.get('current')).toContain('precipitation');
    expect(u.searchParams.get('latitude')).toBe('35.681');
  });

  it('15分合計 mm を時間雨量に直す', () => {
    const r = parseCurrent({ current: { time: '2026-10-16T21:00', interval: 900, precipitation: 0.5 } });
    expect(r.mmPerHour).toBeCloseTo(2, 9);
    expect(r.intervalSec).toBe(900);
  });

  it('interval が無ければ15分とみなす / current が無ければエラー', () => {
    expect(parseCurrent({ current: { precipitation: 1 } }).mmPerHour).toBe(4);
    expect(() => parseCurrent({})).toThrow();
  });
});

describe('compare', () => {
  const ok = { status: 'ok', rate: 4, lo: 2, hi: 8 };
  it('幅の中なら一致', () => {
    expect(compare(ok, 3).verdict).toBe('match');
  });
  it('外れたら何倍か', () => {
    expect(compare(ok, 1).verdict).toBe('over');
    expect(compare(ok, 1).text).toContain('4.0');
    expect(compare(ok, 16).verdict).toBe('under');
  });
  it('Open-Meteo が0なら比をとらない', () => {
    expect(compare(ok, 0).verdict).toBe('ref-zero');
  });
  it('検出下限未満どうしは一致、Open-Meteo だけ雨なら聞き逃し', () => {
    const below = { status: 'below-floor', floorRate: 0.5 };
    expect(compare(below, 0).verdict).toBe('match');
    expect(compare(below, 3).verdict).toBe('miss');
  });
  it('推定が無ければ比べない', () => {
    expect(compare({ status: 'no-background' }, 3).verdict).toBe('none');
  });
});
