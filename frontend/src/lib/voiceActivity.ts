/**
 * Real-time ovoz faolligi (VAD) — oddiy chastota o'rtacha qiymati o'rniga.
 *
 * Vaqt-domeni (time-domain) signalidan RMS energiya + zero-crossing rate (ZCR)
 * hisoblaydi. Gapirish: barqaror energiya + nutqqa xos ZCR oralig'i. Bu shovqin,
 * mikrofon shitirlashi va qisqa taqillashlardan gapirishni ajratishga yordam beradi.
 */

export interface VoiceFrame {
  rms: number; // 0..1 normalized energiya
  zcr: number; // 0..1 zero-crossing nisbati
  voiced: boolean; // nutqqa o'xshash freym
  loud: boolean; // baland ovoz/shovqin
}

// Kalibrlash mumkin (env emas — oddiy konstantalar).
const RMS_VOICE = 0.045; // nutq energiyasi ostona
const RMS_LOUD = 0.14; // baland shovqin/ovoz
const ZCR_MIN = 0.02; // nutq ZCR oralig'i (gum/shovqin emas)
const ZCR_MAX = 0.22;

export function analyzeVoiceFrame(analyser: AnalyserNode): VoiceFrame {
  const n = analyser.fftSize;
  const buf = new Uint8Array(n);
  analyser.getByteTimeDomainData(buf);

  let sumSq = 0;
  let crossings = 0;
  let prevSign = 0;
  for (let i = 0; i < n; i++) {
    const v = (buf[i] - 128) / 128; // -1..1
    sumSq += v * v;
    const sign = v >= 0 ? 1 : -1;
    if (prevSign !== 0 && sign !== prevSign) crossings++;
    prevSign = sign;
  }
  const rms = Math.sqrt(sumSq / n);
  const zcr = crossings / n;

  const loud = rms >= RMS_LOUD;
  const voiced = rms >= RMS_VOICE && zcr >= ZCR_MIN && zcr <= ZCR_MAX;
  return { rms, zcr, voiced, loud };
}

/**
 * Ketma-ket "voiced" freymlarni hisoblab, barqaror gapirishni aniqlaydigan tracker.
 * Qisqa tasodifiy tovushlar ban bermasligi uchun streak talab qiladi.
 */
export class VoiceActivityTracker {
  private voicedStreak = 0;
  private loudStreak = 0;

  /** Freymni qabul qiladi; signal kerak bo'lsa qaytaradi, aks holda null. */
  push(frame: VoiceFrame): 'SUSPICIOUS_AUDIO' | 'WHISPER_OR_CONVERSATION_SUSPECTED' | null {
    if (frame.loud) {
      this.loudStreak += 1;
      this.voicedStreak = 0;
      if (this.loudStreak >= 2) {
        this.loudStreak = 0;
        return 'SUSPICIOUS_AUDIO';
      }
      return null;
    }
    this.loudStreak = 0;

    if (frame.voiced) {
      this.voicedStreak += 1;
      if (this.voicedStreak >= 3) {
        this.voicedStreak = 0;
        return 'WHISPER_OR_CONVERSATION_SUSPECTED';
      }
    } else {
      this.voicedStreak = Math.max(0, this.voicedStreak - 1);
    }
    return null;
  }
}
