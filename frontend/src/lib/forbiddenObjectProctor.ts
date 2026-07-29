/**
 * Taqiqlangan ob'ektlar — brauzerda MediaPipe ObjectDetector (EfficientDet/COCO).
 *
 * Nega kerak: server Vision har ~15s va PROCTOR_OPENAI_OBJECTS/API ga bog'liq edi —
 * telefon kadrda aniq ko'rinsa ham "indamay" turardi. Bu detektor ~1s da ishlaydi,
 * CDN model + mavjud @mediapipe/tasks-vision.
 *
 * COCO sinflari: cell phone, book, laptop.
 */

import { ContinuousSignalTracker } from './continuousSignal';

const WASM_BASE =
  (import.meta as any).env?.VITE_MEDIAPIPE_WASM_BASE ||
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';

const OBJECT_MODEL =
  (import.meta as any).env?.VITE_MEDIAPIPE_OBJECT_MODEL ||
  'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite';

/** COCO label (kichik harf) → rasmiy violation. */
const LABEL_TO_VIOLATION: Record<string, string> = {
  'cell phone': 'FORBIDDEN_OBJECT_CELL_PHONE',
  cellphone: 'FORBIDDEN_OBJECT_CELL_PHONE',
  phone: 'FORBIDDEN_OBJECT_CELL_PHONE',
  mobile: 'FORBIDDEN_OBJECT_CELL_PHONE',
  book: 'FORBIDDEN_OBJECT_BOOK',
  laptop: 'FORBIDDEN_OBJECT_LAPTOP',
};

const SCORE_THRESHOLD = 0.32;
const DETECT_INTERVAL_MS = 700;
/** Kichik ogohlantirish */
export const OBJECT_CONFIRM_MS = 1200;
/** Rasmiy */
export const OBJECT_ESCALATE_MS = 2800;

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
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const { FilesetResolver, ObjectDetector } = vision as any;
      if (!ObjectDetector?.createFromOptions) {
        console.warn('[object-proctor] ObjectDetector mavjud emas');
        return false;
      }
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      this.detector = await ObjectDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: OBJECT_MODEL,
          delegate: 'GPU',
        },
        scoreThreshold: SCORE_THRESHOLD,
        runningMode: 'VIDEO',
        maxResults: 8,
      });
      if (this.disposed) {
        this.dispose();
        return false;
      }
      this.ready = true;
      console.info('[object-proctor] tayyor (cell phone / book / laptop)');
      return true;
    } catch (err) {
      console.warn('[object-proctor] yuklanmadi:', err);
      this.ready = false;
      return false;
    }
  }

  start(): void {
    if (!this.detector || this.timer != null) return;
    this.timer = window.setInterval(() => this.tick(), DETECT_INTERVAL_MS);
  }

  private trackerFor(type: string): ContinuousSignalTracker {
    let t = this.trackers.get(type);
    if (!t) {
      t = new ContinuousSignalTracker(500);
      this.trackers.set(type, t);
    }
    return t;
  }

  private tick(): void {
    if (this.disposed || !this.detector) return;
    if (this.opts.isFrozen()) return;
    const video = this.video;
    if (!video || video.readyState < 2 || video.videoWidth < 16) return;

    let detections: ForbiddenObjectHit[] = [];
    try {
      const res = this.detector.detectForVideo(video, performance.now());
      for (const d of res.detections || []) {
        const cat = d.categories?.[0];
        if (!cat) continue;
        const score = Number(cat.score || 0);
        if (score < SCORE_THRESHOLD) continue;
        const name = String(cat.categoryName || '');
        const violationType = mapLabel(name);
        if (!violationType) continue;
        detections.push({ violationType, label: name, score });
      }
    } catch {
      return;
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
        if (now - last >= 8_000) {
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
    try {
      this.detector?.close?.();
    } catch {
      /* ignore */
    }
    this.detector = null;
    this.trackers.clear();
  }
}
