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

/**
 * "Davomiy" tabiatga ega signallar (gapirish, boshning burilishi, pozitsiya) uchun
 * ikki bosqichli qoida (README.md "Proctoring eskalatsiya qoidasi"):
 *   1) LIVE_SIGNAL_CONFIRM_MS (1.5s) uzluksiz davom etsa — kamera panelida kichik
 *      vizual ogohlantirish chiqadi (hali rasmiy emas, backendga yuborilmaydi).
 *   2) Signal shundan keyin ham davom etib, jami LIVE_SIGNAL_ESCALATE_MS (4s) ga
 *      yetsa — haqiqiy (backendga yuboriladigan) rasmiy ogohlantirishga aylanadi
 *      (ya'ni kichikdan keyin yana ~2.5s tuzatishga vaqt beriladi).
 * Yuz yo'q (NO_FACE) va ko'p yuz (MULTI_FACE) ham shu qonunga bo'ysunadi — lekin
 * identity xavfsizligi uchun "recheck" darhol ishlaydi (rasmiy violation esa 4s da).
 */
export type LiveSignalType =
  | 'TALKING'
  | 'HEAD_AWAY'
  | 'TOO_FAR'
  | 'TOO_CLOSE'
  | 'OFF_CENTER'
  | 'MOVEMENT'
  | 'HAND'
  | 'NO_FACE'
  | 'MULTI_FACE';
export const LIVE_SIGNAL_CONFIRM_MS = 1500;
export const LIVE_SIGNAL_ESCALATE_MS = 4000;

// Kichik chip (kamera panelidagi sariq qator) FAQAT shu turlar uchun chiqadi.
// Qolganlari (pozitsiya/gaze/yuz) kamera badge'ida ko'rsatiladi — takror bo'lmasin.
const CHIP_SIGNAL_TYPES = new Set<LiveSignalType>(['TALKING', 'MOVEMENT', 'HAND']);

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

// BARCHA real-time signal turi (yuz yo'q/ko'p yuz, gaze, pozitsiya, qimirlash,
// qo'l, og'iz) kichik→katta eskalatsiya qoidasiga o'tkazilgan (trackContinuous +
// LIVE_SIGNAL_ESCALATE_MS). Bu yerda alohida streak konstantalar shart emas.

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
// Burun nuqtasining frame'lararo o'rtacha siljishi. Uzoq imtihon davomida talaba
// charchab, oddiy o'tirishda ham biroz qimirlaydi — bu tabiiy, jazolanmasin.
// Faqat HADDAN TASHQARI (doimiy) qimirlash uchun (qonun: 1.5s kichik, 3s rasmiy).
const MOVE_THRESHOLD = 0.085;

export interface RealtimeProctorCallbacks {
  onViolation: (type: RealtimeViolation) => void;
  /** Yuz almashishi shubhasi (yo'qolib qayta paydo bo'ldi yoki ko'p yuz) —
   *  ExamRoom darhol server identity-compare ishga tushiradi (person-swap'ni tez ushlash). */
  onRecheckIdentity?: () => void;
  /** Har kadrda real-time yuz holati — kamera overlay uchun, violation emas. */
  onFaceStatus?: (status: FaceStatusLive) => void;
  /** Davomiy signal (gapirish/bosh burilishi/pozitsiya) hozir faolmi va necha ms'dan
   *  beri uzluksiz davom etyapti. Faol signal yo'q bo'lsa `type=null` bilan chaqiriladi. */
  onLiveSignal?: (type: LiveSignalType | null, elapsedMs: number) => void;
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
  // Davomiy signal (kichik→katta eskalatsiya) uchun — necha vaqtdan beri uzluksiz faol.
  private activeSince: Record<string, number> = {};
  private lastActiveAt: Record<string, number> = {};
  private prevNose: { x: number; y: number } | null = null;
  private moveEma = 0;
  // Yuz almashishi (person-swap) triggeri uchun
  private faceWasAbsent = false;
  private lastRecheck = 0;
  // Og'iz qimirlashi (gapirish) aniqlash
  private mouthHistory: number[] = [];
  private jawOpenHistory: number[] = [];
  // Shu freym uchun davomiy signallarning uzluksiz davomiyligi (ms) — kadr oxirida
  // eng "shoshilinch"i tanlanib onLiveSignal orqali xabar qilinadi.
  private liveMs: Record<LiveSignalType, number> = {
    TALKING: 0,
    HEAD_AWAY: 0,
    TOO_FAR: 0,
    TOO_CLOSE: 0,
    OFF_CENTER: 0,
    MOVEMENT: 0,
    HAND: 0,
    NO_FACE: 0,
    MULTI_FACE: 0,
  };

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
        outputFaceBlendshapes: true,
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
    const cooldown =
      type === 'MOUTH_MOVEMENT_TALKING' ? 2200 : PER_TYPE_COOLDOWN_MS;
    if (now - (this.lastEmit[type] || 0) < cooldown) return;
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

  /**
   * Xom signal necha ms'dan beri uzluksiz faolligini qaytaradi (0 = faol emas).
   * Freym-flicker (bitta kadr o'tkazib yuborilishi) hisoblagichni buzmasin deb,
   * qisqa uzilishga (graceMs) toqat qilinadi.
   */
  private trackContinuous(key: string, rawActive: boolean, graceMs = 500): number {
    const now = Date.now();
    if (rawActive) {
      if (!this.activeSince[key]) this.activeSince[key] = now;
      this.lastActiveAt[key] = now;
      return now - this.activeSince[key];
    }
    const last = this.lastActiveAt[key];
    if (last && now - last <= graceMs) {
      return this.activeSince[key] ? now - this.activeSince[key] : 0;
    }
    delete this.activeSince[key];
    delete this.lastActiveAt[key];
    return 0;
  }

  private detectOnce(): void {
    const v = this.video;
    if (!v || v.readyState < 2 || v.videoWidth === 0) return;
    const ts = performance.now();

    // 0) Qo'l/imo-ishora — YUZDAN OLDIN tekshiramiz: qo'l yuzga yaqin/ustida bo'lsa,
    // FaceLandmarker og'iz nuqtalarini noto'g'ri o'qib, soxta "gapiryapti" signali
    // berishi mumkin (occlusion) — shu holatni og'iz tekshiruviga xabar beramiz.
    let handsPresent = false;
    if (this.handLandmarker) {
      try {
        const hres = this.handLandmarker.detectForVideo(v, ts + 0.001);
        handsPresent = (hres?.landmarks?.length || 0) > 0;
      } catch {
        /* ignore */
      }
    }
    // Qo'l ko'tarish — endi ham kichik→katta eskalatsiya qoidasiga bo'ysunadi
    // (README.md "Proctoring eskalatsiya qoidasi"): 1.5s kichik, 3s rasmiy.
    // Oldin darhol (~0.4s) rasmiy ogohlantirish berardi — qo'lni bir zum ko'tarish
    // ham darhol blokka olib kelardi, bu qonunga zid edi.
    this.liveMs.HAND = this.trackContinuous('hand', handsPresent);
    if (this.liveMs.HAND >= LIVE_SIGNAL_ESCALATE_MS) this.emit('HAND_GESTURE_SUSPECTED');

    let faces: FaceLandmark[][] = [];
    let faceBlendshapes: Array<{ categoryName: string; score: number }> | undefined;
    try {
      const res = this.faceLandmarker.detectForVideo(v, ts);
      faces = res?.faceLandmarks || [];
      faceBlendshapes = res?.faceBlendshapes?.[0]?.categories;
    } catch {
      return;
    }

    const faceCount = faces.length;

    // 1) Yuz yo'q / ko'p yuz — kichik→katta eskalatsiya (qonun): 1.5s kichik, 3s rasmiy.
    // Identity xavfsizligi uchun "recheck" DARHOL ishlaydi (kim o'tirganini tez ushlash),
    // lekin RASMIY violation faqat holat uzluksiz 3s davom etsagina yuboriladi.
    this.liveMs.NO_FACE = this.trackContinuous('noFace', faceCount === 0);
    if (this.liveMs.NO_FACE >= LIVE_SIGNAL_ESCALATE_MS) this.emit('FACE_NOT_VISIBLE');
    this.liveMs.MULTI_FACE = this.trackContinuous('multiFace', faceCount >= 2);
    if (this.liveMs.MULTI_FACE >= LIVE_SIGNAL_ESCALATE_MS) this.emit('MULTIPLE_FACES');

    // Person-swap: yuz yo'qolib qayta paydo bo'lsa — kim qaytganini tekshir (darhol).
    if (faceCount === 0) {
      this.faceWasAbsent = true;
      this.cb.onFaceStatus?.('NO_FACE');
    } else if (this.faceWasAbsent) {
      this.faceWasAbsent = false;
      this.requestRecheck();
    }

    if (faceCount >= 2) {
      this.cb.onFaceStatus?.('MULTIPLE_FACES');
      this.requestRecheck(); // ko'p yuz — kim o'tirganini darhol tekshir
    }

    if (faceCount >= 1) {
      const posStatus = this.checkFacePosition(faces[0]);
      this.cb.onFaceStatus?.(posStatus);

      // Pozitsiya — kichik→katta eskalatsiya: uzluksiz LIVE_SIGNAL_ESCALATE_MS
      // davom etsagina rasmiy violation yuboriladi.
      this.liveMs.TOO_FAR = this.trackContinuous('tooFar', posStatus === 'TOO_FAR');
      this.liveMs.TOO_CLOSE = this.trackContinuous('tooClose', posStatus === 'TOO_CLOSE');
      this.liveMs.OFF_CENTER = this.trackContinuous('offCenter', posStatus === 'OFF_CENTER');
      if (this.liveMs.TOO_FAR >= LIVE_SIGNAL_ESCALATE_MS) this.emit('FACE_TOO_FAR');
      if (this.liveMs.TOO_CLOSE >= LIVE_SIGNAL_ESCALATE_MS) this.emit('FACE_TOO_CLOSE');
      if (this.liveMs.OFF_CENTER >= LIVE_SIGNAL_ESCALATE_MS) this.emit('FACE_OFF_CENTER');

      this.analyzeHeadAndMovement(faces[0], faceBlendshapes, handsPresent);
    } else {
      // Yuz yo'q — barcha yuzga bog'liq davomiy signallarni so'ndiramiz. MOVEMENT/HAND
      // ham reset qilinmasa, yuz yo'qolganda eskirgan qiymat kamera panelida noto'g'ri
      // chip ko'rsatishi mumkin edi (masalan "qimirlash" — yuz yo'q bo'lsa ham).
      this.liveMs.TOO_FAR = this.trackContinuous('tooFar', false);
      this.liveMs.TOO_CLOSE = this.trackContinuous('tooClose', false);
      this.liveMs.OFF_CENTER = this.trackContinuous('offCenter', false);
      this.liveMs.HEAD_AWAY = 0;
      this.liveMs.TALKING = this.trackContinuous('mouth', false);
      this.liveMs.MOVEMENT = this.trackContinuous('move', false);
      this.moveEma = 0;
      this.prevNose = null;
      this.mouthHistory = [];
      this.jawOpenHistory = [];
    }

    // Kichik chip (onLiveSignal) — FAQAT badge'siz signallar uchun. Pozitsiya/gaze/yuz
    // (NO_FACE, MULTI_FACE, TOO_FAR/CLOSE, OFF_CENTER, HEAD_AWAY) allaqachon kamera
    // badge'ida (fsCfg) ko'rsatiladi — chip ularni takrorlamasin. Gapirish, qimirlash,
    // qo'l ko'tarishning badge'i yo'q, shu sabab ular uchun chip kerak.
    const best = (Object.entries(this.liveMs) as Array<[LiveSignalType, number]>)
      .filter(([type, ms]) => CHIP_SIGNAL_TYPES.has(type) && ms >= LIVE_SIGNAL_CONFIRM_MS)
      .sort((a, b) => b[1] - a[1])[0];
    this.cb.onLiveSignal?.(best ? best[0] : null, best ? best[1] : 0);
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

  private analyzeHeadAndMovement(
    lm: FaceLandmark[],
    blendshapes?: Array<{ categoryName: string; score: number }>,
    handsPresent = false,
  ): void {
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

    // Bosh burilishi/gaze — kichik→katta eskalatsiya: yo'nalish qaysi bo'lishidan
    // qat'iy nazar, kamera panelida umumiy "HEAD_AWAY" sifatida ko'rsatiladi;
    // rasmiy violation esa aniq yo'nalish bo'yicha alohida hisoblanadi.
    const absYaw = Math.abs(noseRelX);
    const turnMs = this.trackContinuous('turn', absYaw >= YAW_HARD);
    if (turnMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('FACE_TURNED_AWAY');

    const gazeLActive = absYaw >= YAW_TURN && absYaw < YAW_HARD && noseRelX >= 0;
    const gazeRActive = absYaw >= YAW_TURN && absYaw < YAW_HARD && noseRelX < 0;
    const gazeLMs = this.trackContinuous('gazeL', gazeLActive);
    const gazeRMs = this.trackContinuous('gazeR', gazeRActive);
    if (gazeLMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('GAZE_AWAY_LEFT');
    if (gazeRMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('GAZE_AWAY_RIGHT');

    const gazeUpMs = this.trackContinuous('gazeUp', noseRelY <= PITCH_UP);
    const gazeDownMs = this.trackContinuous('gazeDown', noseRelY >= PITCH_DOWN);
    if (gazeUpMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('GAZE_AWAY_UP');
    if (gazeDownMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('GAZE_AWAY_DOWN');

    this.liveMs.HEAD_AWAY = Math.max(turnMs, gazeLMs, gazeRMs, gazeUpMs, gazeDownMs);

    // 3) Ortiqcha qimirlash: burun nuqtasining frame'lararo siljishi (EMA bilan tekislash).
    // Oddiy o'tirishdagi mayda harakat (charchoq, holatni to'g'irlash) jazolanmasin —
    // kichik→katta eskalatsiya (qonun): 1.5s kichik, 3s rasmiy.
    if (this.prevNose) {
      const dx = nose.x - this.prevNose.x;
      const dy = nose.y - this.prevNose.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      this.moveEma = this.moveEma * 0.7 + d * 0.3;
      this.liveMs.MOVEMENT = this.trackContinuous('move', this.moveEma >= MOVE_THRESHOLD);
      if (this.liveMs.MOVEMENT >= LIVE_SIGNAL_ESCALATE_MS) this.emit('EXCESSIVE_MOVEMENT');
    }
    this.prevNose = { x: nose.x, y: nose.y };

    // 4) Og'iz qimirlashi (gapirish): blendshape jawOpen + lab landmark tebranishi.
    this.detectMouthMovement(lm, blendshapes, handsPresent);
  }

  private detectMouthMovement(
    lm: FaceLandmark[],
    blendshapes?: Array<{ categoryName: string; score: number }>,
    handsPresent = false,
  ): void {
    let talking = false;

    // MediaPipe blendshape — eng ishonchli yo'l. Tarix oynasi ATAYLAB qisqa (8 kadr
    // ~1s): talaba og'zini to'xtatgach, harakat namunalari tez "eskiradi" va `talking`
    // darhol o'chadi. Aks holda (uzun oyna) to'xtagandan keyin ham bir necha soniya
    // "gapiryapti" deb sanalib, kichik ogohlantirishda to'xtasa ham rasmiy kelardi.
    const jaw = blendshapes?.find((b) => b.categoryName === 'jawOpen');
    if (jaw) {
      const jawHist = this.jawOpenHistory;
      jawHist.push(jaw.score);
      if (jawHist.length > 8) jawHist.shift();
      // Joriy kadr og'iz yopiq bo'lsa (past jawOpen), harakat allaqachon tugagan —
      // tarixga qaramay tez bo'shatamiz (faqat aniq davomiy harakatda talking=true).
      const jawClosedNow = jaw.score < 0.12;
      if (!jawClosedNow && jawHist.length >= 5) {
        const mean = jawHist.reduce((a, b) => a + b, 0) / jawHist.length;
        const amp = Math.max(...jawHist) - Math.min(...jawHist);
        let crossings = 0;
        for (let i = 1; i < jawHist.length; i++) {
          if ((jawHist[i - 1] - mean) * (jawHist[i] - mean) < 0) crossings++;
        }
        talking =
          (crossings >= 3 && amp >= 0.055) ||
          (jaw.score >= 0.22 && amp >= 0.04) ||
          jawHist.filter((s) => s >= 0.15).length >= 4;
      }
    }

    // Landmark zaxira: og'iz kengligi (MAR) tebranishi.
    if (!talking) {
      const upper = lm[13];
      const lower = lm[14];
      const left = lm[61];
      const right = lm[291];
      if (upper && lower && left && right) {
        const vertical = Math.abs(lower.y - upper.y);
        const horizontal = Math.abs(right.x - left.x) || 1e-6;
        const mar = vertical / horizontal;
        const hist = this.mouthHistory;
        hist.push(mar);
        if (hist.length > 8) hist.shift();
        if (hist.length >= 5) {
          const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
          const amp = Math.max(...hist) - Math.min(...hist);
          let crossings = 0;
          for (let i = 1; i < hist.length; i++) {
            if ((hist[i - 1] - mean) * (hist[i] - mean) < 0) crossings++;
          }
          talking = crossings >= 3 && amp >= 0.016;
        }
      }
    }

    // Qo'l yuz/og'iz ustida yoki yaqinida bo'lsa — landmark occlusion soxta
    // "gapiryapti" signali berishi mumkin, shu sabab bu freymda hisobga olinmaydi.
    const talking2 = talking && !handsPresent;

    // Gapirish — kichik→katta eskalatsiya. Grace qisqa (350ms): to'xtaganда darhol
    // bo'shasin — shunda kichik ogohlantirishda to'xtagan talaba rasmiy olmaydi.
    const talkMs = this.trackContinuous('mouth', talking2, 350);
    if (talkMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('MOUTH_MOVEMENT_TALKING');
    this.liveMs.TALKING = talkMs;
  }
}
