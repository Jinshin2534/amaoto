import { createRainSynth } from '../src/lib/synth.js';
import { analyzeFrame, summarize } from '../src/lib/features.js';

export const SR = 48000;
export const N = 2048;

/** 合成音を seconds 秒ぶん流して窓の要約を返す */
export function measure(opts, seconds = 4) {
  const synth = createRainSynth({ sampleRate: SR, ...opts });
  const frames = [];
  const count = Math.round((seconds * SR) / N);
  for (let i = 0; i < count; i++) frames.push(analyzeFrame(synth.next(N), SR, (i * N) / SR));
  return summarize(frames, SR);
}
