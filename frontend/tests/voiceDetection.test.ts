/**
 * Ovoz aniqlash (analyzeVoiceFrame) — sintetik signallar bilan OFFLINE tekshiruv.
 *
 * Maqsad: "odam ovozi" va "shovqin"ni ajratish mantig'ini jonli mikrofonsiz,
 * takrorlanadigan tarzda sinash. Signallar matematik yasaladi:
 *   - Ovoz  → harmonik yig'indi (f0 + ohanglar) → yuqori harmonicity, nutq-bandida energiya
 *   - Shovqin → tasodifiy/past-chastotali → past harmonicity, tekis spektr
 *   - "Taq"  → bitta impuls → yuqori crest factor
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVoiceFrame } from '../src/lib/voiceActivity.ts';

const FFT = 2048;
const BINS = FFT / 2;
const SR = 48000;
const BIN_HZ = SR / FFT; // ~23.4 Hz

/** AnalyserNode mock — sintetik vaqt va chastota ma'lumotlari bilan. */
function mockAnalyser(pcm: Float32Array, bins: Uint8Array): AnalyserNode {
  return {
    fftSize: FFT,
    frequencyBinCount: BINS,
    context: { sampleRate: SR },
    getByteTimeDomainData(arr: Uint8Array) {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.max(0, Math.min(255, Math.round(pcm[i] * 128 + 128)));
      }
    },
    getByteFrequencyData(arr: Uint8Array) {
      arr.set(bins.subarray(0, arr.length));
    },
  } as unknown as AnalyserNode;
}

function scaleToRms(pcm: Float32Array, targetRms: number): Float32Array {
  let s = 0;
  for (const v of pcm) s += v * v;
  const rms = Math.sqrt(s / pcm.length) || 1;
  const k = targetRms / rms;
  for (let i = 0; i < pcm.length; i++) pcm[i] *= k;
  return pcm;
}

/** Inson ovozi: f0 + ohanglar (davriy → yuqori autokorrelyatsiya). */
function voicePcm(targetRms: number, f0 = 130): Float32Array {
  const pcm = new Float32Array(FFT);
  for (let i = 0; i < FFT; i++) {
    const t = i / SR;
    let v = 0;
    for (let k = 1; k <= 8; k++) v += Math.sin(2 * Math.PI * f0 * k * t) / k;
    pcm[i] = v;
  }
  return scaleToRms(pcm, targetRms);
}

/** Shovqin: tasodifiy. `smooth` (0..0.95) — past chastotaga siljitadi (fan/gurillash). */
function noisePcm(targetRms: number, smooth = 0): Float32Array {
  const pcm = new Float32Array(FFT);
  let prev = 0;
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };
  for (let i = 0; i < FFT; i++) {
    const r = rnd();
    prev = smooth > 0 ? prev * smooth + r * (1 - smooth) : r;
    pcm[i] = prev;
  }
  return scaleToRms(pcm, targetRms);
}

/** "Taq" — bitta keskin impuls (yuqori crest factor). */
function tapPcm(targetRms: number): Float32Array {
  const pcm = new Float32Array(FFT);
  for (let i = 0; i < 40; i++) pcm[100 + i] = Math.exp(-i / 8);
  return scaleToRms(pcm, targetRms);
}

/** Spektr binlarini shakl funksiyasidan yasaydi (0..1 → 0..255). */
function makeBins(shape: (hz: number) => number): Uint8Array {
  const b = new Uint8Array(BINS);
  for (let i = 0; i < BINS; i++) {
    b[i] = Math.max(0, Math.min(255, Math.round(shape(i * BIN_HZ) * 255)));
  }
  return b;
}

/** Ovoz spektri: energiya nutq bandida (180–3600 Hz), ohang cho'qqilari bilan. */
const voiceBins = makeBins((hz) => {
  if (hz < 150) return 0.04;
  if (hz > 4000) return 0.02;
  const harmonicPeak = 0.5 + 0.45 * Math.abs(Math.cos((hz / 130) * Math.PI));
  return 0.75 * harmonicPeak;
});

/** Shovqin spektri: keng polosali, pastga og'ishgan, tekis (flat). */
const noiseBins = makeBins((hz) => (hz < 180 ? 0.75 : hz < 4000 ? 0.42 : 0.3));

function metrics(pcm: Float32Array, bins: Uint8Array) {
  return analyzeVoiceFrame(mockAnalyser(pcm, bins));
}

function show(name: string, f: ReturnType<typeof analyzeVoiceFrame>) {
  // Sozlash uchun o'lchangan qiymatlarni chiqaramiz (test loglarida ko'rinadi).
  console.log(
    `${name.padEnd(22)} rms=${f.rms.toFixed(3)} zcr=${f.zcr.toFixed(3)} ` +
      `sp=${f.speechRatio.toFixed(2)} low=${f.lowFreqRatio.toFixed(2)} ` +
      `crest=${f.crestFactor.toFixed(1)} harm=${f.harmonicity.toFixed(2)} ` +
      `=> voice=${f.humanVoice}`,
  );
}

describe('analyzeVoiceFrame — sintetik signallar', () => {
  it('normal balandlikdagi inson ovozini ANIQLAYDI', () => {
    const f = metrics(voicePcm(0.09), voiceBins);
    show('ovoz (normal)', f);
    assert.equal(f.humanVoice, true, 'normal ovoz aniqlanishi kerak');
  });

  it('sekin/uzoqdagi (tashqi) inson ovozini ham ANIQLAYDI', () => {
    const f = metrics(voicePcm(0.04), voiceBins);
    show('ovoz (uzoq/sekin)', f);
    assert.equal(f.humanVoice, true, 'uzoq/sekin ovoz ham aniqlanishi kerak');
  });

  it('jimlikni ovoz deb hisoblamaydi', () => {
    const f = metrics(voicePcm(0.004), voiceBins);
    show('jimlik', f);
    assert.equal(f.humanVoice, false);
  });

  it('oq shovqinni (keng polosali) ovoz deb hisoblamaydi', () => {
    const f = metrics(noisePcm(0.12), noiseBins);
    show('shovqin (oq)', f);
    assert.equal(f.humanVoice, false, 'shovqin ovoz deb belgilanmasligi kerak');
  });

  it('past-chastotali gurillash (fan/konditsioner) ovoz emas', () => {
    const f = metrics(noisePcm(0.12, 0.9), noiseBins);
    show('shovqin (gurillash)', f);
    assert.equal(f.humanVoice, false);
  });

  it('"taq" (impuls) ovoz emas', () => {
    const f = metrics(tapPcm(0.15), noiseBins);
    show('taq (impuls)', f);
    assert.equal(f.humanVoice, false);
  });
});
