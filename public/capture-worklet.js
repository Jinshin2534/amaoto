// 128 サンプルずつ来る入力を 2048 サンプルのフレームにまとめてメインスレッドへ送る。
// rAF と違い、タブが裏に回っても抜けや重複なく全サンプルが届く。
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 2048;
    this.buf = new Float32Array(this.size);
    this.pos = 0;
  }
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.pos++] = ch[i];
        if (this.pos === this.size) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(this.size);
          this.pos = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('capture', CaptureProcessor);
