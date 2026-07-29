/**
 * Odam ovozi vs MAISHIY SHOVQIN — offline, takrorlanadigan tekshiruv.
 *
 * Signallar matematik yasaladi va spektri HAQIQIY FFT bilan hisoblanadi
 * (`audioFixtures.ts`), Web Audio `getByteFrequencyData` formulasi aynan
 * takrorlanadi. Shu sabab bu test brauzerdagi holatni ishonchli aks ettiradi.
 *
 * Nega bu muhim: ilgari testda spektr binlari qo'lda yozilardi (PCM'dan mustaqil).
 * Halol FFT'ga o'tilgach darhol ma'lum bo'ldiki, `flatness <= 0.6` mezoni real
 * ERKAK ovozini (f0≈130 Hz) rad etayotgan ekan — "ovoz aniqlanmayapti"ning sababi.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVoiceFrame } from '../src/lib/voiceActivity.ts';
import * as F from './audioFixtures.ts';

const isVoice = (pcm: Float32Array) => analyzeVoiceFrame(F.analyserFor(pcm)).humanVoice;

/** Xona fon shovqini — real mikrofonda hech qachon toza signal kelmaydi. */
const room = F.fanHum(1);

describe('odam ovozini ANIQLAYDI', () => {
  it('erkak ovozi (f0 90–130 Hz)', () => {
    assert.equal(isVoice(F.voicedSpeech(0.09, 90)), true, 'chuqur erkak ovozi');
    assert.equal(isVoice(F.voicedSpeech(0.09, 130)), true, "o'rtacha erkak ovozi");
  });

  it('ayol / bola ovozi (f0 210–300 Hz)', () => {
    assert.equal(isVoice(F.voicedSpeech(0.09, 210)), true);
    assert.equal(isVoice(F.voicedSpeech(0.09, 300)), true);
  });

  it("sekin/uzoqdagi ovoz — TASHQI odam kadr tashqarisidan gapirsa ham", () => {
    assert.equal(isVoice(F.voicedSpeech(0.045, 130)), true, 'sekin ovoz');
    assert.equal(isVoice(F.voicedSpeech(0.03, 150)), true, 'juda sekin ovoz');
  });

  it('devor ortidan / boshqa xonadan (bo\'g\'iq) ovoz', () => {
    assert.equal(isVoice(F.muffledSpeech(0.06, 130)), true);
  });

  it('fon shovqini ustidagi ovoz (SNR 15/10/6 dB)', () => {
    assert.equal(isVoice(F.mix(F.voicedSpeech(0.08, 130), room, 15)), true, 'SNR 15dB');
    assert.equal(isVoice(F.mix(F.voicedSpeech(0.08, 130), room, 10)), true, 'SNR 10dB');
    assert.equal(isVoice(F.mix(F.voicedSpeech(0.08, 130), room, 6)), true, 'SNR 6dB');
  });

  it('bo\'g\'iq + shovqinli (eng og\'ir real holat)', () => {
    assert.equal(isVoice(F.mix(F.muffledSpeech(0.07, 150), room, 8)), true);
  });
});

describe('MAISHIY SHOVQINni ovoz deb hisoblaMAYDI', () => {
  it('ventilyator / konditsioner / kuler gurillashi', () => {
    assert.equal(isVoice(F.fanHum(0.12)), false, 'oddiy');
    assert.equal(isVoice(F.fanHum(0.3)), false, 'baland');
  });

  it('klaviatura bosilishi', () => {
    assert.equal(isVoice(F.keyboardTyping(0.12)), false);
  });

  it('idish-tovoq shaqirlashi', () => {
    assert.equal(isVoice(F.dishesClatter(0.15)), false);
  });

  it('eshik yopilishi / stolga urilish ("taq")', () => {
    assert.equal(isVoice(F.doorSlam(0.2)), false);
  });

  it('ko\'cha / transport gurillashi', () => {
    assert.equal(isVoice(F.trafficRumble(0.15)), false);
  });

  it('oq shovqin (radio shipillashi)', () => {
    assert.equal(isVoice(F.whiteNoise(0.15)), false);
  });

  it('qog\'oz shitirlashi / kiyim ishqalanishi', () => {
    assert.equal(isVoice(F.paperRustle(0.12)), false);
  });

  it('cholg\'u musiqasi (akkord — nutq emas)', () => {
    assert.equal(isVoice(F.instrumentalMusic(0.12)), false);
  });

  it('sof ton / signal (mikrovolnovka "pip", telefon)', () => {
    // Sof ton MUKAMMAL davriy (periodicity = 1.0) — faqat davriylikka tayansak
    // ovoz deb belgilanardi. Uni ohanglar soni (harmonicCount) rad etadi.
    assert.equal(isVoice(F.pureTone(0.12, 1000)), false, '1 kHz');
    assert.equal(isVoice(F.pureTone(0.12, 300)), false, '300 Hz');
    assert.equal(isVoice(F.pureTone(0.12, 150)), false, '150 Hz (nutq f0 diapazonida)');
  });

  it('jimlik', () => {
    assert.equal(isVoice(F.voicedSpeech(0.003, 130)), false);
  });
});

describe('mezonlarning ajratish kuchi (regressiyaga qarshi)', () => {
  it('davriylik: ovoz ≥ 0.75, har qanday maishiy shovqin ≤ 0.50', () => {
    const per = (pcm: Float32Array) => analyzeVoiceFrame(F.analyserFor(pcm)).harmonicity;
    const voices = [
      F.voicedSpeech(0.09, 130),
      F.voicedSpeech(0.09, 210),
      F.mix(F.voicedSpeech(0.08, 130), room, 6),
    ];
    const noises = [
      F.fanHum(0.12),
      F.keyboardTyping(0.12),
      F.dishesClatter(0.15),
      F.doorSlam(0.2),
      F.trafficRumble(0.15),
      F.whiteNoise(0.15),
      F.instrumentalMusic(0.12),
      F.paperRustle(0.12),
    ];
    for (const v of voices) assert.ok(per(v) >= 0.75, `ovoz davriyligi past: ${per(v)}`);
    for (const nz of noises) assert.ok(per(nz) <= 0.5, `shovqin davriyligi yuqori: ${per(nz)}`);
  });

  it('ohanglar soni sof tonni nutqdan ajratadi', () => {
    const hn = (pcm: Float32Array) => analyzeVoiceFrame(F.analyserFor(pcm)).harmonicCount;
    assert.ok(hn(F.pureTone(0.12, 1000)) <= 2, 'sof tonda ohang kam bo\'lishi kerak');
    assert.ok(hn(F.voicedSpeech(0.09, 130)) >= 6, 'nutqda ohang ko\'p bo\'lishi kerak');
  });

  it('shivirlash aniqlanmaydi — bu KUTILGAN (og\'iz harakati ushlaydi)', () => {
    // Shivirlash ovozsiz (unvoiced): f0 yo'q, davriylik yo'q. Mikrofon orqali uni
    // shovqindan ajratib bo'lmaydi. Bunday holatni video tomoni — og'iz qimirlashi
    // (MOUTH_MOVEMENT_TALKING) ushlaydi.
    assert.equal(isVoice(F.whisper(0.05)), false);
  });
});
