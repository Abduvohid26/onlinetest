/**
 * Real-time ovoz faolligi (VAD) — faqat inson nutqi.
 *
 * Stul, klaviatura, eshik qarshiligi kabi qisqa impuls shovqinlarni filtrlash:
 * - past chastota ulushi (thud/scrape)
 * - yuqori crest factor (impuls)
 * - harmonik struktura (nutqda bor, shovqinda yo'q)
 *
 * Ikki holat:
 * 1) Talaba gapirsa — mikrofonda nutq + kamerada og'iz harakati.
 * 2) Orqada/yonda boshqa odam gapirsa — mikrofonda nutq, lekin talaba og'izi jim.
 */

export interface VoiceFrame {
  rms: number;
  zcr: number;
  /** Inson nutqiga o'xshash freym (impuls shovqin emas). */
  humanVoice: boolean;
  speechRatio: number;
  lowFreqRatio: number;
  crestFactor: number;
  harmonicity: number;
}

const RMS_VOICE = 0.042;
const ZCR_MIN = 0.024;
const ZCR_MAX = 0.17;
const SPEECH_BAND_RATIO_MIN = 0.52;
const SPEECH_FLATNESS_MAX = 0.58;
const LOW_FREQ_RATIO_MAX = 0.55;
const CREST_IMPULSE_MIN = 7.5;
const HARMONICITY_MIN = 0.3;

function speechBandMetrics(analyser: AnalyserNode): {
  speechRatio: number;
  flatness: number;
  lowFreqRatio: number;
} {
  const n = analyser.frequencyBinCount;
  const freq = new Uint8Array(n);
  analyser.getByteFrequencyData(freq);
  const sr = analyser.context.sampleRate;
  const binHz = sr / analyser.fftSize;

  let total = 0;
  let speech = 0;
  let low = 0;
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
    if (hz < 180) low += e;
    if (hz >= 180 && hz <= 3600) speech += e;
  }
  const speechRatio = total > 0 ? speech / total : 0;
  const lowFreqRatio = total > 0 ? low / total : 0;
  const flatness = used > 0 && arith > 0 ? Math.exp(geo / used) / (arith / used) : 1;
  return { speechRatio, flatness, lowFreqRatio };
}

/** 80–400 Hz oralig'ida harmonik signal bormi (nutq fundamental). */
function estimateHarmonicity(samples: Float32Array, sampleRate: number): number {
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 80);
  if (maxLag <= minLag + 2) return 0;

  let energy = 0;
  for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
  if (energy < 1e-6) return 0;

  let best = 0;
  for (let lag = minLag; lag <= maxLag && lag < samples.length - 1; lag++) {
    let corr = 0;
    const len = samples.length - lag;
    for (let i = 0; i < len; i++) corr += samples[i] * samples[i + lag];
    const norm = corr / len;
    if (norm > best) best = norm;
  }
  return Math.min(1, best / (energy / samples.length + 1e-7));
}

export function analyzeVoiceFrame(analyser: AnalyserNode): VoiceFrame {
  const n = analyser.fftSize;
  const buf = new Uint8Array(n);
  analyser.getByteTimeDomainData(buf);

  const floats = new Float32Array(n);
  let sumSq = 0;
  let peak = 0;
  let crossings = 0;
  let prevSign = 0;
  for (let i = 0; i < n; i++) {
    const v = (buf[i] - 128) / 128;
    floats[i] = v;
    sumSq += v * v;
    peak = Math.max(peak, Math.abs(v));
    const sign = v >= 0 ? 1 : -1;
    if (prevSign !== 0 && sign !== prevSign) crossings++;
    prevSign = sign;
  }
  const rms = Math.sqrt(sumSq / n);
  const zcr = crossings / n;
  const crestFactor = peak / (rms + 1e-7);
  const { speechRatio, flatness, lowFreqRatio } = speechBandMetrics(analyser);
  const harmonicity = estimateHarmonicity(floats, analyser.context.sampleRate);

  const notImpulse =
    lowFreqRatio <= LOW_FREQ_RATIO_MAX &&
    !(crestFactor >= CREST_IMPULSE_MIN && rms < 0.2);

  const humanVoice =
    rms >= RMS_VOICE &&
    zcr >= ZCR_MIN &&
    zcr <= ZCR_MAX &&
    speechRatio >= SPEECH_BAND_RATIO_MIN &&
    flatness <= SPEECH_FLATNESS_MAX &&
    harmonicity >= HARMONICITY_MIN &&
    notImpulse;

  return { rms, zcr, humanVoice, speechRatio, lowFreqRatio, crestFactor, harmonicity };
}

/**
 * Faqat barqaror inson nutqi uchun xom holat (stul/klaviatura impulslari emas).
 * Davomiylik (kichik→katta eskalatsiya) endi tashqarida `ContinuousSignalTracker`
 * bilan hisoblanadi — bu klass faqat shu freymda nutq bor-yo'qligini aytadi.
 */
export class VoiceActivityTracker {
  private noiseFloor = 0.018;
  private calibrateLeft = 45;
  private prevRms = 0;

  push(frame: VoiceFrame): boolean {
    if (this.calibrateLeft > 0) {
      this.noiseFloor = Math.max(this.noiseFloor, frame.rms * 0.85);
      this.calibrateLeft -= 1;
    }

    const spike = this.prevRms > 0.015 && frame.rms > this.prevRms * 3.2;
    this.prevRms = frame.rms * 0.65 + this.prevRms * 0.35;
    if (spike) return false;

    const aboveFloor = frame.rms > this.noiseFloor * 1.45;
    return frame.humanVoice && aboveFloor;
  }
}

const AMBIENT_RMS_MIN = 0.055;

/**
 * Baland tashqi shovqin (musiqa, televizor, eshik — inson nutqi emas) — xom holat.
 */
export class AmbientNoiseTracker {
  private noiseFloor = 0.018;
  private calibrateLeft = 45;
  private prevRms = 0;

  push(frame: VoiceFrame): boolean {
    if (this.calibrateLeft > 0) {
      this.noiseFloor = Math.max(this.noiseFloor, frame.rms * 0.85);
      this.calibrateLeft -= 1;
    }

    const spike = this.prevRms > 0.015 && frame.rms > this.prevRms * 3.2;
    this.prevRms = frame.rms * 0.65 + this.prevRms * 0.35;
    if (spike) return false;

    return (
      !frame.humanVoice &&
      frame.rms >= AMBIENT_RMS_MIN &&
      frame.rms > this.noiseFloor * 2.0 &&
      (frame.lowFreqRatio > 0.35 || frame.speechRatio < 0.45)
    );
  }
}

/** Og'iz/gapirish uchun yuz ko'rinadimi (WAITING va NO_FACE dan tashqari). */
export function isFaceVisibleForTalk(status: string): boolean {
  return status !== 'NO_FACE' && status !== 'MULTIPLE_FACES' && status !== 'WAITING';
}
