// マイク入力。ブラウザの自動音量・ノイズ除去は雨音そのものを消すので全部切る。

export async function createMic(onFrame) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext();
  await ctx.resume();
  await ctx.audioWorklet.addModule('/capture-worklet.js');
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'capture');
  node.port.onmessage = (e) => onFrame(e.data, ctx.sampleRate);
  source.connect(node);
  const track = stream.getAudioTracks()[0];
  return {
    sampleRate: ctx.sampleRate,
    label: track?.label ?? '',
    settings: track?.getSettings?.() ?? {},
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}
