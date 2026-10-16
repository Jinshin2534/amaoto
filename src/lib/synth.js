// 合成の雨音。実機のマイクや雨の日がなくても、推定の経路を端から端まで通すためのもの。
// 雨粒 = 減衰する雑音の粒。数は雨量に比例し(100 粒/秒 per mm/h)、一粒の振幅は R^0.15 で大きくなる。
// したがって雨帯域のパワーは R^1.3 に比例する(model.js の仮定 p=1.3 と同じ形。テストではわざと崩しもする)。

import { mulberry32 } from './rng.js';

export const DROPS_PER_MMH = 100;

/**
 * @param {object} o
 * @param {number} o.sampleRate
 * @param {number} o.rate 雨量 mm/h(0 で雨なし)
 * @param {number} [o.seed]
 * @param {number} [o.ambient] 背景(低いうなり・マイク雑音・ハム)の大きさ倍率。0 で無音
 * @param {number} [o.gain] 窓やマイクの違い(雨音全体の倍率)
 * @param {number} [o.ampExp] 一粒の振幅の雨量依存 R^ampExp(既定 0.15 → パワー ∝ R^1.3)
 * @param {boolean} [o.voice] 人の声のような倍音+途切れを混ぜる
 */
export function createRainSynth({ sampleRate, rate, seed = 1, ambient = 1, gain = 1, ampExp = 0.15, voice = false }) {
  const rng = mulberry32(seed);
  const gauss = () => {
    const u = 1 - rng();
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const s = {
    rate,
    nextDrop: 0,
    drops: [],
    lp: 0,
    hp: 0,
    t: 0,
    voicePhase: 0,
    voiceOn: false,
    voiceUntil: 0,
  };
  const lpA = Math.exp((-2 * Math.PI * 200) / sampleRate);
  const tau = 0.003 * sampleRate;
  const decay = Math.exp(-1 / tau);

  function scheduleNext() {
    const lambda = DROPS_PER_MMH * s.rate;
    s.nextDrop = lambda > 0 ? s.t - Math.log(1 - rng()) / lambda : Infinity;
  }
  scheduleNext();

  return {
    setRate(r) {
      s.rate = r;
      scheduleNext();
    },
    get rate() {
      return s.rate;
    },
    /** n サンプルを生成 */
    next(n) {
      const out = new Float32Array(n);
      const dt = 1 / sampleRate;
      for (let i = 0; i < n; i++) {
        while (s.t >= s.nextDrop) {
          const a = 0.03 * gain * Math.max(s.rate, 1e-6) ** ampExp * Math.exp(0.4 * gauss() - 0.08);
          s.drops.push({ a });
          const lambda = DROPS_PER_MMH * s.rate;
          s.nextDrop += -Math.log(1 - rng()) / lambda;
        }
        let x = 0;
        for (let d = s.drops.length - 1; d >= 0; d--) {
          const drop = s.drops[d];
          x += drop.a * (rng() * 2 - 1) * 1.732;
          drop.a *= decay;
          if (drop.a < 1e-6) s.drops.splice(d, 1);
        }
        // 窓ガラスを通ると低域が抜ける: 1次差分で軽く高域寄りに
        const y = x - 0.5 * s.hp;
        s.hp = x;
        let v = y;
        if (ambient > 0) {
          s.lp = lpA * s.lp + (1 - lpA) * gauss();
          v += ambient * (0.1 * s.lp + 0.0015 * gauss() + 0.01 * Math.sin(2 * Math.PI * 50 * s.t));
        }
        if (voice) {
          if (s.t >= s.voiceUntil) {
            s.voiceOn = !s.voiceOn;
            s.voiceUntil = s.t + (s.voiceOn ? 0.2 + 0.3 * rng() : 0.1 + 0.4 * rng());
          }
          if (s.voiceOn) {
            const f0 = 140 + 25 * Math.sin(2 * Math.PI * 3 * s.t);
            s.voicePhase += 2 * Math.PI * f0 * dt;
            let vv = 0;
            for (let h = 1; h <= 30; h++) vv += Math.sin(h * s.voicePhase) / h;
            v += 0.08 * vv;
          }
        }
        out[i] = v;
        s.t += dt;
      }
      return out;
    },
  };
}
