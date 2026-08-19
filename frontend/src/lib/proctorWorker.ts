/**
 * Proctoring inference worker'i — MediaPipe modellari ASOSIY OQIMDAN TASHQARIDA.
 *
 * NEGA: bir vaqtda FaceLandmarker + HandLandmarker + ObjectDetector + Silero VAD
 * ishlaydi va hammasi asosiy oqimda edi. `realtimeProctor.start()` dagi uzun izoh
 * shuni tasvirlaydi — inference `requestAnimationFrame` dan chiqarилgan, lekin
 * baribir asosiy oqimda: Chrome "handler took Nms" deb shikoyat qilar, imtihon
 * UI'si (savol bosish, taymer) sekinlashardi. `DETECT_INTERVAL_MS = 150` ham
 * aynan shu yuk sababli pasaytirilgan.
 *
 * BU YERDA FAQAT INFERENCE. Nigoh chegaralari, eskalatsiya, violation qarorlari —
 * hammasi asosiy oqimda (`realtimeProctor.ts`) qoladi. Sabab: qaror mantig'i
 * tez-tez o'zgaradi, inference esa deyarli o'zgarmaydi. Ikkalasini ajratsak,
 * qaror mantig'ini o'zgartirganda worker'ga tegmaymiz.
 *
 * Kadr `ImageBitmap` sifatida keladi (transferable — nusxa ko'chirilmaydi).
 * `HTMLVideoElement` ni worker'ga uzatib bo'lmaydi, shuning uchun chaqiruvchi
 * tomon `createImageBitmap(video)` qiladi.
 */

/// <reference lib="webworker" />

export type ProctorTaskKind = 'face' | 'object';

export interface WorkerAssets {
  /** Faqat log uchun: 'local' | 'cdn' | 'env'. */
  origin?: string;
  wasmBase: string;
  faceModel: string;
  handModel: string;
  objectModel: string;
}

export interface WorkerInitMsg {
  type: 'init';
  kinds: ProctorTaskKind[];
  /** Sinab ko'riladigan manbalar (lokal → CDN). Birinchi ishlagani qabul qilinadi. */
  sources: WorkerAssets[];
  /** `object` uchun: minimal ishonch va natijalar soni. */
  objectMinScore?: number;
  objectMaxResults?: number;
}

export interface WorkerDetectMsg {
  type: 'detect';
  id: number;
  bitmap: ImageBitmap;
  ts: number;
  /** Qo'l modeli har kadrda kerak emas — chaqiruvchi hal qiladi. */
  withHands: boolean;
}

export type WorkerInMsg = WorkerInitMsg | WorkerDetectMsg | { type: 'dispose' };

export interface WorkerLandmark {
  x: number;
  y: number;
  z: number;
}

export interface WorkerDetectResult {
  type: 'result';
  id: number;
  faces: WorkerLandmark[][];
  blendshapes?: Array<{ categoryName: string; score: number }>;
  /** `withHands=false` bo'lsa `null` — chaqiruvchi oxirgi qiymatni saqlaydi. */
  handsPresent: boolean | null;
  objects?: Array<{ categoryName: string; score: number }>;
}

export type WorkerOutMsg =
  | { type: 'ready'; ok: boolean; origin?: string; reason?: string }
  | WorkerDetectResult
  | { type: 'error'; id?: number; reason: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let faceLandmarker: any = null;
let handLandmarker: any = null;
let objectDetector: any = null;

async function initTasks(msg: WorkerInitMsg): Promise<{ ok: boolean; origin?: string; reason?: string }> {
  let lastReason = 'no sources';
  for (const src of msg.sources) {
    try {
      const vision: any = await import('@mediapipe/tasks-vision');
      const { FilesetResolver, FaceLandmarker, HandLandmarker, ObjectDetector } = vision;
      const fileset = await FilesetResolver.forVisionTasks(src.wasmBase);

      if (msg.kinds.includes('face')) {
        // Worker ichida GPU (WebGL) har muhitda ishlamaydi — CPU zaxirasi shart.
        // Aks holda worker'ga o'tish nazoratni butunlay o'chirib qo'yishi mumkin edi.
        faceLandmarker = await createWithDelegateFallback(FaceLandmarker, fileset, {
          baseOptions: { modelAssetPath: src.faceModel },
          runningMode: 'VIDEO',
          numFaces: 2,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: false,
        });
        if (!faceLandmarker) throw new Error('face landmarker unavailable');

        // Qo'l modeli ixtiyoriy — bo'lmasa yuz nazorati baribir ishlaydi.
        handLandmarker = await createWithDelegateFallback(HandLandmarker, fileset, {
          baseOptions: { modelAssetPath: src.handModel },
          runningMode: 'VIDEO',
          numHands: 1,
        });
      }

      if (msg.kinds.includes('object')) {
        objectDetector = await createWithDelegateFallback(ObjectDetector, fileset, {
          baseOptions: { modelAssetPath: src.objectModel },
          runningMode: 'VIDEO',
          scoreThreshold: msg.objectMinScore ?? 0.2,
          maxResults: msg.objectMaxResults ?? 16,
        });
        if (!objectDetector) throw new Error('object detector unavailable');
      }

      return { ok: true, origin: src.origin || 'unknown' };
    } catch (err) {
      lastReason = String((err as Error)?.message || err);
      faceLandmarker = handLandmarker = objectDetector = null;
    }
  }
  return { ok: false, reason: lastReason };
}

async function createWithDelegateFallback(Task: any, fileset: any, opts: any): Promise<any | null> {
  if (!Task?.createFromOptions) return null;
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      return await Task.createFromOptions(fileset, {
        ...opts,
        baseOptions: { ...opts.baseOptions, delegate },
      });
    } catch {
      /* keyingi delegate */
    }
  }
  return null;
}

ctx.onmessage = async (ev: MessageEvent<WorkerInMsg>) => {
  const msg = ev.data;

  if (msg.type === 'init') {
    const res = await initTasks(msg);
    ctx.postMessage({ type: 'ready', ...res } satisfies WorkerOutMsg);
    return;
  }

  if (msg.type === 'dispose') {
    for (const t of [faceLandmarker, handLandmarker, objectDetector]) {
      try {
        t?.close?.();
      } catch {
        /* ignore */
      }
    }
    faceLandmarker = handLandmarker = objectDetector = null;
    ctx.close();
    return;
  }

  if (msg.type === 'detect') {
    const { id, bitmap, ts, withHands } = msg;
    try {
      let faces: WorkerLandmark[][] = [];
      let blendshapes: Array<{ categoryName: string; score: number }> | undefined;
      let handsPresent: boolean | null = null;
      let objects: Array<{ categoryName: string; score: number }> | undefined;

      if (handLandmarker && withHands) {
        // Timestamp'lar qat'iy o'suvchi bo'lishi shart — yuz bilan bir xil ts
        // berilsa MediaPipe xato beradi, shu sabab kichik siljish.
        const hres = handLandmarker.detectForVideo(bitmap, ts + 0.001);
        handsPresent = (hres?.landmarks?.length || 0) > 0;
      }

      if (faceLandmarker) {
        const res = faceLandmarker.detectForVideo(bitmap, ts);
        faces = res?.faceLandmarks || [];
        blendshapes = res?.faceBlendshapes?.[0]?.categories;
      }

      if (objectDetector) {
        const res = objectDetector.detectForVideo(bitmap, ts);
        objects = [];
        for (const d of res?.detections || []) {
          for (const c of d?.categories || []) {
            objects.push({ categoryName: String(c?.categoryName || ''), score: Number(c?.score || 0) });
          }
        }
      }

      ctx.postMessage({
        type: 'result',
        id,
        faces,
        blendshapes,
        handsPresent,
        objects,
      } satisfies WorkerDetectResult);
    } catch (err) {
      ctx.postMessage({
        type: 'error',
        id,
        reason: String((err as Error)?.message || err),
      } satisfies WorkerOutMsg);
    } finally {
      // Transfer qilingan bitmap'ni albatta bo'shatamiz (aks holda GPU xotira oqadi).
      try {
        bitmap.close();
      } catch {
        /* ignore */
      }
    }
  }
};
