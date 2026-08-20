/**
 * Taqiqlangan ob'ektlar — brauzerda MediaPipe ObjectDetector (EfficientDet/COCO).
 *
 * Nega kerak: server Vision har ~15s va PROCTOR_OPENAI_OBJECTS/API ga bog'liq edi —
 * telefon kadrda aniq ko'rinsa ham "indamay" turardi. Bu detektor ~1s da ishlaydi.
 *
 * Model manbasi: avval o'z domenimiz, so'ng CDN zaxira (`lib/mediapipeAssets.ts`).
 * lite0 → lite2: telefon kadrda kichik ob'ekt bo'lgani uchun lite0 uni ko'p
 * freymda umuman topa olmasdi (detektsiya "miltillardi"). lite2 sezilarli
 * aniqroq; GPU delegate bilan bitta freym ~30-50ms — 300ms interval uchun yetarli.
 *
 * COCO sinflari: cell phone, book, laptop.
 */

import { ContinuousSignalTracker } from './continuousSignal';
import { mediapipeAssetSources } from './mediapipeAssets';
import { ProctorWorkerClient } from './proctorWorkerClient';

/** COCO label (kichik harf) → rasmiy violation. */
const LABEL_TO_VIOLATION: Record<string, string> = {
  'cell phone': 'FORBIDDEN_OBJECT_CELL_PHONE',
  cellphone: 'FORBIDDEN_OBJECT_CELL_PHONE',
  phone: 'FORBIDDEN_OBJECT_CELL_PHONE',
  mobile: 'FORBIDDEN_OBJECT_CELL_PHONE',
  book: 'FORBIDDEN_OBJECT_BOOK',
  laptop: 'FORBIDDEN_OBJECT_LAPTOP',
};

/** Detektorning o'zi qaytaradigan eng past ball — pastroq, filtr quyida. */
const DETECTOR_MIN_SCORE = 0.2;

/**
 * Har bir tur uchun alohida ostona. Telefon kadrda kichik ko'rinadi va ball
 * past chiqadi — unga pastroq ostona kerak. Kitob/noutbuk esa katta ob'ekt:
 * ularga yuqoriroq ostona qo'yamiz, aks holda stol yoki papka "kitob" deb
 * noto'g'ri aniqlanadi.
 */
const SCORE_THRESHOLD_BY_TYPE: Record<string, number> = {
  FORBIDDEN_OBJECT_CELL_PHONE: 0.25,
  FORBIDDEN_OBJECT_BOOK: 0.38,
  FORBIDDEN_OBJECT_LAPTOP: 0.38,
};

/** Freym tahlili oralig'i. Qancha tez-tez bo'lsa, tasdiqlash shuncha tez. */
export const DETECT_INTERVAL_MS = 300;

/**
 * Uzilishga toqat oynasi. MUHIM: bu qiymat DETECT_INTERVAL_MS dan katta
 * bo'lishi SHART. Ilgari grace=500ms, interval=700ms edi — ya'ni detektor
 * bitta freymda telefonni topa olmasa (kichik ob'ektda bu doim bo'ladi),
 * keyingi tekshiruvgacha 700ms > 500ms o'tib, to'plangan vaqt NOLGA tushardi.
 * Natijada hisoblagich 2800ms ga deyarli hech qachon yetmasdi va telefon
 * "juda sekin" aniqlanardi. Endi ketma-ket 3 ta o'tkazib yuborishga toqat.
 */
export const OBJECT_GRACE_MS = DETECT_INTERVAL_MS * 3 + 100;

/** Kichik ogohlantirish — QONUN ISTISNOSI: darhol (0.4s).
 *  Telefonni bir zumga ko'tarib javobni ko'rish uchun 1.5s yetarli edi. */
export const OBJECT_CONFIRM_MS = 400;
/** Rasmiy */
export const OBJECT_ESCALATE_MS = 1800;

export type ForbiddenObjectHit = {
  violationType: string;
  label: string;
  score: number;
};

type DetectorApi = {
  detectForVideo: (video: HTMLVideoElement, ts: number) => {
    detections?: Array<{
      categories?: Array<{ categoryName?: string; score?: number }>;
    }>;
  };
  close?: () => void;
};

function mapLabel(raw: string): string | null {
  const key = raw.toLowerCase().trim();
  if (LABEL_TO_VIOLATION[key]) return LABEL_TO_VIOLATION[key];
  // Ba'zi modellarda "cell_phone"
  const norm = key.replace(/[_-]+/g, ' ');
  return LABEL_TO_VIOLATION[norm] || null;
}

/**
 * Video oqimidan taqiqlangan ob'ektlarni kuzatadi.
 * `onSmall` / `onFormal` — ExamRoom small-warn + logViolation uchun.
 */
export class ForbiddenObjectProctor {
  private detector: DetectorApi | null = null;
  private timer: number | null = null;
  private disposed = false;
  /** Inference worker'i (bo'lsa). `null` — asosiy oqim yo'li (zaxira). */
  private workerClient: ProctorWorkerClient | null = null;
  /** Worker javobi kutilayotganda yangi kadr boshlanmasin. */
  private busy = false;
  private trackers = new Map<string, ContinuousSignalTracker>();
  private lastFormalAt = new Map<string, number>();

  ready = false;

  constructor(
    private video: HTMLVideoElement,
    private opts: {
      onSmall: (violationType: string, label: string) => void;
      onClear: (violationType: string) => void;
      onFormal: (violationType: string) => void;
      /** Modal ochiq bo'lsa true — hisoblamaymiz */
      isFrozen: () => boolean;
    },
  ) {}

  async init(): Promise<boolean> {
    // 1-urinish: worker (asosiy oqim ozod bo'lsin). Ko'tarilmasa — pastdagi zaxira.
    this.workerClient = await ProctorWorkerClient.create(['object'], {
      objectMinScore: DETECTOR_MIN_SCORE,
      objectMaxResults: 16,
    });
    if (this.workerClient) {
      if (this.disposed) {
        this.dispose();
        return false;
      }
      this.ready = true;
      console.info('[object-proctor] tayyor (cell phone / book / laptop, worker)');
      return true;
    }

    // 2-urinish (zaxira): asosiy oqimda. Avval o'z domenimiz, so'ng CDN.
    let lastErr: unknown = null;
    for (const src of mediapipeAssetSources()) {
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const { FilesetResolver, ObjectDetector } = vision as any;
        if (!ObjectDetector?.createFromOptions) {
          console.warn('[object-proctor] ObjectDetector mavjud emas');
          return false;
        }
        const fileset = await FilesetResolver.forVisionTasks(src.wasmBase);
        this.detector = await ObjectDetector.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: src.objectModel,
            delegate: 'GPU',
          },
          scoreThreshold: DETECTOR_MIN_SCORE,
          runningMode: 'VIDEO',
          // Kadrda ko'p ob'ekt bo'lsa (stol, monitor, odam) telefon ro'yxatdan
          // tushib qolmasin — chegara kengaytirildi.
          maxResults: 16,
        });
        if (this.disposed) {
          this.dispose();
          return false;
        }
        this.ready = true;
        console.info(`[object-proctor] tayyor (cell phone / book / laptop, manba: ${src.origin})`);
        return true;
      } catch (err) {
        lastErr = err;
        this.detector = null;
      }
    }
    console.error('[object-proctor] yuklanmadi — ob\'ekt nazorati o\'chdi:', lastErr);
    this.ready = false;
    return false;
  }

  start(): void {
    if ((!this.detector && !this.workerClient) || this.timer != null) return;
    this.timer = window.setInterval(() => void this.tick(), DETECT_INTERVAL_MS);
  }

  private trackerFor(type: string): ContinuousSignalTracker {
    let t = this.trackers.get(type);
    if (!t) {
      t = new ContinuousSignalTracker(OBJECT_GRACE_MS);
      this.trackers.set(type, t);
    }
    return t;
  }

  private async tick(): Promise<void> {
    if (this.disposed || (!this.detector && !this.workerClient)) return;
    if (this.opts.isFrozen()) return;
    if (this.busy) return;
    const video = this.video;
    if (!video || video.readyState < 2 || video.videoWidth < 16) return;

    // Xom nomzodlar: BARCHA categories (faqat [0] emas). Telefon ko'pincha
    // ikkinchi-uchinchi nomzod bo'lib chiqadi (birinchisi "person" yoki
    // "remote") — ilgari aynan shu holatda umuman aniqlanmasdi.
    const raw: Array<{ categoryName: string; score: number }> = [];
    this.busy = true;
    try {
      if (this.workerClient) {
        const r = await this.workerClient.detect(video, performance.now(), false);
        if (!r) return;
        raw.push(...(r.objects || []));
      } else {
        const res = this.detector.detectForVideo(video, performance.now());
        for (const d of res.detections || []) {
          for (const cat of d.categories || []) {
            raw.push({ categoryName: String(cat?.categoryName || ''), score: Number(cat?.score || 0) });
          }
        }
      }
    } catch {
      return;
    } finally {
      this.busy = false;
    }

    const detections: ForbiddenObjectHit[] = [];
    for (const cat of raw) {
      const name = cat.categoryName;
      const violationType = mapLabel(name);
      if (!violationType) continue;
      if (cat.score < (SCORE_THRESHOLD_BY_TYPE[violationType] ?? 0.35)) continue;
      detections.push({ violationType, label: name, score: cat.score });
    }

    // Bir xil tur uchun eng yuqori score
    const best = new Map<string, ForbiddenObjectHit>();
    for (const hit of detections) {
      const prev = best.get(hit.violationType);
      if (!prev || hit.score > prev.score) best.set(hit.violationType, hit);
    }

    const now = Date.now();
    const activeTypes = new Set(best.keys());
    for (const type of ['FORBIDDEN_OBJECT_CELL_PHONE', 'FORBIDDEN_OBJECT_BOOK', 'FORBIDDEN_OBJECT_LAPTOP']) {
      const ms = this.trackerFor(type).push(activeTypes.has(type), now);
      if (ms >= OBJECT_CONFIRM_MS) {
        const hit = best.get(type);
        this.opts.onSmall(type, hit?.label || type);
      } else {
        this.opts.onClear(type);
      }
      if (ms >= OBJECT_ESCALATE_MS) {
        const last = this.lastFormalAt.get(type) || 0;
        if (now - last >= 6_000) {
          this.lastFormalAt.set(type, now);
          this.trackerFor(type).reset();
          this.opts.onFormal(type);
        }
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.workerClient?.dispose();
    this.workerClient = null;
    try {
      this.detector?.close?.();
    } catch {
      /* ignore */
    }
    this.detector = null;
    this.trackers.clear();
  }
}
