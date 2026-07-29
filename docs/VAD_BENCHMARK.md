# Odam ovozi vs maishiy shovqin — o'lchov hisoboti

**Sana:** 2026-07-29 (retune) · **Qaror:** qo'lda yozilgan DSP → **Silero VAD** (neyron tarmoq)

---

## Muammo

Imtihon paytida mikrofon ikki narsani ajratishi kerak edi:

1. **Odam ovozi** — talaba yoki kadr tashqarisidagi kimdir gapiryapti (qoidabuzarlik)
2. **Maishiy shovqin** — ventilyator, klaviatura, idish, eshik, transport (qoidabuzarlik emas)

Bir hafta davomida bu ishlamadi: tashqaridan gapirilganda aniqlanmasdi, aksincha
oddiy shovqinlarga "gapirmang" ogohlantirishi chiqaverardi.

## Nega qo'lda yozilgan DSP ishlamaydi

Eski yechim 5-6 ta qo'lda hisoblangan mezonga tayanardi: RMS, ZCR, spektral ulush,
autokorrelyatsiya davriyligi, crest factor. **Bu mezonlar sintetik signalda mukammal
ishlaydi** (biz yozgan sintetik testda 25/25 to'g'ri edi) — lekin real audioda emas.

Ikkita tub sabab:

1. **Real nutqning ~40% kadri OVOZSIZ** (`s`, `sh`, `f`, `t`, `k` tovushlari).
   Ularda davriylik umuman yo'q — autokorrelyatsiya mezoni ularni ko'rmaydi.
2. **Ko'p maishiy shovqin DAVRIY.** Ventilyator parragi, mashina signali, eshik
   g'ijirlashi, budilnik, bola yig'isi — hammasi takrorlanuvchi. Mezon ularni
   "odam ovozi" deb belgilaydi.

Ya'ni bu ikki sinf 5-6 o'lchamli qo'lda sozlangan fazoda **kesishib ketadi** —
u yerda ajratuvchi chegara umuman mavjud emas. Qancha threshold sozlansa ham
biri yaxshilanib, ikkinchisi buziladi. Bir hafta shu davom etdi.

## O'lchov usuli

Sintetik signal aldamchi ekani ma'lum bo'lgach, **real audio** bilan o'lchandi:

| Manba | Nima | Miqdor | Litsenziya |
|---|---|---|---|
| [LibriSpeech dev-clean](https://www.openslr.org/12) | Real odam nutqi, 40 xil so'zlovchi (erkak/ayol) | 80 klip | CC BY 4.0 |
| [ESC-50](https://github.com/karolpiczak/ESC-50) | Real maishiy shovqin, 31 kategoriya | 124 klip | CC BY-NC 3.0 |

Shovqin kategoriyalari: `vacuum_cleaner`, `washing_machine`, `keyboard_typing`,
`mouse_click`, `door_wood_knock`, `door_wood_creaks`, `can_opening`, `clock_tick`,
`clock_alarm`, `glass_breaking`, `engine`, `car_horn`, `siren`, `footsteps`,
`drinking_sipping`, `toilet_flush`, `pouring_water`, `water_drops`, `wind`, `rain`,
`crackling_fire`, `clapping`, `brushing_teeth`, `helicopter`, `train`
— **va eng qiyin chegara holatlari** (inson tovushi, lekin nutq EMAS):
`breathing`, `coughing`, `laughing`, `sneezing`, `snoring`, `crying_baby`.

Har ikki detektor **aynan bir xil audio** ustida, bir xil qarorlash mezoni bilan
o'lchandi (5s klipda kamida 0.5s nutq → "gapiryapti").

## Natijalar

| Sinov | Qo'lda yozilgan DSP | **Silero VAD** |
|---|---:|---:|
| Odam ovozi, normal balandlik | 96.3% | **100.0%** |
| Odam ovozi, uzoqroq (rms 0.03) | 92.5% | **100.0%** |
| Odam ovozi, juda jim/uzoq (rms 0.012) | **7.5%** | **100.0%** |
| Ovoz + xona shovqini, SNR 10 dB | 93.8% | **100.0%** |
| Ovoz + xona shovqini, SNR 5 dB | 88.8% | **100.0%** |
| Ovoz + xona shovqini, SNR 0 dB | 60.0% | **100.0%** |
| Ovoz + xona shovqini, SNR −5 dB | — | 93.8% |
| **SOXTA IJOBIY** (124 shovqin klipi) | **13.7%** (17/124) | **0.0%** (0/124) |

DSP ning soxta ijobiylari aynan foydalanuvchi shikoyat qilgan holatlar edi:

```
XX crying_baby        4/4      XX coughing          1/4
XX car_horn           3/4      XX siren             1/4
XX door_wood_creaks   3/4      XX snoring           1/4
XX laughing           2/4      XX vacuum_cleaner    1/4
XX clock_alarm        1/4
```

Silero'da bu kategoriyalarning **hammasi 0/4**.

## Qaror: Silero VAD

- **Model:** `silero_vad.onnx`, 2.3 MB (gzip 1.9 MB), MIT litsenziya
- **Runtime:** `onnxruntime-web` (WASM), 13.5 MB (gzip 3.3 MB) — bir marta yuklanadi va keshlanadi
- **Ikkalasi ham o'zimizda hosted** (`public/models/`, `public/ort/`) — CDN'ga bog'liq emas
- **Tezlik:** ~1 ms / 32 ms audio kadr → bitta yadroning ~3% i
- **Kirish:** 16 kHz, 512 sample + oldingi kadrdan **64 sample kontekst**

> ⚠️ **Kontekst MAJBURIY.** Silero v5 modeliga 512 sample'ni kontekstsiz bersangiz,
> u toza nutqda ham ~0.00 qaytaradi. Bu xato shu benchmark paytida topilgan:
> birinchi o'lchovda hamma natija 0% chiqdi, chunki kontekst berilmagandi.
> To'g'ri kirish: `concat(oldingi_kadrning_oxirgi_64_sample, joriy_512_sample)`.

Eski DSP kodi **o'chirilmadi** — model yuklanmasa (tarmoq, eski qurilma) zaxira
sifatida ishlaydi. Proctoring hech qachon imtihonni buzmasligi kerak.

## Qayta ishga tushirish

```bash
cd tools/vad-benchmark
python3 fetch_audio.py                                  # model + real audio (~400MB vaqtinchalik)
python3 -m venv venv && ./venv/bin/pip install onnxruntime numpy
./venv/bin/python silero_bench.py
```

## Xulosa

Threshold sozlash bilan hal bo'lmaydigan muammo bor edi — sinflar mezon fazosida
kesishib ketgandi. Yechim chegarani qo'lda topishga urinishni to'xtatib, minglab
soatlik va 6000+ tilli ma'lumotda o'rgatilgan modelga topshirish bo'ldi.

**Asosiy saboq:** sintetik test yashil bo'lsa ham real ma'lumotda o'lchamaguncha
hech narsa ma'lum emas. Sintetik test 25/25 ko'rsatgan kod real audioda 13.7%
soxta ijobiy berardi.

---

# Sezgirlikni sozlash (2026-07-22, ikkinchi bosqich)

Silero o'rnatilgandan keyin ovoz **haddan tashqari sezgir** bo'lib qoldi: maishiy
shovqinga ham kichik ogohlantirish chiqaverardi.

## Sabab

Model o'zi aybdor emas edi — **chegara** aybdor. Kichik chip talab qilardi:
bitta 32ms kadr ehtimolligi ≥ 0.5. Neyron tarmoq ham bitta kadrda adashishi
mumkin, va real shovqinda bu tez-tez sodir bo'ladi.

Diqqat: birinchi benchmarkda 0% soxta ijobiy chiqqan edi, chunki u klip bo'yicha
**16 kadr** (≈0.5s) nutq talab qilardi. Ishlab chiqarish kodi esa **1 kadr**da
signal berardi — ya'ni o'lchangan sozlama bilan ishlagan sozlama boshqa edi.
Shuning uchun endi `verify_chain.py` bor: u to'liq ishlab chiqarish zanjirini
aynan takrorlaydi.

## Uzluksizlik talabining ta'siri (124 real shovqin klipi)

| Uzluksiz talab | Soxta signal | Real ovozni aniqlash |
|---|---:|---:|
| 32ms (1 kadr) | 13.7% | 100% |
| 128ms | 4.8% | 100% |
| 256ms | 0.8% | 100% |
| **384ms** | **0.0%** | **100%** |

384ms soxta signalni butunlay yo'q qiladi va real gapirishni aniqlashga **umuman
ta'sir qilmaydi** — har qanday haqiqiy gap 0.4s dan uzun.

## To'liq zanjir: eski vs yangi

`verify_chain.py` natijasi (Silero → gisterezis → min-kadr → tracker → chip/rasmiy):

| Holat | ESKI chip | ESKI rasmiy | YANGI chip | YANGI rasmiy |
|---|---:|---:|---:|---:|
| Ovoz, normal | 100.0% | 88.8% | 100.0% | 66.2% |
| Ovoz, uzoq | 100.0% | 88.8% | 100.0% | 65.0% |
| Ovoz, juda jim | 100.0% | 88.8% | 100.0% | 63.7% |
| Ovoz + shovqin | 100.0% | 86.2% | 100.0% | 48.8% |
| **MAISHIY SHOVQIN** | **9.7%** | 0.0% | **0.0%** | **0.0%** |

**Natija:** maishiy shovqindagi soxta ogohlantirish 9.7% → **0%**; real gapirishni
aniqlash chip darajasida **100% bo'lib qoldi**; rasmiy ogohlantirish esa 5 soniyalik
klipda 88.8% → 66.2%, ya'ni oldingi darajaning **~75%** i (66.2 / 88.8 = 74.5%).

## Sozlamalar (eski, 2026-07-22)

```ts
const SPEECH_START_PROB = 0.7;
const SPEECH_STOP_PROB  = 0.5;
const SPEECH_MIN_FRAMES = 12;    // ~384ms
```

---

# Parametr retune (2026-07-29)

Public Silero v5 defaultlari (`threshold=0.5`, `neg_threshold=threshold−0.15`,
`min_speech_duration_ms=250`) va LibriSpeech+ESC-50 ustida to'liq zanjir
grid-search (`verify_chain.py --grid`, grace/confirm sweep).

## Muammo

Production haddan **qattiq** edi (`0.78 / 0.55 / 16≈512ms`, grace 400ms, confirm 900ms):
maishiy FP 0% bo'lib qolgan, lekin real nutq chip **92.5%** ga tushgan (SNR5 da **87.5%**).
Rasmiy (2.5s) uzluksiz gapirishda ham sezgirlik yarmi edi.

## Yangi sozlamalar (tanlangan)

| Qatlam | Qiymat | Asos |
|---|---|---|
| `SPEECH_START_PROB` | **0.55** | public 0.5 + notebook AGC zaxira |
| `SPEECH_STOP_PROB` | **0.40** | public gisterezis (−0.15) |
| `SPEECH_MIN_FRAMES` | **8 (~256ms)** | Silero `min_speech_duration_ms=250` |
| speech grace | **600ms** | so'z pauzalari; FP hali 0% |
| confirm / escalate | **800 / 2500ms** | chip 98.8%; escalate o'zgarmagan |

## Zanjir o'lchovi (80 nutq + 124 shovqin)

| Config | Nutq chip | Jim chip | SNR5 chip | Shovqin chip | Edge chip |
|---|---:|---:|---:|---:|---:|
| ESKI prod `0.78/16 g400 c900` | 92.5% | 93.8% | 87.5% | **0/124** | 0/28 |
| PUBLIC `0.50/0.35/8 g500 c800` | 98.8% | 98.8% | 98.8% | **0/124** | 0/28 |
| **YANGI `0.55/0.40/8 g600 c800`** | **98.8%** | **98.8%** | **98.8%** | **0/124** | **0/28** |

Raw Silero (0.5, ≥0.5s nutq): nutq **100%**, shovqin FP **0%** (shu jumladan
breathing/coughing/laughing/sneezing/snoring/crying_baby).

Edge spike'lar (yo'tal/kulgi) `maxP` 0.9+ bo'lishi mumkin, lekin **tasdiqlangan
uzluksizlik ≤96ms** — 256ms + 800ms chip chegarasiga yetmaydi.

## OpenAI Whisper spot-check

Yuqori spike edge kliplar + 1 nutq (`whisper-1`):

| Klip | Whisper | VAD chip? |
|---|---|---|
| coughing | nonsens (`Ew/Yuck`) | yo'q |
| laughing | `Haha…` | yo'q (run 96ms) |
| sneezing | `Pfft` | yo'q |
| snoring | bo'sh | yo'q |
| crying_baby | gapga o'xshash matn | yo'q |
| LibriSpeech nutq | to'g'ri jumla | ha |

Xulosa: Whisper ba'zi non-speech tovushlarga matn “yopishtirishi” mumkin; imtihon
proctoring uchun **Silero + min_frames + grace/confirm** to'g'ri filtr.

```bash
cd tools/vad-benchmark
./venv/bin/python verify_chain.py --grid
./venv/bin/python silero_bench.py
```
