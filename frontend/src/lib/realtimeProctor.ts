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
// JIDDIY, aniq qoidabuzarliklar (yuz umuman yo'q = turib ketdi/chiqib ketdi; kadrda
// ko'p yuz = kimdir keldi) uchun TEZ eskalatsiya — bularni "tuzatishga vaqt berish"
// mantig'i shart emas, darhol ushlash kerak.
export const LIVE_SIGNAL_ESCALATE_FAST_MS = 1600;

// GAPIRISH uchun MAXSUS (tezroq) qoida — README.md "Gapirish uchun maxsus qoida".
// Og'iz qimirlashi (video) VA tashqi odam ovozi (audio):
//   ~0.9s uzluksiz → kichik ogohlantirish, ~2.5s → rasmiy.
// Ilgari kichik ogohlantirish 0ms (bitta freym) edi — tinch o'tirganda ham
// nafas/mikrofon shovqini soxta signal berardi. Endi qisqa tasodifiy spike
// modal ochmaydi; haqiqiy gapirish (≥1s) hali ham tez ushlanadi.
// Shovqin (SUSPICIOUS_AUDIO) bunga KIRMAYDI.
export const TALK_SIGNAL_CONFIRM_MS = 900;
export const TALK_SIGNAL_ESCALATE_MS = 2500;

/** Shu signal turi uchun "kichik ogohlantirish" chegarasi (gapirish tezroq). */
export function confirmMsFor(type: LiveSignalType): number {
  return type === 'TALKING' ? TALK_SIGNAL_CONFIRM_MS : LIVE_SIGNAL_CONFIRM_MS;
}

/**
 * Kichik ogohlantirish (live signal) qaysi RASMIY violation turiga aylanadi.
 * "3 kichik → 4-si rasmiy" qonunida kerak: limit to'lganda ExamRoom shu turni
 * darhol backendga yuboradi.
 */
const LIVE_SIGNAL_TO_VIOLATION: Record<LiveSignalType, RealtimeViolation> = {
  TALKING: 'MOUTH_MOVEMENT_TALKING',
  HEAD_AWAY: 'FACE_TURNED_AWAY',
  TOO_FAR: 'FACE_TOO_FAR',
  TOO_CLOSE: 'FACE_TOO_CLOSE',
  OFF_CENTER: 'FACE_OFF_CENTER',
  MOVEMENT: 'EXCESSIVE_MOVEMENT',
  HAND: 'HAND_GESTURE_SUSPECTED',
  NO_FACE: 'FACE_NOT_VISIBLE',
  MULTI_FACE: 'MULTIPLE_FACES',
};

export function liveSignalViolationType(type: LiveSignalType): RealtimeViolation {
  return LIVE_SIGNAL_TO_VIOLATION[type];
}

/** Video manbadan kelishi mumkin bo'lgan barcha violation turlari (ledger'ni tozalash uchun). */
export const ALL_LIVE_SIGNAL_VIOLATIONS: RealtimeViolation[] =
  Object.values(LIVE_SIGNAL_TO_VIOLATION);

// Kichik chip (kamera panelidagi sariq qator) shu turlar uchun chiqadi. Pozitsiya/gaze
// (uzoq/yaqin/markaz/burilish) kamera badge'ida ko'rsatiladi — takror bo'lmasin. Lekin
// yuz yo'q / ko'p yuz — jiddiy, shu sabab ular ham chip bilan aniq ko'rsatiladi.
const CHIP_SIGNAL_TYPES = new Set<LiveSignalType>([
  'TALKING',
  'MOVEMENT',
  'HAND',
  'NO_FACE',
  'MULTI_FACE',
]);

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
const DETECT_INTERVAL_MS = 150; // ~6.5 fps (yuk/tezlik balansi — proctoring uchun yetarli)
// Qo'l modeli har necha kadrda ishlasin (performance). 3 = ~2.5 fps qo'l uchun —
// qo'l ko'tarish sekin (3-4s eskalatsiya), shu sabab yetarli; MediaPipe yuki kamayadi.
const HAND_DETECT_EVERY = 3;
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

// --- Qorachiq (iris) asosidagi ko'z yo'nalishi ---
// MediaPipe 478 nuqta beradi: 468 = chap iris markazi, 473 = o'ng iris markazi.
// Bosh to'g'ri turgan holda ham ko'z chetga qarasa (yonidagi qog'oz/telefon) shu aniqlaydi.
const IRIS_L = 468;
const IRIS_R = 473;
// Ko'z burchaklari va qovoqlari (chap: 33/133 burchak, 159/145 tepa/past;
// o'ng: 362/263 burchak, 386/374 tepa/past).
const EYE_L = { out: 33, in: 133, top: 159, bot: 145 };
const EYE_R = { out: 263, in: 362, top: 386, bot: 374 };
/** Qorachiq ko'z kengligining shuncha ulushiga siljisa — chetga qaragan hisoblanadi. */
const IRIS_GAZE_X = 0.16;
/** Pastga qarash (qog'oz/telefon tizzada) — ko'z balandligiga nisbatan. */
const IRIS_GAZE_DOWN = 0.32;
/** Ko'z ochiqligi (balandlik/kenglik). Bundan past — ko'z yumuq, iris ishonchsiz. */
const EYE_OPEN_MIN_RATIO = 0.15;

interface Pt {
  x: number;
  y: number;
}

/**
 * Qorachiq (iris) asosida ko'z yo'nalishi — SOF funksiya (test qilinadi).
 *
 * Bosh to'g'ri turgan holda ham ko'z chetga/pastga qarasa aniqlaydi (yonidagi
 * qog'oz, telefon, ikkinchi ekran). Qaytaradi: `{ dx, dy }` — qorachiqning ko'z
 * markazidan siljishi (ko'z o'lchamiga nisbatan; dx>0 → tasvirda o'ngga,
 * dy>0 → pastga). `null` = ishonchsiz (ko'z yumuq yoki iris nuqtalari yo'q).
 */
export function computeIrisGaze(lm: Pt[]): { dx: number; dy: number } | null {
  // Iris nuqtalari faqat 478-nuqtali modelda bor — bo'lmasa jim o'tkazamiz.
  if (!lm || lm.length <= IRIS_R) return null;

  const eyeOffset = (
    iris: Pt | undefined,
    c1: Pt | undefined,
    c2: Pt | undefined,
    top: Pt | undefined,
    bot: Pt | undefined,
  ): { dx: number; dy: number } | null => {
    if (!iris || !c1 || !c2 || !top || !bot) return null;
    const w = Math.abs(c2.x - c1.x);
    const h = Math.abs(bot.y - top.y);
    if (w < 1e-4) return null;
    // Ko'z yumuq bo'lsa iris pozitsiyasi ishonchsiz — o'tkazib yuboramiz.
    if (h / w < EYE_OPEN_MIN_RATIO) return null;
    const cx = (c1.x + c2.x) / 2;
    const cy = (top.y + bot.y) / 2;
    return { dx: (iris.x - cx) / w, dy: (iris.y - cy) / h };
  };

  const l = eyeOffset(lm[IRIS_L], lm[EYE_L.out], lm[EYE_L.in], lm[EYE_L.top], lm[EYE_L.bot]);
  const r = eyeOffset(lm[IRIS_R], lm[EYE_R.out], lm[EYE_R.in], lm[EYE_R.top], lm[EYE_R.bot]);
  if (l && r) return { dx: (l.dx + r.dx) / 2, dy: (l.dy + r.dy) / 2 };
  return l ?? r;
}

/** Ko'z chetga/pastga qaraganmi (chegaralar bilan). */
export function isIrisGazeAway(iris: { dx: number; dy: number } | null): boolean {
  if (iris == null) return false;
  return Math.abs(iris.dx) >= IRIS_GAZE_X || iris.dy >= IRIS_GAZE_DOWN;
}

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
  /** Hozir "kichik ogohlantirish" bosqichidagi BARCHA signallar (chipsizlari ham).
   *  `SmallWarningLedger` shular asosida "3 kichik → 4-si rasmiy" qonunini qo'llaydi. */
  onSmallWarningStage?: (types: LiveSignalType[]) => void;
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
  // Performance: qo'l modelini har kadrda emas, har HAND_DETECT_EVERY kadrda ishlatamiz
  // (qo'l ko'tarish sekin harakat — 7fps shart emas). Bu MediaPipe yukini kamaytiradi.
  private frameCount = 0;
  private lastHandsPresent = false;

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
        // Performance: 2 ta yuz yetarli (ko'p yuz = >=2 ni aniqlash uchun). 3 ta yuz
        // izlash har kadrda ortiqcha yuk edi.
        numFaces: 2,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: false,
      });

      // Qo'l/imo-ishora — yuklanmasa ham face detection ishlayveradi.
      try {
        this.handLandmarker = await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
          runningMode: 'VIDEO',
          // Performance: bitta qo'l yetarli (qo'l bor/yo'qligini bilish uchun).
          numHands: 1,
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

    // MUHIM: og'ir MediaPipe inference'i requestAnimationFrame ichida BAJARILMAYDI.
    // Ilgari shunday edi va Chrome ochiq-oydin shikoyat qilardi:
    //   [Violation] 'requestAnimationFrame' handler took <N>ms
    // rAF ishlovchisi joriy kadrni ushlab turadi — brauzer u tugamaguncha ekranga
    // hech narsa chiza olmaydi, natijada ko'rinadigan qotishlar bo'ladi.
    //
    // Endi rAF faqat "sahifa ko'rinyapti va chizilyapti" darvozasi sifatida
    // ishlatiladi (fon tabda rAF chaqirilmaydi — bekorga CPU yemaymiz), tahlil esa
    // kadr chizilgandan KEYIN, alohida makrotaskda ishlaydi.
    const analyse = () => {
      if (!this.running) return;
      this.detectOnce();
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
    // Performance: qo'l modeli har HAND_DETECT_EVERY kadrda ishlaydi (oradagi kadrlarda
    // oxirgi natija ishlatiladi — qo'l holati 260ms da keskin o'zgarmaydi).
    this.frameCount += 1;
    let handsPresent = this.lastHandsPresent;
    if (this.handLandmarker && this.frameCount % HAND_DETECT_EVERY === 0) {
      try {
        const hres = this.handLandmarker.detectForVideo(v, ts + 0.001);
        handsPresent = (hres?.landmarks?.length || 0) > 0;
        this.lastHandsPresent = handsPresent;
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

    // 1) Yuz yo'q / ko'p yuz — JIDDIY, TEZ eskalatsiya (~1.6s). Yuz umuman yo'q =
    // talaba turib/chiqib ketdi; ko'p yuz = kimdir keldi. Bularni "tuzatishga vaqt"
    // berish mantig'i shart emas — darhol ushlash kerak. "recheck" ham darhol ishlaydi.
    this.liveMs.NO_FACE = this.trackContinuous('noFace', faceCount === 0);
    if (this.liveMs.NO_FACE >= LIVE_SIGNAL_ESCALATE_FAST_MS) this.emit('FACE_NOT_VISIBLE');
    this.liveMs.MULTI_FACE = this.trackContinuous('multiFace', faceCount >= 2);
    if (this.liveMs.MULTI_FACE >= LIVE_SIGNAL_ESCALATE_FAST_MS) this.emit('MULTIPLE_FACES');

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
      let posStatus = this.checkFacePosition(faces[0]);
      // Qorachiq (iris) — bosh to'g'ri turgan bo'lsa ham ko'z chetga/pastga qarasa,
      // badge'da "Kameraga qarang" ko'rsatamiz (aks holda talaba hech qanday
      // fikr-mulohaza olmasdi: bosh pozitsiyasi "OK" bo'lardi).
      const iris = this.irisGaze(faces[0]);
      if (posStatus === 'OK' && isIrisGazeAway(iris)) posStatus = 'GAZE_AWAY';
      this.cb.onFaceStatus?.(posStatus);

      // Pozitsiya — kichik→katta eskalatsiya: uzluksiz LIVE_SIGNAL_ESCALATE_MS
      // davom etsagina rasmiy violation yuboriladi.
      this.liveMs.TOO_FAR = this.trackContinuous('tooFar', posStatus === 'TOO_FAR');
      this.liveMs.TOO_CLOSE = this.trackContinuous('tooClose', posStatus === 'TOO_CLOSE');
      this.liveMs.OFF_CENTER = this.trackContinuous('offCenter', posStatus === 'OFF_CENTER');
      if (this.liveMs.TOO_FAR >= LIVE_SIGNAL_ESCALATE_MS) this.emit('FACE_TOO_FAR');
      if (this.liveMs.TOO_CLOSE >= LIVE_SIGNAL_ESCALATE_MS) this.emit('FACE_TOO_CLOSE');
      if (this.liveMs.OFF_CENTER >= LIVE_SIGNAL_ESCALATE_MS) this.emit('FACE_OFF_CENTER');

      this.analyzeHeadAndMovement(faces[0], faceBlendshapes, handsPresent, iris);
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
    const atConfirmStage = (Object.entries(this.liveMs) as Array<[LiveSignalType, number]>).filter(
      ([type, ms]) => ms > 0 && ms >= confirmMsFor(type),
    );

    // "3 kichik → 4-si rasmiy" qonuni uchun: BARCHA kichik-ogohlantirish bosqichidagi
    // signallar (chip ko'rinmaydiganlari — pozitsiya/gaze — ham, ular badge'da
    // ko'rsatiladi va bari bir kichik ogohlantirish hisoblanadi).
    // Chip'dan OLDIN chaqiriladi — chip yorlig'i yangi hisobni ko'rsata olsin.
    this.cb.onSmallWarningStage?.(atConfirmStage.map(([type]) => type));

    const best = atConfirmStage
      .filter(([type]) => CHIP_SIGNAL_TYPES.has(type))
      .sort((a, b) => b[1] - a[1])[0];
    this.cb.onLiveSignal?.(best ? best[0] : null, best ? best[1] : 0);
  }

  private irisGaze(lm: FaceLandmark[]): { dx: number; dy: number } | null {
    return computeIrisGaze(lm);
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
    iris: { dx: number; dy: number } | null = null,
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

    // Qorachiq (iris) — bosh to'g'ri turgan bo'lsa ham ko'z chetga qarasa aniqlanadi.
    // Bosh-poza signali bilan BIRLASHTIRILADI (yo bosh burilgan, yo ko'z chetda).
    // Ko'z yumuq / iris yo'q bo'lsa `iris` = null → faqat bosh-poza ishlaydi.
    const irisLeft = iris != null && iris.dx >= IRIS_GAZE_X;
    const irisRight = iris != null && iris.dx <= -IRIS_GAZE_X;
    const irisDown = iris != null && iris.dy >= IRIS_GAZE_DOWN;

    const headGazeL = absYaw >= YAW_TURN && absYaw < YAW_HARD && noseRelX >= 0;
    const headGazeR = absYaw >= YAW_TURN && absYaw < YAW_HARD && noseRelX < 0;
    const gazeLActive = (headGazeL || irisLeft) && absYaw < YAW_HARD;
    const gazeRActive = (headGazeR || irisRight) && absYaw < YAW_HARD;
    const gazeLMs = this.trackContinuous('gazeL', gazeLActive);
    const gazeRMs = this.trackContinuous('gazeR', gazeRActive);
    if (gazeLMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('GAZE_AWAY_LEFT');
    if (gazeRMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('GAZE_AWAY_RIGHT');

    const gazeUpMs = this.trackContinuous('gazeUp', noseRelY <= PITCH_UP);
    const gazeDownMs = this.trackContinuous('gazeDown', noseRelY >= PITCH_DOWN || irisDown);
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
      // Joriy kadr og'iz ANIQ yopiq bo'lsa (juda past jawOpen), harakat tugagan —
      // tez bo'shatamiz. Chegara past (0.08) — sekin/yumshoq gapirishni o'tkazib
      // yubormasin (yumshoq nutqda jaw kichik ochiladi, lekin harakat bor).
      const jawClosedNow = jaw.score < 0.08;
      if (!jawClosedNow && jawHist.length >= 4) {
        const mean = jawHist.reduce((a, b) => a + b, 0) / jawHist.length;
        const amp = Math.max(...jawHist) - Math.min(...jawHist);
        let crossings = 0;
        for (let i = 1; i < jawHist.length; i++) {
          if ((jawHist[i - 1] - mean) * (jawHist[i] - mean) < 0) crossings++;
        }
        // Chegaralar biroz sezgirroq — yumshoq/sekin gapirish ham aniqlansin.
        talking =
          (crossings >= 3 && amp >= 0.04) ||
          (jaw.score >= 0.18 && amp >= 0.03) ||
          jawHist.filter((s) => s >= 0.12).length >= 3;
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
          talking = crossings >= 3 && amp >= 0.013;
        }
      }
    }

    // Qo'l yuz/og'iz ustida yoki yaqinida bo'lsa — landmark occlusion soxta
    // "gapiryapti" signali berishi mumkin, shu sabab bu freymda hisobga olinmaydi.
    const talking2 = talking && !handsPresent;

    // Gapirish — kichik→katta eskalatsiya. Grace qisqa (350ms): to'xtaganда darhol
    // bo'shasin — shunda kichik ogohlantirishda to'xtagan talaba rasmiy olmaydi.
    const talkMs = this.trackContinuous('mouth', talking2, 350);
    if (talkMs >= TALK_SIGNAL_ESCALATE_MS) this.emit('MOUTH_MOVEMENT_TALKING');
    this.liveMs.TALKING = talkMs;
  }
}
