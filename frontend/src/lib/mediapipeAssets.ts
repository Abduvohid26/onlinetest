/**
 * MediaPipe WASM/model manzillari — LOKAL birinchi, CDN zaxira.
 *
 * NEGA: ilgari har bir manzil to'g'ridan-to'g'ri tashqi CDN'ga (jsdelivr va
 * storage.googleapis.com) qattiq bog'langan edi. O'sha hostlar talaba
 * tarmog'ida ochilmasa `init()` jimgina `false` qaytarardi — real-time
 * yuz/nigoh/qo'l/ob'ekt nazorati BUTUNLAY o'chib qolar, buni na talaba,
 * na admin sezardi (faqat `console.info` ga yozilardi).
 *
 * Endi artefaktlar `frontend/scripts/sync-mediapipe-assets.mjs` orqali
 * `public/mediapipe/` ga qo'yiladi va o'z domenimizdan beriladi. CDN faqat
 * zaxira sifatida qoladi (masalan asset'lar deploy'ga tushmay qolgan bo'lsa).
 */

const env = (import.meta as any).env || {};

export interface MediapipeAssetSet {
  /** Tashxis/telemetriya uchun nom: 'local' yoki 'cdn'. */
  origin: 'local' | 'cdn' | 'env';
  wasmBase: string;
  faceModel: string;
  handModel: string;
  objectModel: string;
}

const LOCAL: MediapipeAssetSet = {
  origin: 'local',
  wasmBase: '/mediapipe/wasm',
  faceModel: '/mediapipe/models/face_landmarker.task',
  handModel: '/mediapipe/models/hand_landmarker.task',
  objectModel: '/mediapipe/models/efficientdet_lite2.tflite',
};

const CDN: MediapipeAssetSet = {
  origin: 'cdn',
  wasmBase: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm',
  faceModel:
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  handModel:
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  objectModel:
    'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite',
};

/**
 * Sinab ko'riladigan manbalar, tartib bo'yicha.
 *
 * TARTIB: CDN birinchi, lokal zaxira.
 *
 * NEGA aynan shunday: bir muddat lokal manba birinchi edi, lekin ishlab
 * turgan tizimda MediaPipe lokal WASM bilan ishga tushmadi va butun real-time
 * nazorat o'chib qoldi — CDN bilan esa ishlagan. Isbotlanmagan yo'lni birinchi
 * qo'yish nazoratni yo'qotish demak, shuning uchun ishlashi ma'lum yo'l
 * birinchi turadi.
 *
 * Lokal manba ZAXIRA sifatida qoladi — CDN bloklangan tarmoqdagi talaba uchun
 * (asl maqsad shu edi va u hamon kuchda).
 *
 * `VITE_MEDIAPIPE_LOCAL_FIRST=1` — tartibni teskari qilib sinash uchun.
 * Har qanday `VITE_MEDIAPIPE_*` wasm/model env berilsa — admin ataylab
 * tanlagan, zaxira umuman qo'shilmaydi.
 */
export function mediapipeAssetSources(): MediapipeAssetSet[] {
  const overridden =
    env.VITE_MEDIAPIPE_WASM_BASE ||
    env.VITE_MEDIAPIPE_FACE_MODEL ||
    env.VITE_MEDIAPIPE_HAND_MODEL ||
    env.VITE_MEDIAPIPE_OBJECT_MODEL;

  if (overridden) {
    return [
      {
        origin: 'env',
        wasmBase: env.VITE_MEDIAPIPE_WASM_BASE || LOCAL.wasmBase,
        faceModel: env.VITE_MEDIAPIPE_FACE_MODEL || LOCAL.faceModel,
        handModel: env.VITE_MEDIAPIPE_HAND_MODEL || LOCAL.handModel,
        objectModel: env.VITE_MEDIAPIPE_OBJECT_MODEL || LOCAL.objectModel,
      },
    ];
  }
  return String(env.VITE_MEDIAPIPE_LOCAL_FIRST || '') === '1' ? [LOCAL, CDN] : [CDN, LOCAL];
}

/**
 * MediaPipe task'ini avval GPU, so'ng CPU delegate bilan yaratishga urinadi.
 *
 * GPU (WebGL) har muhitda mavjud emas: apparat tezlashtirish o'chirilgan
 * Chrome, virtual mashina, eski drayver, ba'zi Linux konfiguratsiyalari.
 * Bunday joyda GPU-only chaqiruv xato beradi va nazorat butunlay o'chadi —
 * CPU sekinroq bo'lsa ham nazoratsiz qolishdan yaxshiroq.
 *
 * `null` = ikkalasi ham ishlamadi.
 */
export async function createWithDelegateFallback(Task: any, fileset: any, opts: any): Promise<any | null> {
  if (!Task?.createFromOptions) return null;
  let lastErr: unknown = null;
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      return await Task.createFromOptions(fileset, {
        ...opts,
        baseOptions: { ...opts.baseOptions, delegate },
      });
    } catch (err) {
      lastErr = err;
    }
  }
  console.error('[mediapipe] GPU va CPU delegate ikkalasi ham ishlamadi:', lastErr);
  return null;
}
