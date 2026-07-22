# Odam ovozi vs maishiy shovqin — o'lchov hisoboti

**Sana:** 2026-07-22 · **Qaror:** qo'lda yozilgan DSP → **Silero VAD** (neyron tarmoq)

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
