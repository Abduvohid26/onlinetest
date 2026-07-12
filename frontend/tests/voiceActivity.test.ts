import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AmbientNoiseTracker,
  TalkingViolationCoordinator,
  VoiceActivityTracker,
} from '../src/lib/voiceActivity.ts';

const quiet = {
  rms: 0.012,
  zcr: 0.01,
  humanVoice: false,
  speechRatio: 0.15,
  lowFreqRatio: 0.4,
  crestFactor: 2,
  harmonicity: 0.1,
};

const speech = {
  rms: 0.09,
  zcr: 0.09,
  humanVoice: true,
  speechRatio: 0.64,
  lowFreqRatio: 0.2,
  crestFactor: 3.2,
  harmonicity: 0.45,
};

const chairThud = {
  rms: 0.18,
  zcr: 0.28,
  humanVoice: false,
  speechRatio: 0.35,
  lowFreqRatio: 0.72,
  crestFactor: 9.5,
  harmonicity: 0.12,
};

const ambientTv = {
  rms: 0.12,
  zcr: 0.14,
  humanVoice: false,
  speechRatio: 0.28,
  lowFreqRatio: 0.48,
  crestFactor: 4.2,
  harmonicity: 0.18,
};

describe('AmbientNoiseTracker', () => {
  it('ignores quiet background', () => {
    const tracker = new AmbientNoiseTracker();
    for (let i = 0; i < 60; i++) {
      assert.equal(tracker.push(quiet), null);
    }
  });

  it('ignores human speech (handled by VoiceActivityTracker)', () => {
    const tracker = new AmbientNoiseTracker();
    for (let i = 0; i < 50; i++) tracker.push(quiet);
    for (let i = 0; i < 20; i++) {
      assert.equal(tracker.push(speech), null);
    }
  });

  it('triggers SUSPICIOUS_AUDIO for sustained loud non-speech', () => {
    const tracker = new AmbientNoiseTracker();
    for (let i = 0; i < 50; i++) tracker.push(quiet);
    let saw = false;
    for (let i = 0; i < 14; i++) {
      const hit = tracker.push(ambientTv);
      if (hit === 'SUSPICIOUS_AUDIO') saw = true;
    }
    assert.equal(saw, true);
  });
});

describe('VoiceActivityTracker', () => {
  it('ignores non-speech loud frames', () => {
    const tracker = new VoiceActivityTracker();
    for (let i = 0; i < 50; i++) tracker.push(quiet);
    for (let i = 0; i < 20; i++) {
      const hit = tracker.push({
        rms: 0.2,
        zcr: 0.35,
        humanVoice: false,
        speechRatio: 0.2,
        lowFreqRatio: 0.5,
        crestFactor: 8,
        harmonicity: 0.15,
      });
      assert.equal(hit, null);
    }
  });

  it('ignores chair-like impulse noise', () => {
    const tracker = new VoiceActivityTracker();
    for (let i = 0; i < 50; i++) tracker.push(quiet);
    for (let i = 0; i < 15; i++) {
      const hit = tracker.push(chairThud);
      assert.equal(hit, null);
    }
  });

  it('triggers only after sustained human voice', () => {
    const tracker = new VoiceActivityTracker();
    for (let i = 0; i < 50; i++) tracker.push(quiet);
    let sawHit = false;
    for (let i = 0; i < 12; i++) {
      const hit = tracker.push(speech);
      if (hit === 'WHISPER_OR_CONVERSATION_SUSPECTED') sawHit = true;
    }
    assert.equal(sawHit, true);
  });
});

describe('TalkingViolationCoordinator', () => {
  it('requires both speech and mouth for student talking', () => {
    const coord = new TalkingViolationCoordinator();
    const t0 = Date.now();
    assert.equal(coord.onSpeechSignal(t0, { faceOk: true }), null);
    assert.equal(coord.onMouthSignal(t0 + 500), 'WHISPER_OR_CONVERSATION_SUSPECTED');
  });

  it('detects background speech when mouth was quiet before speech', () => {
    const coord = new TalkingViolationCoordinator();
    const t0 = Date.now();
    coord.onMouthSignal(t0 - 5000);
    assert.equal(
      coord.onSpeechSignal(t0, { faceOk: true }),
      'WHISPER_OR_CONVERSATION_SUSPECTED',
    );
  });

  it('defers background check when mouth never moved yet', () => {
    const coord = new TalkingViolationCoordinator();
    const t0 = Date.now();
    assert.equal(coord.onSpeechSignal(t0, { faceOk: true }), null);
    assert.equal(
      coord.tick(t0 + 1400, { faceOk: true }),
      'WHISPER_OR_CONVERSATION_SUSPECTED',
    );
  });

  it('does not emit background speech without visible face', () => {
    const coord = new TalkingViolationCoordinator();
    assert.equal(coord.onSpeechSignal(Date.now(), { faceOk: false }), null);
  });

  it('does not emit for mouth alone', () => {
    const coord = new TalkingViolationCoordinator();
    assert.equal(coord.onMouthSignal(), null);
  });
});
