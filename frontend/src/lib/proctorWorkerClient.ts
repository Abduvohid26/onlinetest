/**
 * `proctorWorker.ts` uchun asosiy oqim tarafidagi mijoz.
 *
 * Vazifasi: worker'ni ko'tarish, kadrni `ImageBitmap` qilib uzatish, natijani
 * kutish. Eng muhim xususiyati — **hech qachon nazoratni buzmaslik**: worker
 * ko'tarilmasa, brauzer qo'llab-quvvatlamasa yoki init cho'zilib ketsa,
 * `create()` `null` qaytaradi va chaqiruvchi eski (asosiy oqim) yo'lida
 * ishlayveradi. Ya'ni eng yomon holat = bugungi xulq.
 *
 * O'chirish: `VITE_PROCTOR_WORKER=0` — worker'da kutilmagan muammo chiqsa
 * qayta build qilmasdan eski yo'lga qaytish uchun.
 */
import type {
  ProctorTaskKind,
  WorkerAssets,
  WorkerDetectResult,
  WorkerOutMsg,
} from './proctorWorker';
import { mediapipeAssetSources } from './mediapipeAssets';

const INIT_TIMEOUT_MS = 12_000;
const DETECT_TIMEOUT_MS = 4_000;

/**
 * Worker yo'lidan foydalanish mumkinmi — SOF funksiya (test qilinadi).
 *
 * Bu qaror nazorat uchun kritik: `false` qaytsa eski (asosiy oqim) yo'li
 * ishlaydi va proctoring baribir davom etadi. Xato `true` esa nazoratni
 * butunlay o'chirib qo'yishi mumkin edi (worker ko'tarilmay, zaxira ham
 * ishga tushmay) — shuning uchun har bir shart alohida tekshiriladi.
 */
export function canUseProctorWorker(caps: {
  disabledFlag?: string;
  hasWorker: boolean;
  hasCreateImageBitmap: boolean;
  hasOffscreenCanvas: boolean;
}): boolean {
  if (String(caps.disabledFlag || '') === '0') return false;
  return caps.hasWorker && caps.hasCreateImageBitmap && caps.hasOffscreenCanvas;
}

function workerEnabled(): boolean {
  const env = (import.meta as any).env || {};
  return canUseProctorWorker({
    disabledFlag: env.VITE_PROCTOR_WORKER,
    hasWorker: typeof Worker !== 'undefined',
    hasCreateImageBitmap: typeof createImageBitmap === 'function',
    hasOffscreenCanvas: typeof OffscreenCanvas !== 'undefined',
  });
}

export interface ProctorFrameResult {
  faces: Array<Array<{ x: number; y: number; z: number }>>;
  blendshapes?: Array<{ categoryName: string; score: number }>;
  handsPresent: boolean | null;
  objects?: Array<{ categoryName: string; score: number }>;
}

export class ProctorWorkerClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (r: ProctorFrameResult) => void; reject: (e: Error) => void; timer: number }
  >();
  private disposed = false;

  private constructor(worker: Worker) {
    this.worker = worker;
    this.worker.onmessage = (ev: MessageEvent<WorkerOutMsg>) => this.onMessage(ev.data);
    this.worker.onerror = () => this.failAll('worker error');
  }

  /**
   * Worker'ni ko'taradi va modellarni yuklaydi. Muvaffaqiyatsiz bo'lsa `null` —
   * chaqiruvchi eski yo'lga tushishi kerak (bloklamaslik uchun ataylab `throw` yo'q).
   */
  static async create(
    kinds: ProctorTaskKind[],
    opts: { objectMinScore?: number; objectMaxResults?: number } = {},
  ): Promise<ProctorWorkerClient | null> {
    if (!workerEnabled()) return null;

    let worker: Worker;
    try {
      worker = new Worker(new URL('./proctorWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      return null;
    }

    const sources: WorkerAssets[] = mediapipeAssetSources().map((s) => ({
      origin: s.origin,
      wasmBase: s.wasmBase,
      faceModel: s.faceModel,
      handModel: s.handModel,
      objectModel: s.objectModel,
    }));

    const ready = await new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), INIT_TIMEOUT_MS);
      worker.onmessage = (ev: MessageEvent<WorkerOutMsg>) => {
        if (ev.data?.type !== 'ready') return;
        clearTimeout(timer);
        if (!ev.data.ok) {
          console.warn('[proctor-worker] init muvaffaqiyatsiz:', ev.data.reason);
        } else {
          console.info('[proctor-worker] tayyor, manba:', ev.data.origin);
        }
        resolve(ev.data.ok);
      };
      worker.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      worker.postMessage({
        type: 'init',
        kinds,
        sources,
        objectMinScore: opts.objectMinScore,
        objectMaxResults: opts.objectMaxResults,
      });
    });

    if (!ready) {
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
      return null;
    }
    return new ProctorWorkerClient(worker);
  }

  /**
   * Bitta kadrni tahlil qiladi. Xato/kechikishda `null` — chaqiruvchi shu kadrni
   * o'tkazib yuboradi (bitta kadr yo'qolishi nazorat uchun sezilarli emas).
   */
  async detect(
    video: HTMLVideoElement,
    ts: number,
    withHands: boolean,
  ): Promise<ProctorFrameResult | null> {
    if (this.disposed) return null;

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(video);
    } catch {
      return null;
    }
    if (this.disposed) {
      bitmap.close();
      return null;
    }

    const id = this.nextId++;
    return new Promise<ProctorFrameResult | null>((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, DETECT_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: () => {
          clearTimeout(timer);
          resolve(null);
        },
        timer,
      });

      try {
        this.worker.postMessage({ type: 'detect', id, bitmap, ts, withHands }, [bitmap]);
      } catch {
        this.pending.delete(id);
        clearTimeout(timer);
        try {
          bitmap.close();
        } catch {
          /* ignore */
        }
        resolve(null);
      }
    });
  }

  private onMessage(msg: WorkerOutMsg): void {
    if (msg.type === 'result') {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      const r = msg as WorkerDetectResult;
      entry.resolve({
        faces: r.faces || [],
        blendshapes: r.blendshapes,
        handsPresent: r.handsPresent,
        objects: r.objects,
      });
      return;
    }
    if (msg.type === 'error') {
      if (msg.id == null) return;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      entry.reject(new Error(msg.reason));
    }
  }

  private failAll(reason: string): void {
    for (const [, entry] of this.pending) entry.reject(new Error(reason));
    this.pending.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failAll('disposed');
    try {
      this.worker.postMessage({ type: 'dispose' });
    } catch {
      /* ignore */
    }
    // Worker o'zi `ctx.close()` qiladi; kafolat uchun majburan ham to'xtatamiz.
    window.setTimeout(() => {
      try {
        this.worker.terminate();
      } catch {
        /* ignore */
      }
    }, 200);
  }
}
