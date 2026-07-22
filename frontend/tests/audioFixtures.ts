/**
 * OFFLINE audio test fixtures — HALOL (honest) AnalyserNode emulyatsiyasi.
 *
 * Ilgari testda chastota binlari QO'LDA yozilardi (pcm'dan mustaqil) — bu "o'zimiz
 * o'ylagan spektr"ni tekshirardi, brauzer haqiqatda beradigan spektrni emas. Shu
 * sabab maishiy shovqin real qurilmada ovoz deb belgilanib qolardi.
 *
 * Bu yerda binlar PCM'dan HAQIQIY FFT bilan hisoblanadi va Web Audio'ning
 * `getByteFrequencyData` formulasi aynan takrorlanadi:
 *   Blackman oyna → FFT → mag = |X[k]| / fftSize → dB = 20*log10(mag)
 *   byte = 255 * (dB - minDecibels) / (maxDecibels - minDecibels)   [clamp 0..255]
 * (minDecibels = -100, maxDecibels = -30 — brauzer defaultlari.)
 */

export const FFT = 2048;
export const BINS = FFT / 2;
export const SR = 48000;

const MIN_DB = -100;
const MAX_DB = -30;

/** Iterativ radix-2 FFT (in-place, re/im massivlari). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** PCM → `getByteFrequencyData` bytelari (brauzerdagidek). */
export function pcmToBytes(pcm: Float32Array): Uint8Array {
  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);
  for (let i = 0; i < FFT; i++) {
    // Blackman oyna (Web Audio AnalyserNode aynan shuni qo'llaydi).
    const a = (2 * Math.PI * i) / (FFT - 1);
    const w = 0.42 - 0.5 * Math.cos(a) + 0.08 * Math.cos(2 * a);
    re[i] = (pcm[i] || 0) * w;
  }
  fft(re, im);
  const out = new Uint8Array(BINS);
  for (let k = 0; k < BINS; k++) {
    const mag = Math.hypot(re[k], im[k]) / FFT;
    const db = 20 * Math.log10(mag + 1e-12);
    const v = Math.round((255 * (db - MIN_DB)) / (MAX_DB - MIN_DB));
    out[k] = Math.max(0, Math.min(255, v));
  }
  return out;
}

/** Sintetik PCM'dan to'liq AnalyserNode mock (vaqt + chastota izchil). */
export function analyserFor(pcm: Float32Array): AnalyserNode {
  const bins = pcmToBytes(pcm);
  return {
    fftSize: FFT,
    frequencyBinCount: BINS,
    context: { sampleRate: SR },
    getByteTimeDomainData(arr: Uint8Array) {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.max(0, Math.min(255, Math.round((pcm[i] || 0) * 128 + 128)));
      }
    },
    getByteFrequencyData(arr: Uint8Array) {
      arr.set(bins.subarray(0, arr.length));
    },
  } as unknown as AnalyserNode;
}

export function scaleToRms(pcm: Float32Array, targetRms: number): Float32Array {
  let s = 0;
  for (const v of pcm) s += v * v;
  const rms = Math.sqrt(s / pcm.length) || 1;
  const k = targetRms / rms;
  for (let i = 0; i < pcm.length; i++) pcm[i] *= k;
  return pcm;
}

/** Takrorlanadigan (deterministik) tasodifiy generator. */
export function rng(seed = 12345) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0xffffffff) * 2 - 1;
  };
}

// ---------------------------------------------------------------------------
// ODAM OVOZI
// ---------------------------------------------------------------------------

/**
 * Ovozli (voiced) nutq bo'lagi: f0 + ohanglar, formant (vokal trakt) filtri bilan.
 * Real nutqdek: energiya 180–3500 Hz da, spektrda f0 qadamli "taroq" tuzilma.
 * @param jitter f0 ning tabiiy tebranishi (real nutqda 0 emas)
 */
export function voicedSpeech(rms: number, f0 = 130, jitter = 0.02): Float32Array {
  const pcm = new Float32Array(FFT);
  const r = rng(7);
  // Formantlar (erkak "a" unlisi taxminan): F1≈700, F2≈1220, F3≈2600.
  const formants = [
    { f: 700, bw: 130, g: 1.0 },
    { f: 1220, bw: 160, g: 0.7 },
    { f: 2600, bw: 220, g: 0.4 },
  ];
  let phase = 0;
  for (let i = 0; i < FFT; i++) {
    const t = i / SR;
    const f = f0 * (1 + jitter * Math.sin(2 * Math.PI * 5 * t) + 0.004 * r());
    phase += (2 * Math.PI * f) / SR;
    let v = 0;
    for (let k = 1; k <= 30; k++) {
      const hz = f * k;
      if (hz > 5000) break;
      // Manba spektri -12 dB/oktava + formant rezonanslari.
      let g = 1 / (k * k * 0.35 + 1);
      let fg = 0.08;
      for (const fm of formants) {
        fg += fm.g / (1 + Math.pow((hz - fm.f) / fm.bw, 2));
      }
      g *= fg;
      v += g * Math.sin(k * phase);
    }
    pcm[i] = v;
  }
  return scaleToRms(pcm, rms);
}

/** Shivirlash / ovozsiz (unvoiced) bo'lak — nutq bandidagi filtrlangan shovqin. */
export function whisper(rms: number): Float32Array {
  const pcm = new Float32Array(FFT);
  const r = rng(21);
  let bp = 0;
  let lp = 0;
  for (let i = 0; i < FFT; i++) {
    const x = r();
    lp = lp * 0.7 + x * 0.3; // past o'tkazgich
    bp = x - lp; // yuqori qismi → shivirlash "sh" tovushi
    pcm[i] = bp;
  }
  return scaleToRms(pcm, rms);
}

// ---------------------------------------------------------------------------
// MAISHIY SHOVQINLAR (bularning HECH BIRI ovoz deb belgilanmasligi kerak)
// ---------------------------------------------------------------------------

/** Ventilyator / konditsioner / kompyuter kuleri — barqaror past gurillash. */
export function fanHum(rms: number): Float32Array {
  const pcm = new Float32Array(FFT);
  const r = rng(101);
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < FFT; i++) {
    const t = i / SR;
    const x = r();
    lp1 = lp1 * 0.96 + x * 0.04;
    lp2 = lp2 * 0.96 + lp1 * 0.04;
    // 50 Hz tarmoq gurillashi + qanot chastotasi
    pcm[i] = lp2 * 40 + 0.25 * Math.sin(2 * Math.PI * 50 * t) + 0.1 * Math.sin(2 * Math.PI * 120 * t);
  }
  return scaleToRms(pcm, rms);
}

/** Klaviatura bosilishi — qisqa, keskin impulslar ketma-ketligi. */
export function keyboardTyping(rms: number): Float32Array {
  const pcm = new Float32Array(FFT);
  const r = rng(303);
  for (const start of [120, 640, 1180, 1700]) {
    for (let i = 0; i < 90 && start + i < FFT; i++) {
      pcm[start + i] = r() * Math.exp(-i / 14);
    }
  }
  return scaleToRms(pcm, rms);
}

/** Idish-tovoq shaqirlashi — yuqori chastotali qisqa portlashlar. */
export function dishesClatter(rms: number): Float32Array {
  const pcm = new Float32Array(FFT);
  const r = rng(404);
  for (const start of [200, 900, 1500]) {
    for (let i = 0; i < 200 && start + i < FFT; i++) {
      const env = Math.exp(-i / 45);
      pcm[start + i] =
        env * (0.6 * Math.sin((2 * Math.PI * 5200 * i) / SR) + 0.4 * r());
    }
  }
  return scaleToRms(pcm, rms);
}

/** Eshik yopilishi / stol urilishi — bitta kuchli past impuls ("taq"). */
export function doorSlam(rms: number): Float32Array {
  const pcm = new Float32Array(FFT);
  for (let i = 0; i < 300; i++) {
    pcm[150 + i] = Math.exp(-i / 55) * Math.sin((2 * Math.PI * 90 * i) / SR);
  }
  return scaleToRms(pcm, rms);
}

/** Ko'chа/transport gurillashi — keng polosali, pastga og'ishgan. */
export function trafficRumble(rms: number): Float32Array {
  const pcm = new Float32Array(FFT);
  const r = rng(505);
  let lp = 0;
  for (let i = 0; i < FFT; i++) {
    lp = lp * 0.9 + r() * 0.1;
    pcm[i] = lp;
  }
  return scaleToRms(pcm, rms);
}

/** Oq shovqin (radio "shipillashi", havolantirgich). */
export function whiteNoise(rms: number): Float32Array {
  const pcm = new Float32Array(FFT);
  const r = rng(606);
  for (let i = 0; i < FFT; i++) pcm[i] = r();
  return scaleToRms(pcm, rms);
}

/**
 * Musiqa (cholg'u) — davriy, LEKIN nutq emas: INGARMONIK akkord (C-dur: C4/E4/G4).
 * Bir necha mustaqil f0 → autokorrelyatsiya cho'qqisi nutqdagidek toza chiqmaydi.
 */
export function instrumentalMusic(rms: number): Float32Array {
  const pcm = new Float32Array(FFT);
  const notes = [261.6, 329.6, 392.0]; // C4, E4, G4 — o'zaro karrali emas
  for (let i = 0; i < FFT; i++) {
    const t = i / SR;
    let v = 0;
    for (const f of notes) {
      v += Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(2 * Math.PI * f * 2 * t)
        + 0.15 * Math.sin(2 * Math.PI * f * 3 * t);
    }
    pcm[i] = v;
  }
  return scaleToRms(pcm, rms);
}

/**
 * REAL SHAROIT: signal + xona fon shovqini (SNR bilan). Sintetik "mукammal"
 * signal aldamchi — mikrofonda hamma narsa shovqin ustida keladi.
 */
export function mix(signal: Float32Array, noise: Float32Array, snrDb: number): Float32Array {
  const e = (a: Float32Array) => {
    let s = 0;
    for (const v of a) s += v * v;
    return Math.sqrt(s / a.length) || 1e-9;
  };
  const sRms = e(signal);
  const nWant = sRms / Math.pow(10, snrDb / 20);
  const k = nWant / e(noise);
  const out = new Float32Array(signal.length);
  for (let i = 0; i < out.length; i++) out[i] = signal[i] + noise[i] * k;
  return scaleToRms(out, sRms);
}

/**
 * Devor ortidan / uzoqdan eshitilayotgan odam ovozi — yuqori chastotalar
 * so'nadi (past o'tkazgich), lekin f0 davriyligi saqlanadi.
 */
export function muffledSpeech(rms: number, f0 = 130): Float32Array {
  const src = voicedSpeech(1, f0);
  const out = new Float32Array(FFT);
  let lp = 0;
  for (let i = 0; i < FFT; i++) {
    lp = lp * 0.82 + src[i] * 0.18;
    out[i] = lp;
  }
  return scaleToRms(out, rms);
}

/** Sof ton / signal (mikrovolnovka "pip", telefon signali). */
export function pureTone(rms: number, hz = 1000): Float32Array {
  const pcm = new Float32Array(FFT);
  for (let i = 0; i < FFT; i++) pcm[i] = Math.sin((2 * Math.PI * hz * i) / SR);
  return scaleToRms(pcm, rms);
}

/** Qog'oz shitirlashi / kiyim ishqalanishi — yumshoq yuqori chastotali shovqin. */
export function paperRustle(rms: number): Float32Array {
  const pcm = new Float32Array(FFT);
  const r = rng(707);
  let prev = 0;
  for (let i = 0; i < FFT; i++) {
    const x = r();
    pcm[i] = x - prev; // differensiator → yuqori chastota
    prev = x;
  }
  return scaleToRms(pcm, rms);
}
