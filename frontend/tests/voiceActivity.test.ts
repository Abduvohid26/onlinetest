import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceActivityTracker } from '../src/lib/voiceActivity.ts';

const quiet = { rms: 0.012, zcr: 0.01, humanVoice: false, speechRatio: 0.15 };
const speech = { rms: 0.09, zcr: 0.09, humanVoice: true, speechRatio: 0.64 };

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
      });
      assert.equal(hit, null);
    }
  });

  it('triggers only after sustained human voice', () => {
    const tracker = new VoiceActivityTracker();
    for (let i = 0; i < 50; i++) tracker.push(quiet);
    let sawHit = false;
    for (let i = 0; i < 8; i++) {
      const hit = tracker.push(speech);
      if (hit === 'WHISPER_OR_CONVERSATION_SUSPECTED') sawHit = true;
    }
    assert.equal(sawHit, true);
  });
});
