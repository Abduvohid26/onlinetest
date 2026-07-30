/**
 * Imtihon oldi sifat tekshiruvi: tasvir tiniqligi, yorug'lik, ko'z o'qilishi,
 * internet barqarorligi.
 *
 * NEGA KERAK. Imtihon davomidagi nazorat butunlay kamera sifatiga bog'liq:
 *   * nigoh (gaze) nazorati qorachiqni o'qishga tayanadi — ko'z xira yoki
 *     qorong'i bo'lsa u ishlamaydi va talaba pastga qarab telefondan
 *     javob ko'rishi mumkin (aynan shu teshik topilgan edi);
 *   * shaxs tekshiruvi (har 15s) va kadr tahlili (har 15s) rasm yuboradi —
 *     internet beqaror bo'lsa nazorat uzilib qoladi.
 *
 * Shu sabab bu shartlar imtihon BOSHLANISHIDAN OLDIN tekshiriladi: keyin
 * tuzatib bo'lmaydi va nazoratsiz imtihon o'tib ketadi.
 *
 * Modul DOM'ga bog'lanmagan sof funksiyalardan iborat — unit testlar bilan
 * qoplangan. Kamera/tarmoq bilan ishlash chaqiruvchi tomonda.
 */

// --- Chegaralar -----------------------------------------------------------
// Ataylab BO'SHASHGAN: haqiqiy talabani noto'g'ri bloklash, nazoratsiz
// o'tkazib yuborishdan ko'ra yomonroq (u imtihonga kira olmaydi). Faqat
// aniq yaroqsiz holat rad etiladi.

/** Laplasian dispersiyasi bundan past — tasvir xira (fokus yo'q, kir linza). */
export const SHARPNESS_MIN = 45;
/** O'rtacha yorqinlik (0-255) — bundan past: qorong'i xona. */
export const BRIGHTNESS_MIN = 45;
/** Bundan yuqori: orqadan yorug'lik / haddan tashqari ekspozitsiya. */
export const BRIGHTNESS_MAX = 225;
/** Kontrast (standart chetlanish) — bundan past: "yuvilgan" tekis tasvir. */
export const CONTRAST_MIN = 18;

/**
 * Ko'z ochiqligining MUTLAQ pastki chegarasi.
 *
 * DIQQAT: bu qiymat ataylab juda past. Ko'z ochiqligi nisbati odamlar orasida
 * keskin farq qiladi (ko'z shakli, qovoq burmasi, kamera burchagi, masofa) —
 * shu sabab "normal ochiq ko'z" uchun umumiy chegara qo'yish MUMKIN EMAS.
 * Bir talabaning tabiiy nisbati 0.30 bo'lsa, boshqasining 0.14 bo'lishi
 * mumkin va ikkalasi ham mutlaqo normal.
 *
 * Shu chegara faqat "ko'z butunlay yumuq / landmark yaroqsiz" holatni rad
 * etadi. Haqiqiy nazorat imtihon davomida SHU TALABANING o'z bazaviy
 * qiymatiga nisbatan qilinadi (`eyeBaselineFrom` + nisbiy taqqoslash).
 */
export const EYE_OPEN_ABS_FLOOR = 0.08;

/** Bazaviy qiymatning shu ulushidan past — ko'z toraygan (pastga qaragan). */
export const EYE_NARROW_BASELINE_RATIO = 0.62;

/** Tarmoq: o'rtacha javob vaqti (ms) bundan yuqori — sekin. */
export const NET_LATENCY_MAX_MS = 900;
/** Tarmoq: tebranish (jitter, ms) bundan yuqori — beqaror. */
export const NET_JITTER_MAX_MS = 450;
/** Tarmoq: shuncha so'rovdan ko'pi yiqilsa — ishonchsiz. */
export const NET_MAX_FAILURES = 1;

export type QualityStatus = 'OK' | 'BLURRY' | 'TOO_DARK' | 'TOO_BRIGHT' | 'LOW_CONTRAST';
export type EyeStatus = 'OK' | 'NO_LANDMARKS' | 'EYES_NARROW';
export type NetworkStatus = 'OK' | 'SLOW' | 'UNSTABLE' | 'OFFLINE';

export interface ImageStats {
  sharpness: number;
  brightness: number;
  contrast: number;
}

/**
 * Kulrang tasvir statistikasi: tiniqlik (Laplasian dispersiyasi), o'rtacha
 * yorqinlik va kontrast.
 *
 * @param gray 0-255 kulrang piksellar (uzunligi w*h)
 */
export function computeImageStats(gray: Uint8Array | number[], w: number, h: number): ImageStats {
  if (!gray || w < 3 || h < 3 || gray.length < w * h) {
    return { sharpness: 0, brightness: 0, contrast: 0 };
  }
  let sum = 0;
  for (let i = 0; i < w * h; i += 1) sum += gray[i];
  const mean = sum / (w * h);

  let varSum = 0;
  for (let i = 0; i < w * h; i += 1) {
    const d = gray[i] - mean;
    varSum += d * d;
  }
  const contrast = Math.sqrt(varSum / (w * h));

  // Laplasian (4-qo'shni yadro) dispersiyasi — standart xiralik o'lchovi.
  let lapSum = 0;
  let lapSqSum = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lapSum += lap;
      lapSqSum += lap * lap;
      n += 1;
    }
  }
  const lapMean = n ? lapSum / n : 0;
  const sharpness = n ? lapSqSum / n - lapMean * lapMean : 0;

  return { sharpness, brightness: mean, contrast };
}

/** Statistikadan holat. Yorug'lik xiralikdan ustun — sababi aniqroq. */
export function classifyImageQuality(s: ImageStats): QualityStatus {
  if (s.brightness < BRIGHTNESS_MIN) return 'TOO_DARK';
  if (s.brightness > BRIGHTNESS_MAX) return 'TOO_BRIGHT';
  if (s.contrast < CONTRAST_MIN) return 'LOW_CONTRAST';
  if (s.sharpness < SHARPNESS_MIN) return 'BLURRY';
  return 'OK';
}

/**
 * Ko'z qorachig'ini o'qish mumkinmi — nigoh nazorati SHUNGA bog'liq.
 *
 * `ratios` — har ko'z uchun balandlik/kenglik nisbati. Bo'sh bo'lsa
 * landmark yo'q (kamera burchagi yaroqsiz yoki yuz juda uzoq).
 */
export function classifyEyeReadability(ratios: (number | null)[]): EyeStatus {
  const vals = (ratios || []).filter((v): v is number => typeof v === 'number' && v > 0);
  if (vals.length === 0) return 'NO_LANDMARKS';
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return avg >= EYE_OPEN_ABS_FLOOR ? 'OK' : 'EYES_NARROW';
}

/**
 * Talabaning BAZAVIY ko'z ochiqligi — imtihon oldi tekshiruvida yig'iladi.
 *
 * Median olinadi: ko'z pirillashi (bir necha kadr past qiymat) natijani
 * buzmasin. Yetarli namuna bo'lmasa `null` — u holda imtihonda nisbiy
 * taqqoslash o'chadi va faqat bosh pozitsiyasi ishlatiladi (soxta
 * ogohlantirish berishdan ko'ra shunisi xavfsiz).
 */
export function eyeBaselineFrom(samples: (number | null)[], minSamples = 8): number | null {
  const vals = (samples || [])
    .filter((v): v is number => typeof v === 'number' && v > 0)
    .sort((a, b) => a - b);
  if (vals.length < minSamples) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

export interface NetworkSample {
  /** Javob vaqti (ms). Yiqilgan so'rov uchun `null`. */
  ms: number | null;
}

export interface NetworkStats {
  status: NetworkStatus;
  /** O'rta qiymat (median) — bitta sekin so'rov natijani buzmasin. */
  medianMs: number;
  /** Ketma-ket o'lchovlar farqining o'rtachasi. */
  jitterMs: number;
  failures: number;
  samples: number;
}

/** O'lchovlardan tarmoq holati. */
export function classifyNetwork(samples: NetworkSample[]): NetworkStats {
  const list = samples || [];
  const ok = list.map((s) => s.ms).filter((v): v is number => typeof v === 'number' && v >= 0);
  const failures = list.length - ok.length;

  if (ok.length === 0) {
    return { status: 'OFFLINE', medianMs: 0, jitterMs: 0, failures, samples: list.length };
  }

  const sorted = [...ok].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianMs =
    sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);

  let diffSum = 0;
  for (let i = 1; i < ok.length; i += 1) diffSum += Math.abs(ok[i] - ok[i - 1]);
  const jitterMs = ok.length > 1 ? Math.round(diffSum / (ok.length - 1)) : 0;

  let status: NetworkStatus = 'OK';
  if (failures > NET_MAX_FAILURES) status = 'UNSTABLE';
  else if (jitterMs > NET_JITTER_MAX_MS) status = 'UNSTABLE';
  else if (medianMs > NET_LATENCY_MAX_MS) status = 'SLOW';

  return { status, medianMs, jitterMs, failures, samples: list.length };
}

/**
 * Video kadridan kulrang massiv (canvas yordamida).
 * Kichik o'lchamga tushiriladi — statistika uchun yetarli va tez.
 */
export function grayscaleFromCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): Uint8Array | null {
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null; // tainted canvas / kadr tayyor emas
  }
  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < gray.length; i += 4, p += 1) {
    // ITU-R BT.601 luma
    gray[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }
  return gray;
}
