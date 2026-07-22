#!/usr/bin/env python3
"""
ISHLAB CHIQARISH zanjirini aynan takrorlab, sezgirlik sozlamalarini solishtiradi.

Zanjir (frontend'dagi bilan bir xil):
    Silero VAD
      -> gisterezis (SPEECH_START_PROB / SPEECH_STOP_PROB)
      -> SPEECH_MIN_FRAMES uzluksiz tasdiqlash
      -> ContinuousSignalTracker(700ms grace)
      -> kichik chip (speechMs > 0) / rasmiy (speechMs >= TALK_SIGNAL_ESCALATE_MS)

Sezgirlikni o'zgartirishdan OLDIN shu skriptni ishga tushiring — chegarani
"his bilan" emas, o'lchov bilan tanlang.

    python3 fetch_audio.py
    ./venv/bin/python verify_chain.py
"""
import glob, os, wave, numpy as np, onnxruntime as ort
import os as _os
HERE = _os.path.dirname(_os.path.abspath(__file__))
DATA = _os.path.join(HERE, 'data')
sess = ort.InferenceSession(_os.path.join(DATA, 'silero_vad.onnx'), providers=['CPUExecutionProvider'])
CTX, WIN, SR = 64, 512, 16000
FRAME_MS = WIN / SR * 1000        # 32ms
POLL_MS = 200                      # ExamRoom audio loop
GRACE_MS = 700                     # ContinuousSignalTracker
FORMAL_MS = 2000                   # TALK_SIGNAL_ESCALATE_MS

def read(p):
    with wave.open(p) as w:
        return np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32)/32768.
def probs(pcm):
    st = np.zeros((2,1,128), np.float32); sr = np.array(SR, np.int64)
    ctx = np.zeros(CTX, np.float32); o=[]
    for i in range(0, len(pcm)-WIN+1, WIN):
        c = pcm[i:i+WIN]
        x = np.concatenate([ctx, c]).reshape(1,-1).astype(np.float32)
        p, st = sess.run(None, {'input': x, 'state': st, 'sr': sr})
        ctx = c[-CTX:]; o.append(float(p[0][0]))
    return np.array(o)
def rms(x): return float(np.sqrt(np.mean(x**2))+1e-9)
def scale(x,t): return x*(t/rms(x))

def run_chain(p, start, stop, min_frames):
    """-> (chip chiqdimi, rasmiy berildimi)"""
    speaking, run_len, confirmed = False, 0, False
    confirmed_at = []                      # har kadrda tasdiqlangan holat
    for x in p:
        speaking = (x >= stop) if speaking else (x >= start)
        if speaking:
            run_len += 1
            if run_len >= min_frames: confirmed = True
        else:
            run_len = 0; confirmed = False
        confirmed_at.append(confirmed)
    # ExamRoom 200ms da bir marta o'qiydi + grace bilan uzluksizlikni sanaydi
    chip = formal = False
    cont_ms = 0.0; last_true_t = None
    t = 0.0
    while t < len(confirmed_at) * FRAME_MS:
        idx = min(int(t / FRAME_MS), len(confirmed_at) - 1)
        active = confirmed_at[idx]
        if active:
            if last_true_t is None or (t - last_true_t) > GRACE_MS: cont_ms = 0.0
            cont_ms += POLL_MS if last_true_t is not None else POLL_MS
            last_true_t = t
        elif last_true_t is not None and (t - last_true_t) > GRACE_MS:
            cont_ms = 0.0; last_true_t = None
        if cont_ms > 0: chip = True
        if cont_ms >= FORMAL_MS: formal = True
        t += POLL_MS
    return chip, formal

speech = sorted(glob.glob(_os.path.join(DATA, 'wav16/speech/*.wav')))
noise  = sorted(glob.glob(_os.path.join(DATA, 'wav16/noise/*.wav')))
room = read([f for f in noise if 'vacuum' in f][0])
sets = {}
sets['ovoz normal']   = [scale(read(f),0.06) for f in speech]
sets['ovoz uzoq']     = [scale(read(f),0.03) for f in speech]
sets['ovoz juda jim'] = [scale(read(f),0.012) for f in speech]
mix=[]
for s in sets['ovoz normal']:
    n = np.tile(room, int(len(s)/len(room))+2)[:len(s)]
    mix.append(s + scale(n.copy(), 0.06/(10**(5/20))))
sets['ovoz+shovqin'] = mix
sets['MAISHIY SHOVQIN'] = [scale(read(f),0.08) for f in noise]

print('ehtimolliklar...', flush=True)
CACHE = {k: [probs(c) for c in v] for k, v in sets.items()}

for label, cfg in [('ESKI (0.50/0.35, 32ms)', (0.5,0.35,1)),
                   ('YANGI (0.70/0.50, 384ms)', (0.7,0.5,12))]:
    print(f"\n{label}")
    print(f"  {'holat':<20} {'kichik chip':>12} {'RASMIY':>10}")
    for k in CACHE:
        res = [run_chain(p, *cfg) for p in CACHE[k]]
        chip = sum(r[0] for r in res)/len(res)*100
        form = sum(r[1] for r in res)/len(res)*100
        print(f"  {k:<20} {chip:11.1f}% {form:9.1f}%")
