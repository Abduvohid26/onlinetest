/**
 * Pre-exam yuz pozitsiyasi tekshiruvi (MediaPipe FaceLandmarker).
 *
 * Imtihon boshlanishidan oldin talaba:
 *  - yagona yuz bilan (kadrda yolg'iz),
 *  - kameraga yetarlicha yaqin (yuz kadrning katta qismini egallasin),
 *  - markazda va to'g'ridan-to'g'ri kameraga qaragan
 * holatda ekanini ta'minlaydi. Faqat shu shartlar bir necha freym barqaror
 * bo'lganda "OK" beriladi va Start tugmasi yonadi.
 *
 * Graceful degradation: model yuklanmasa init() false qaytaradi — chaqiruvchi
 * gate'ni o'tkazib yuborishi (skip) kerak, imtihon bloklanmasligi uchun.
 */

export type FacePositionStatus =
  | 'WAITING'
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'TOO_FAR'
  | 'TOO_CLOSE'
  | 'OFF_CENTER'
  | 'TURNED'
  | 'OK';

const env = (import.meta as any).env || {};
const WASM_BASE: string =
  env.VITE_MEDIAPIPE_WASM_BASE ||
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const FACE_MODEL: string =
  env.VITE_MEDIAPIPE_FACE_MODEL ||
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const DETECT_INTERVAL_MS = 180; // ~5-6 fps
const OK_STREAK_NEEDED = 6; // ~1s barqaror OK

// Chegaralar (normalized landmark geometriyasi; realtimeProctor.ts bilan moslang).
// FACE_MAX / CENTER_Y_MAX qattiqroq: yuz kadrning yuqori-o'rta qismida bo'lsin —
// pastda stol/qo'l/telefon ko'rinsin (yonida telefon cheatini kamaytirish).
const FACE_MIN_HEIGHT = 0.26; // bundan kichik = juda uzoq
const FACE_MAX_HEIGHT = 0.56; // bundan katta = juda yaqin (stol FOV yo'qoladi)
const CENTER_X_MIN = 0.30;
const CENTER_X_MAX = 0.70;
const CENTER_Y_MIN = 0.18;
const CENTER_Y_MAX = 0.52; // yuz pastga tushsa — stol kadrdan chiqadi
const YAW_MAX = 0.17; // burilish chegarasi

export type FacePositionUpdate = (status: FacePositionStatus, okSustained: boolean) => void;

/** Burun landmark (1) chap/o'ng yuz chetlaridan (234/454) nisbatan gorizontal
 * siljishi — manfiy/musbat belgi xom (mirrorlanmagan) kamera bufer koordinatasida.
 * Gate (classify) va active liveness challenge ikkalasi ham shu bitta hisob-kitobni
 * ishlatadi, shunda ikki joyda landmark indekslari mos kelmasligi xavfi yo'q. */
export function computeYaw(lm: any[]): number | null {
  const left = lm[234];
  const right = lm[454];
  const nose = lm[1];
  if (!left || !right || !nose) return null;
  const width = right.x - left.x || 1e-6;
  return (nose.x - left.x) / width - 0.5;
}

/** Active liveness challenge chegaralari (PreExamCheck bilan bir xil). */
export const CHALLENGE_YAW_MIN = 0.18;
export const CHALLENGE_CENTER_MAX = 0.17;

/**
 * Mirror preview ko'rsatmasiga mos burilish — realtimeProctor GAZE mapping bilan bir xil:
 * musbat yaw = talaba chapga, manfiy yaw = talaba o'ngga burgan.
 */
export function challengeYawMatches(
  direction: 'left' | 'right',
  yaw: number,
  minYaw = CHALLENGE_YAW_MIN,
): boolean {
  return direction === 'left' ? yaw >= minYaw : yaw <= -minYaw;
}

export function challengeYawCentered(
  yaw: number,
  maxAbs = CHALLENGE_CENTER_MAX,
): boolean {
  return Math.abs(yaw) <= maxAbs;
}

/** Og'iz kengligi / yuz kengligi — tabassumda oshadi. */
export function computeSmileRatio(lm: any[]): number | null {
  const faceL = lm[234];
  const faceR = lm[454];
  const mouthL = lm[61];
  const mouthR = lm[291];
  const upperLip = lm[13];
  if (!faceL || !faceR || !mouthL || !mouthR || !upperLip) return null;

  const faceWidth = faceR.x - faceL.x;
  if (Math.abs(faceWidth) <= 1e-6) return null;

  const mouthWidth = mouthR.x - mouthL.x;
  const widthRatio = mouthWidth / faceWidth;

  // Tabassumda og'iz burchaklari yuqoriga ko'tariladi (y kamayadi).
  const cornerAvgY = (mouthL.y + mouthR.y) / 2;
  const cornerLift = upperLip.y - cornerAvgY;

  return widthRatio + cornerLift * 0.55;
}

/** Active liveness challenge — tabassum chegarasi. */
export const SMILE_RATIO_MIN = 0.46;

export function isSmiling(lm: any[], minRatio = SMILE_RATIO_MIN): boolean {
  const ratio = computeSmileRatio(lm);
  if (ratio === null) return false;
  return ratio >= minRatio;
}

async function createFaceLandmarker(numFaces = 1): Promise<any | null> {
  const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const base = {
    baseOptions: { modelAssetPath: FACE_MODEL },
    runningMode: 'VIDEO' as const,
    numFaces,
  };
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      return await FaceLandmarker.createFromOptions(fileset, {
        ...base,
        baseOptions: { ...base.baseOptions, delegate },
      });
    } catch {
      /* keyingi delegate */
    }
  }
  return null;
}

export class FacePositionChecker {
  private video: HTMLVideoElement;
  private onUpdate: FacePositionUpdate;
  private landmarker: any = null;
  private rafId: number | null = null;
  private timer: number | null = null;
  private running = false;
  private disposed = false;
  private okStreak = 0;

  constructor(video: HTMLVideoElement, onUpdate: FacePositionUpdate) {
    this.video = video;
    this.onUpdate = onUpdate;
  }

  async init(): Promise<boolean> {
    try {
      this.landmarker = await createFaceLandmarker(2);
      if (this.disposed || !this.landmarker) {
        this.dispose();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  start(): void {
    if (this.running || !this.landmarker) return;
    this.running = true;
    // Og'ir MediaPipe inference'i rAF ichida BAJARILMAYDI — u joriy kadrni ushlab
    // qoladi va Chrome "[Violation] 'requestAnimationFrame' handler took <N>ms"
    // deb ogohlantiradi (ko'rinadigan qotish). rAF faqat "sahifa ko'rinyapti"
    // darvozasi; tahlil kadr chizilgandan keyin alohida makrotaskda ishlaydi.
    const analyse = () => {
      if (!this.running) return;
      this.evaluate();
      schedule();
    };
    const schedule = () => {
      this.timer = window.setTimeout(() => {
        this.rafId = window.requestAnimationFrame(() => {
          if (!this.running) return;
          this.timer = window.setTimeout(analyse, 0);
        });
      }, DETECT_INTERVAL_MS);
    };
    schedule();
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.timer !== null) clearTimeout(this.timer);
    this.rafId = null;
    this.timer = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    try {
      this.landmarker?.close?.();
    } catch {
      /* ignore */
    }
    this.landmarker = null;
  }

  private classify(): FacePositionStatus {
    const v = this.video;
    if (!v || v.readyState < 2 || v.videoWidth === 0) return 'WAITING';

    let faces: any[] = [];
    try {
      const res = this.landmarker.detectForVideo(v, performance.now());
      faces = res?.faceLandmarks || [];
    } catch {
      return 'WAITING';
    }

    if (faces.length === 0) return 'NO_FACE';
    if (faces.length >= 2) return 'MULTIPLE_FACES';

    const lm = faces[0];
    const nose = lm[1];
    const left = lm[234];
    const right = lm[454];
    const top = lm[10];
    const chin = lm[152];
    if (!nose || !left || !right || !top || !chin) return 'WAITING';

    const faceHeight = chin.y - top.y;
    if (faceHeight < FACE_MIN_HEIGHT) return 'TOO_FAR';
    if (faceHeight > FACE_MAX_HEIGHT) return 'TOO_CLOSE';

    if (
      nose.x < CENTER_X_MIN ||
      nose.x > CENTER_X_MAX ||
      nose.y < CENTER_Y_MIN ||
      nose.y > CENTER_Y_MAX
    ) {
      return 'OFF_CENTER';
    }

    const noseRelX = computeYaw(lm);
    if (noseRelX !== null && Math.abs(noseRelX) > YAW_MAX) return 'TURNED';

    return 'OK';
  }

  private evaluate(): void {
    const status = this.classify();
    if (status === 'OK') {
      this.okStreak = Math.min(OK_STREAK_NEEDED, this.okStreak + 1);
    } else {
      this.okStreak = 0;
    }
    this.onUpdate(status, this.okStreak >= OK_STREAK_NEEDED);
  }
}

export type YawUpdate = (yaw: number | null) => void;

const YAW_DETECT_INTERVAL_MS = 120;

/**
 * Active liveness challenge uchun yengil yaw-kuzatuvchi — FacePositionChecker'dan
 * mustaqil, o'z FaceLandmarker instansiyasini yaratadi (identity tasdiqlangandan
 * keyin, position-gate checker allaqachon dispose qilingan bo'ladi). Alohida
 * instansiya — position-gate lifecycle'ini o'zgartirmasdan, xavfsiz izolyatsiya.
 */
export class YawChallengeTracker {
  private video: HTMLVideoElement;
  private onYaw: YawUpdate;
  private landmarker: any = null;
  private rafId: number | null = null;
  private timer: number | null = null;
  private running = false;
  private disposed = false;

  constructor(video: HTMLVideoElement, onYaw: YawUpdate) {
    this.video = video;
    this.onYaw = onYaw;
  }

  async init(): Promise<boolean> {
    try {
      this.landmarker = await createFaceLandmarker();
      if (this.disposed || !this.landmarker) {
        this.dispose();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  start(): void {
    if (this.running || !this.landmarker) return;
    this.running = true;
    // Og'ir MediaPipe inference'i rAF ichida BAJARILMAYDI — u joriy kadrni ushlab
    // qoladi va Chrome "[Violation] 'requestAnimationFrame' handler took <N>ms"
    // deb ogohlantiradi (ko'rinadigan qotish). rAF faqat "sahifa ko'rinyapti"
    // darvozasi; tahlil kadr chizilgandan keyin alohida makrotaskda ishlaydi.
    const analyse = () => {
      if (!this.running) return;
      this.tick();
      schedule();
    };
    const schedule = () => {
      this.timer = window.setTimeout(() => {
        this.rafId = window.requestAnimationFrame(() => {
          if (!this.running) return;
          this.timer = window.setTimeout(analyse, 0);
        });
      }, YAW_DETECT_INTERVAL_MS);
    };
    schedule();
  }

  private tick(): void {
    const v = this.video;
    if (!v || v.readyState < 2 || v.videoWidth === 0) {
      this.onYaw(null);
      return;
    }
    try {
      const res = this.landmarker.detectForVideo(v, performance.now());
      const faces = res?.faceLandmarks || [];
      if (faces.length !== 1) {
        this.onYaw(null);
        return;
      }
      this.onYaw(computeYaw(faces[0]));
    } catch {
      this.onYaw(null);
    }
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.timer !== null) clearTimeout(this.timer);
    this.rafId = null;
    this.timer = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    try {
      this.landmarker?.close?.();
    } catch {
      /* ignore */
    }
    this.landmarker = null;
  }
}

export type SmileUpdate = (smiling: boolean) => void;

const SMILE_DETECT_INTERVAL_MS = 120;

/**
 * Active liveness challenge — tabassum aniqlash (MediaPipe og'iz landmarklari).
 * YawChallengeTracker o'rniga: talaba kameraga qarab jilmayganda tasdiqlanadi.
 */
export class SmileChallengeTracker {
  private video: HTMLVideoElement;
  private onSmile: SmileUpdate;
  private landmarker: any = null;
  private rafId: number | null = null;
  private timer: number | null = null;
  private running = false;
  private disposed = false;

  constructor(video: HTMLVideoElement, onSmile: SmileUpdate) {
    this.video = video;
    this.onSmile = onSmile;
  }

  async init(): Promise<boolean> {
    try {
      this.landmarker = await createFaceLandmarker();
      if (this.disposed || !this.landmarker) {
        this.dispose();
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  start(): void {
    if (this.running || !this.landmarker) return;
    this.running = true;
    const analyse = () => {
      if (!this.running) return;
      this.tick();
      schedule();
    };
    const schedule = () => {
      this.timer = window.setTimeout(() => {
        this.rafId = window.requestAnimationFrame(() => {
          if (!this.running) return;
          this.timer = window.setTimeout(analyse, 0);
        });
      }, SMILE_DETECT_INTERVAL_MS);
    };
    schedule();
  }

  private tick(): void {
    const v = this.video;
    if (!v || v.readyState < 2 || v.videoWidth === 0) {
      this.onSmile(false);
      return;
    }
    try {
      const res = this.landmarker.detectForVideo(v, performance.now());
      const faces = res?.faceLandmarks || [];
      if (faces.length !== 1) {
        this.onSmile(false);
        return;
      }
      this.onSmile(isSmiling(faces[0]));
    } catch {
      this.onSmile(false);
    }
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.timer !== null) clearTimeout(this.timer);
    this.rafId = null;
    this.timer = null;
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    try {
      this.landmarker?.close?.();
    } catch {
      /* ignore */
    }
    this.landmarker = null;
  }
}
