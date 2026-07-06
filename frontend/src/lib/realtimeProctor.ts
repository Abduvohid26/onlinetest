/**
 * Real-time brauzer proctoring (MediaPipe FaceLandmarker + HandLandmarker).
 *
 * Gibrid dizayn: bu modul yuqori chastotali (~6 fps) real-time signal beradi
 * (gaze/bosh burilishi, ortiqcha qimirlash, qo'l/imo-ishora, ko'p yuz, yuz yo'q).
 * Server tarafi (proctor-frame, har ~20-30s) bularni tasdiqlaydi va avtoritativ
 * jazo (warning/ban) ni `student_violations` orqali beradi.
 *
 * Graceful degradation: model yuklanmasa (CDN bloklangan, eski qurilma) engine
 * jim o'chadi — server proctoring ishlayveradi. Hech qachon imtihonni buzmaydi.
 *
 * Modellar CDN'dan lazy-load qilinadi (env bilan self-host qilish mumkin):
 *   VITE_MEDIAPIPE_WASM_BASE, VITE_MEDIAPIPE_FACE_MODEL, VITE_MEDIAPIPE_HAND_MODEL
 */

export type RealtimeViolation =
  | 'FACE_NOT_VISIBLE'
  | 'MULTIPLE_FACES'
  | 'GAZE_AWAY_LEFT'
  | 'GAZE_AWAY_RIGHT'
  | 'GAZE_AWAY_UP'
  | 'GAZE_AWAY_DOWN'
  | 'FACE_TURNED_AWAY'
  | 'EXCESSIVE_MOVEMENT'
  | 'HAND_GESTURE_SUSPECTED'
  | 'MOUTH_MOVEMENT_TALKING'
  | 'FACE_TOO_FAR'
  | 'FACE_TOO_CLOSE'
  | 'FACE_OFF_CENTER';

/** Real-time kamera overlay uchun — violation emas, faqat vizual holat. */
export type FaceStatusLive =
  | 'WAITING'
  | 'OK'
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'TOO_FAR'
  | 'TOO_CLOSE'
  | 'OFF_CENTER'
  | 'TURNED'
  | 'GAZE_AWAY';

const env = (import.meta as any).env || {};
const WASM_BASE: string =
  env.VITE_MEDIAPIPE_WASM_BASE ||
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const FACE_MODEL: string =
  env.VITE_MEDIAPIPE_FACE_MODEL ||
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_MODEL: string =
  env.VITE_MEDIAPIPE_HAND_MODEL ||
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Detection tezligi va bardoshlilik. Tez aniqlash uchun streak/cooldown kichik.
const DETECT_INTERVAL_MS = 130; // ~7-8 fps
const PER_TYPE_COOLDOWN_MS = 3500; // bir tur uchun emit oralig'i (server ham dedup qiladi)

// Streak: signal "rost" deb hisoblanishidan oldin necha ketma-ket frame kerak.
// Past qiymat = tezroq aniqlash (~ frame * 130ms).
const STREAK = {
  noFace: 6, // ~0.8s yuz yo'q
  multiFace: 3, // ~0.4s 2+ yuz (tez!)
  gaze: 6, // ~0.8s uzoq qaragan
  movement: 5,
  hand: 3, // ~0.4s qo'l ko'rinib turibdi (tezroq aniqlash)
  mouth: 2,
  tooFar: 10, // ~1.3s juda uzoq
  tooClose: 8, // ~1s juda yaqin
  offCenter: 10, // ~1.3s markazdan chetda
};

// Yuz o'lchami va pozitsiya chegaralari (normalized; facePositionCheck.ts bilan moslangan).
const FACE_MIN_HEIGHT = 0.26;
const FACE_MAX_HEIGHT = 0.82;
const FACE_CTR_X_MIN = 0.28;
const FACE_CTR_X_MAX = 0.72;
const FACE_CTR_Y_MIN = 0.20;
const FACE_CTR_Y_MAX = 0.82;

// Bosh poza / gaze chegaralari (normalized landmark geometriyasi; kalibrlash mumkin).
const YAW_TURN = 0.18; // markazdan gorizontal og'ish ulushi
const YAW_HARD = 0.30; // kuchli yuz burilishi
const PITCH_UP = 0.30;
const PITCH_DOWN = 0.72;
const MOVE_THRESHOLD = 0.045; // burun nuqtasining frame'lararo o'rtacha siljishi

export interface RealtimeProctorCallbacks {
  onViolation: (type: RealtimeViolation) => void;
  /** Yuz almashishi shubhasi (yo'qolib qayta paydo bo'ldi yoki ko'p yuz) —
   *  ExamRoom darhol server identity-compare ishga tushiradi (person-swap'ni tez ushlash). */
  onRecheckIdentity?: () => void;
  /** Har kadrda real-time yuz holati — kamera overlay uchun, violation emas. */
  onFaceStatus?: (status: FaceStatusLive) => void;
  onReady?: (ok: boolean) => void;
  onStatus?: (msg: string) => void;
}

interface FaceLandmark {
  x: number;
  y: number;
  z: number;
}

export class RealtimeProctor {
  private video: HTMLVideoElement;
  private cb: RealtimeProctorCallbacks;
  private faceLandmarker: any = null;
  private handLandmarker: any = null;
  private rafId: number | null = null;
  private timer: number | null = null;
  private running = false;
  private disposed = false;

  private lastEmit: Record<string, number> = {};
  private streaks: Record<string, number> = {};
  private prevNose: { x: number; y: number } | null = null;
  private moveEma = 0;
  // Yuz almashishi (person-swap) triggeri uchun
  private faceWasAbsent = false;
  private lastRecheck = 0;
  // Og'iz qimirlashi (gapirish) aniqlash
  private mouthHistory: number[] = [];

  constructor(video: HTMLVideoElement, cb: RealtimeProctorCallbacks) {
    this.video = video;
    this.cb = cb;
  }

  async init(): Promise<boolean> {
    try {
      const vision = await import('@mediapipe/tasks-vision');
      const { FilesetResolver, FaceLandmarker, HandLandmarker } = vision;
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);

      this.faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 3,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: false,
      });

      // Qo'l/imo-ishora — yuklanmasa ham face detection ishlayveradi.
      try {
        this.handLandmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numHands: 2,
        });
      } catch {
        this.handLandmarker = null;
      }

      if (this.disposed) {
        this.dispose();
        return false;
      }
      this.cb.onReady?.(true);
      return true;
    } catch (err) {
      this.cb.onStatus?.('Realtime proctor modeli yuklanmadi (server proctoring ishlaydi).');
      this.cb.onReady?.(false);
      return false;
    }
  }

  start(): void {
    if (this.running || !this.faceLandmarker) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.detectOnce();
      this.timer = window.setTimeout(() => {
        this.rafId = window.requestAnimationFrame(loop);
      }, DETECT_INTERVAL_MS);
    };
    this.rafId = window.requestAnimationFrame(loop);
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
      this.faceLandmarker?.close?.();
      this.handLandmarker?.close?.();
    } catch {
      /* ignore */
    }
    this.faceLandmarker = null;
    this.handLandmarker = null;
  }

  private emit(type: RealtimeViolation): void {
    const now = Date.now();
    if (now - (this.lastEmit[type] || 0) < PER_TYPE_COOLDOWN_MS) return;
    this.lastEmit[type] = now;
    this.cb.onViolation(type);
  }

  /** Identity qayta-tekshiruv so'rovi (person-swap), ortiqcha chaqirmaslik uchun cooldown. */
  private requestRecheck(): void {
    const now = Date.now();
    if (now - this.lastRecheck < 8000) return;
    this.lastRecheck = now;
    this.cb.onRecheckIdentity?.();
  }

  /** Streak hisoblagich: kerakli ketma-ketlikka yetganda true qaytaradi (va resetlaydi). */
  private streak(key: string, active: boolean, need: number): boolean {
    if (!active) {
      this.streaks[key] = 0;
      return false;
    }
    this.streaks[key] = (this.streaks[key] || 0) + 1;
    if (this.streaks[key] >= need) {
      this.streaks[key] = 0;
      return true;
    }
    return false;
  }

  private detectOnce(): void {
    const v = this.video;
    if (!v || v.readyState < 2 || v.videoWidth === 0) return;
    const ts = performance.now();

    let faces: FaceLandmark[][] = [];
    try {
      const res = this.faceLandmarker.detectForVideo(v, ts);
      faces = res?.faceLandmarks || [];
    } catch {
      return;
    }

    const faceCount = faces.length;

    // 1) Yuz yo'q / ko'p yuz
    if (this.streak('noFace', faceCount === 0, STREAK.noFace)) this.emit('FACE_NOT_VISIBLE');
    if (this.streak('multiFace', faceCount >= 2, STREAK.multiFace)) {
      this.emit('MULTIPLE_FACES');
      this.requestRecheck(); // ko'p yuz — kim o'tirganini tekshir
    }

    // Person-swap: yuz yo'qolib qayta paydo bo'lsa — kim qaytganini tekshir.
    if (faceCount === 0) {
      this.faceWasAbsent = true;
      this.cb.onFaceStatus?.('NO_FACE');
    } else if (this.faceWasAbsent) {
      this.faceWasAbsent = false;
      this.requestRecheck();
    }

    if (faceCount >= 2) {
      this.cb.onFaceStatus?.('MULTIPLE_FACES');
    }

    if (faceCount >= 1) {
      const posStatus = this.checkFacePosition(faces[0]);
      this.cb.onFaceStatus?.(posStatus);

      // Pozitsiya violations — sustained streak orqali
      if (this.streak('tooFar', posStatus === 'TOO_FAR', STREAK.tooFar)) this.emit('FACE_TOO_FAR');
      if (this.streak('tooClose', posStatus === 'TOO_CLOSE', STREAK.tooClose)) this.emit('FACE_TOO_CLOSE');
      if (this.streak('offCenter', posStatus === 'OFF_CENTER', STREAK.offCenter)) this.emit('FACE_OFF_CENTER');

      this.analyzeHeadAndMovement(faces[0]);
    } else {
      this.streaks['tooFar'] = 0;
      this.streaks['tooClose'] = 0;
      this.streaks['offCenter'] = 0;
      this.prevNose = null;
      this.mouthHistory = [];
    }

    // 2) Qo'l / imo-ishora (yuklangani bo'lsa)
    if (this.handLandmarker) {
      try {
        const hres = this.handLandmarker.detectForVideo(v, ts + 0.001);
        const hands = hres?.landmarks?.length || 0;
        if (this.streak('hand', hands > 0, STREAK.hand)) this.emit('HAND_GESTURE_SUSPECTED');
      } catch {
        /* ignore */
      }
    }
  }

  /** Yuzning kadr ichidagi holati — overlay uchun tez javob. */
  private checkFacePosition(lm: FaceLandmark[]): FaceStatusLive {
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
      nose.x < FACE_CTR_X_MIN ||
      nose.x > FACE_CTR_X_MAX ||
      nose.y < FACE_CTR_Y_MIN ||
      nose.y > FACE_CTR_Y_MAX
    ) return 'OFF_CENTER';

    const width = right.x - left.x || 1e-6;
    const noseRelX = (nose.x - left.x) / width - 0.5;
    if (Math.abs(noseRelX) >= YAW_HARD) return 'TURNED';
    if (Math.abs(noseRelX) >= YAW_TURN) return 'GAZE_AWAY';

    return 'OK';
  }

  private analyzeHeadAndMovement(lm: FaceLandmark[]): void {
    // MediaPipe FaceMesh indekslari: burun=1, chap yuz cheti=234, o'ng=454, manglay=10, iyak=152
    const nose = lm[1];
    const left = lm[234];
    const right = lm[454];
    const top = lm[10];
    const chin = lm[152];
    if (!nose || !left || !right || !top || !chin) return;

    // Yaw (chap/o'ng burilish): burun gorizontal pozitsiyasi yuz kengligida.
    const width = right.x - left.x || 1e-6;
    const noseRelX = (nose.x - left.x) / width - 0.5; // ~0 markaz
    // Pitch (tepa/past): burun vertikal pozitsiyasi manglay-iyak orasida.
    const height = chin.y - top.y || 1e-6;
    const noseRelY = (nose.y - top.y) / height; // ~0.5 markaz

    const absYaw = Math.abs(noseRelX);
    if (absYaw >= YAW_HARD) {
      if (this.streak('turn', true, STREAK.gaze)) this.emit('FACE_TURNED_AWAY');
    } else if (absYaw >= YAW_TURN) {
      this.streaks['turn'] = 0;
      const key = noseRelX < 0 ? 'gazeR' : 'gazeL';
      if (this.streak(key, true, STREAK.gaze)) {
        this.emit(noseRelX < 0 ? 'GAZE_AWAY_RIGHT' : 'GAZE_AWAY_LEFT');
      }
    } else {
      this.streaks['turn'] = 0;
      this.streaks['gazeL'] = 0;
      this.streaks['gazeR'] = 0;
    }

    if (this.streak('gazeUp', noseRelY <= PITCH_UP, STREAK.gaze)) this.emit('GAZE_AWAY_UP');
    if (this.streak('gazeDown', noseRelY >= PITCH_DOWN, STREAK.gaze)) this.emit('GAZE_AWAY_DOWN');

    // 3) Ortiqcha qimirlash: burun nuqtasining frame'lararo siljishi (EMA bilan tekislash).
    if (this.prevNose) {
      const dx = nose.x - this.prevNose.x;
      const dy = nose.y - this.prevNose.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      this.moveEma = this.moveEma * 0.7 + d * 0.3;
      if (this.streak('move', this.moveEma >= MOVE_THRESHOLD, STREAK.movement)) {
        this.emit('EXCESSIVE_MOVEMENT');
      }
    }
    this.prevNose = { x: nose.x, y: nose.y };

    // 4) Og'iz qimirlashi (gapirish): yuqori/pastki lab orasi yuz balandligiga nisbatan.
    //    Ochilib-yopilish tebranishi (oscillation) = gapirish. Ovozdan mustaqil ishlaydi.
    this.detectMouthMovement(lm, height);
  }

  // MediaPipe FaceMesh: yuqori ichki lab=13, pastki ichki lab=14
  private detectMouthMovement(lm: FaceLandmark[], faceHeight: number): void {
    const upper = lm[13];
    const lower = lm[14];
    if (!upper || !lower) return;
    const openRatio = Math.abs(lower.y - upper.y) / (faceHeight || 1e-6);

    // Oyna qisqartirildi (14->9, min 8->6) — tezroq aniqlash uchun; crossings talabi
    // ham 3->2 ga tushirildi (baribir yolg'iz bitta chekka emas, tebranish talab qilinadi).
    const hist = this.mouthHistory;
    hist.push(openRatio);
    if (hist.length > 9) hist.shift(); // ~1.17s oyna
    if (hist.length < 6) return;

    // Tebranishni hisoblash: o'rtacha atrofida yuqoriga/pastga kesishishlar soni.
    const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
    const amp = Math.max(...hist) - Math.min(...hist);
    let crossings = 0;
    for (let i = 1; i < hist.length; i++) {
      if ((hist[i - 1] - mean) * (hist[i] - mean) < 0) crossings++;
    }
    // Gapirish: og'iz bir necha marta ochilib-yopiladi + amplituda yetarli.
    const talking = crossings >= 1 && amp >= 0.022;
    if (this.streak('mouth', talking, 2)) this.emit('MOUTH_MOVEMENT_TALKING');
  }
}
