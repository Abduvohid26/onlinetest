/**
 * Real-time ovoz faolligi (VAD) — nutqqa o'xshash spektr + vaqt-domeni signallari.
 *
 * Oddiy RMS/ZCR yetarli emas (klaviatura, stul, shovqin ham "voiced" bo'lib qolardi).
 * Nutq diapazoni (180–3600 Hz) energiya ulushi + ZCR + spektr tekisligi ishlatiladi.
 */

export interface VoiceFrame {
  rms: number;
  zcr: number;
  /** Inson nutqiga o'xshash freym (shovqin emas). */
  humanVoice: boolean;
  speechRatio: number;
}

const RMS_VOICE = 0.038;
const ZCR_MIN = 0.022;
const ZCR_MAX = 0.19;
/** Nutq energiyasi umumiy spektrdagi minimal ulushi. */
const SPEECH_BAND_RATIO_MIN = 0.5;
/** Oq shovqin ko'proq tekis spektrga ega; nutq torroq diapazonda jamlanadi. */
const SPEECH_FLATNESS_MAX = 0.62;

function speechBandMetrics(analyser: AnalyserNode): { speechRatio: number; flatness: number } {
  const n = analyser.frequencyBinCount;
  const freq = new Uint8Array(n);
  analyser.getByteFrequencyData(freq);
  const sr = analyser.context.sampleRate;
  const binHz = sr / analyser.fftSize;

  let total = 0;
  let speech = 0;
  let geo = 0;
  let arith = 0;
  let used = 0;
  for (let i = 2; i < n; i++) {
    const e = (freq[i] || 0) / 255;
    if (e < 0.008) continue;
    total += e;
    used += 1;
    arith += e;
    geo += Math.log(e + 1e-7);
    const hz = i * binHz;
    if (hz >= 180 && hz <= 3600) speech += e;
  }
  const speechRatio = total > 0 ? speech / total : 0;
  const flatness = used > 0 && arith > 0 ? Math.exp(geo / used) / (arith / used) : 1;
  return { speechRatio, flatness };
}

export function analyzeVoiceFrame(analyser: AnalyserNode): VoiceFrame {
  const n = analyser.fftSize;
  const buf = new Uint8Array(n);
  analyser.getByteTimeDomainData(buf);

  let sumSq = 0;
  let crossings = 0;
  let prevSign = 0;
  for (let i = 0; i < n; i++) {
    const v = (buf[i] - 128) / 128;
    sumSq += v * v;
    const sign = v >= 0 ? 1 : -1;
    if (prevSign !== 0 && sign !== prevSign) crossings++;
    prevSign = sign;
  }
  const rms = Math.sqrt(sumSq / n);
  const zcr = crossings / n;
  const { speechRatio, flatness } = speechBandMetrics(analyser);

  const humanVoice =
    rms >= RMS_VOICE &&
    zcr >= ZCR_MIN &&
    zcr <= ZCR_MAX &&
    speechRatio >= SPEECH_BAND_RATIO_MIN &&
    flatness <= SPEECH_FLATNESS_MAX;

  return { rms, zcr, humanVoice, speechRatio };
}

/**
 * Faqat barqaror inson nutqi uchun ogohlantirish (tahrirlangan shovqin emas).
 */
export class VoiceActivityTracker {
  private voiceStreak = 0;
  private noiseFloor = 0.018;
  private calibrateLeft = 40;

  push(frame: VoiceFrame): 'WHISPER_OR_CONVERSATION_SUSPECTED' | null {
    if (this.calibrateLeft > 0) {
      this.noiseFloor = Math.max(this.noiseFloor, frame.rms * 0.85);
      this.calibrateLeft -= 1;
    }

    const aboveFloor = frame.rms > this.noiseFloor * 1.35;
    const isSpeech = frame.humanVoice && aboveFloor;

    if (isSpeech) {
      this.voiceStreak += 1;
      // ~1.2s barqaror nutq (200ms freym, 6 streak)
      if (this.voiceStreak >= 6) {
        this.voiceStreak = 0;
        return 'WHISPER_OR_CONVERSATION_SUSPECTED';
      }
    } else {
      this.voiceStreak = Math.max(0, this.voiceStreak - 1);
    }
    return null;
  }
}
