/**
 * Mikrofondan uzluksiz PCM oqimini 512-sample'lik kadrlarga bo'lib beradi.
 *
 * Silero VAD 16 kHz da aynan 512 sample (32ms) talab qiladi. AudioWorklet
 * brauzerdan 128 sample'lik bloklar oladi — shularni to'plab, to'lgan sayin
 * asosiy oqimga yuboramiz.
 *
 * Nega AudioWorklet: `AnalyserNode` faqat ENG OXIRGI oynani beradi — sekin
 * poll qilinganda oradagi audio yo'qoladi (nutqning yarmi tushib qolardi).
 * Worklet esa hech bir sample'ni o'tkazib yubormaydi.
 */
class PcmFrameProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(512);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.frame[this.filled++] = channel[i];
      if (this.filled === this.frame.length) {
        // Nusxa yuboramiz — bufer keyingi kadr uchun qayta ishlatiladi.
        this.port.postMessage(this.frame.slice());
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-frame', PcmFrameProcessor);
