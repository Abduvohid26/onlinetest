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
 * Modellar avval O'Z domenimizdan (`public/mediapipe/`, build paytida
 * `scripts/sync-mediapipe-assets.mjs` tayyorlaydi), u ochilmasa CDN zaxirasidan
 * lazy-load qilinadi — `lib/mediapipeAssets.ts` ga qarang.
 */
import { mediapipeAssetSources } from './mediapipeAssets';
import { ProctorWorkerClient } from './proctorWorkerClient';
import { classifyGaze, gazeMargins, type GazeFeature, type GazeModel } from './gazeMapping';

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
// Mikrofon Silero VAD (ExamRoom):
//   ~0.3s uzluksiz → kichik ogohlantirish, ~1.8s → rasmiy.
//
// 2026-08-03: 800/2500 → 300/1800. Sabab: 800ms bitta so'zni deyarli hech
// qachon ushlamasdi (haqiqiy so'z ~300-700ms) — talaba faqat 2+ so'z aytsa
// (pauza SPEECH_MIN_FRAMES/GRACE bilan ko'prik bo'lib) chip chiqardi.
// `verify_chain.py`da o'lchangan (LibriSpeech 80 nutq + ESC-50 124 shovqin,
// custom bitta-so'z simulyatsiyasi): chip 98.8%→100%, rasmiy 50-62%→91-92.5%,
// shovqin FP chip 0%→3.2% (arzon — jazosiz yorliq), rasmiy FP hamon 0%.
// Shovqin (SUSPICIOUS_AUDIO) bunga KIRMAYDI — undagi LIVE_SIGNAL_* o'zgarmadi.
export const TALK_SIGNAL_CONFIRM_MS = 300;
export const TALK_SIGNAL_ESCALATE_MS = 1800;

/** QONUN ISTISNOSI — darhol yorliq beriladigan turlar (0.4s).
 *  Sabab: gapirish va nigohni chetga olish bir zumda bo'ladi. 1.5s kutish
 *  talabaga javobni ko'rib olishga yetarli vaqt berardi. */
export const INSTANT_SIGNAL_CONFIRM_MS = 400;

/** Shu signal turi uchun "kichik ogohlantirish" chegarasi. */
export function confirmMsFor(type: LiveSignalType): number {
  if (type === 'TALKING' || type === 'HEAD_AWAY') return INSTANT_SIGNAL_CONFIRM_MS;
  return LIVE_SIGNAL_CONFIRM_MS;
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
  // TALKING chip/modal YO'Q — gapirish faqat Silero mikrofon VAD orqali (ExamRoom).
  'MOVEMENT',
  'HAND',
  'NO_FACE',
  'MULTI_FACE',
]);


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
/** Bazaviy qiymatning shu ulushidan past — qovoq tushgan (pastga qaragan). */
const EYE_NARROW_BASELINE_RATIO = 0.62;

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

/**
 * Ko'z shunchalik toraymi/yumuqmi ki, qorachiq o'qib bo'lmaydi.
 *
 * MUHIM: aynan shu holat nazoratdagi eng katta teshik edi. Talaba PASTGA
 * (tizzadagi telefonga) qaraganda qovoq tushadi, ko'z torayadi va
 * `computeIrisGaze` `null` qaytaradi — natijada nigoh nazorati JIM bo'lib
 * qolardi. Ya'ni telefonga qarash aniqlanmasdi.
 *
 * Endi bu holat o'zi "nigoh chetda" signali sifatida hisoblanadi. Ko'z
 * pirillashi (~200ms) uzluksiz vaqt talabidan (0.4s) qisqa, shuning uchun
 * jazolanmaydi.
 */
export function eyesTooNarrowForGaze(lm: Pt[], baseline?: number | null): boolean {
  if (!lm || lm.length <= IRIS_R) return false;
  const ratio = (c1?: Pt, c2?: Pt, top?: Pt, bot?: Pt): number | null => {
    if (!c1 || !c2 || !top || !bot) return null;
    const w = Math.abs(c2.x - c1.x);
    if (w < 1e-4) return null;
    return Math.abs(bot.y - top.y) / w;
  };
  const l = ratio(lm[EYE_L.out], lm[EYE_L.in], lm[EYE_L.top], lm[EYE_L.bot]);
  const r = ratio(lm[EYE_R.out], lm[EYE_R.in], lm[EYE_R.top], lm[EYE_R.bot]);
  const vals = [l, r].filter((v): v is number => v != null);
  if (vals.length === 0) return false;   // landmark yo'q — jim o'tamiz
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  // Bazaviy qiymat bo'lsa — NISBIY taqqoslash. Ko'z ochiqligi odamlar orasida
  // keskin farq qiladi (kimningki 0.30, kimningki 0.14 — ikkalasi normal), shu
  // sabab mutlaq chegara soxta ogohlantirish beradi. Imtihon oldi tekshiruvida
  // o'lchangan SHU talabaning tabiiy qiymatining 62% dan pastga tushishi —
  // qovoq tushgani, ya'ni pastga qaragani.
  if (typeof baseline === 'number' && baseline > 0) {
    return avg < baseline * EYE_NARROW_BASELINE_RATIO;
  }
  return avg < EYE_OPEN_MIN_RATIO;
}

/** Ko'z chetga/pastga qaraganmi (chegaralar bilan). */
export function isIrisGazeAway(iris: { dx: number; dy: number } | null): boolean {
  if (iris == null) return false;
  return Math.abs(iris.dx) >= IRIS_GAZE_X || iris.dy >= IRIS_GAZE_DOWN;
}

/**
 * Ishlab chiquvchi uchun xom nigoh o'lchovlari (har kadrda).
 *
 * FAQAT sozlash uchun: chegaralarni "havoda" tanlash o'rniga real qiymatlarni
 * ko'rib tanlash imkonini beradi. Talabaga hech qachon ko'rsatilmaydi —
 * `VITE_GAZE_DEBUG=1` bayrog'i ortida (`ExamRoom`).
 */
export interface GazeDebugInfo {
  /** Qorachiqning ko'z markazidan siljishi. `null` = ko'z yumuq/iris o'qilmadi. */
  iris: { dx: number; dy: number } | null;
  /** Ko'z shunchalik toraydi-ki iris ishonchsiz (pastga qarash belgisi). */
  eyesNarrow: boolean;
  /** Imtihon oldi tekshiruvida o'lchangan tabiiy ko'z ochiqligi. */
  eyeBaseline: number | null;
  /** Bosh pozasi: yaw = gorizontal og'ish (0 = markaz), pitch = vertikal (0.5 = markaz). */
  head: { yaw: number; pitch: number };
  /** Yuz balandligi kadrga nisbatan — MASOFA ko'rsatkichi (katta = yaqin). */
  faceHeight: number;
  /** Joriy qattiq chegaralar — grafikda chizish uchun. */
  thresholds: {
    irisX: number;
    irisDown: number;
    pitchUp: number;
    pitchDown: number;
    yawTurn: number;
    yawHard: number;
  };
  /** Hozir qaysi yo'nalish faol (chegaradan o'tgan). */
  active: { up: boolean; down: boolean; left: boolean; right: boolean; turn: boolean };
  /** Har yo'nalish bo'yicha uzluksiz davomiylik (ms) — eskalatsiya holati. */
  ms: { up: number; down: number; left: number; right: number; turn: number };
  /** O'rganilgan model bashorati (bo'lsa): ekran nuqtasi 0..1 va oraliq. */
  model: { sx: number; sy: number; marginX: number; marginY: number; samples: number } | null;
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
  /** Talaba og'zi qimirlayaptimi (Silero nutqini o'zi/boshqa deb ajratish uchun).
   *  Bu o'zi ogohlantirish bermaydi — faqat audio VAD bilan birga ishlatiladi. */
  onMouthActivity?: (active: boolean) => void;
  /** Hozir "kichik ogohlantirish" bosqichidagi BARCHA signallar (chipsizlari ham).
   *  `SmallWarningLedger` shular asosida "3 kichik → 4-si rasmiy" qonunini qo'llaydi. */
  onSmallWarningStage?: (types: LiveSignalType[]) => void;
  onReady?: (ok: boolean) => void;
  onStatus?: (msg: string) => void;
  /** Sozlash uchun xom o'lchovlar (VITE_GAZE_DEBUG). Prod'da berilmaydi. */
  onDebug?: (info: GazeDebugInfo) => void;
  /**
   * Har kadrdagi nigoh belgilari (iris o'qilgan bo'lsa). `ExamRoom` shuni
   * saqlab turadi va talaba javob bosganda bosish koordinatasi bilan
   * juftlashtiradi — o'rganiladigan xarita namunasi shunday yig'iladi.
   */
  onGazeFeature?: (f: GazeFeature) => void;
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

  /** Imtihon oldi tekshiruvida o'lchangan TABIIY ko'z ochiqligi.
   *  Nigoh ("pastga qaradi") nazorati shunga NISBATAN ishlaydi — mutlaq
   *  chegara odamlar orasida soxta ogohlantirish berardi. */
  private eyeBaseline: number | null = null;

  /**
   * O'rganilgan nigoh xaritasi. `null` bo'lsa (hali yetarli namuna yo'q, yoki
   * ekran o'zgarib bekor qilingan) eski qattiq chegaralar ishlaydi — nazorat
   * hech qachon model yo'qligi sababli o'chmaydi.
   */
  private gazeModel: GazeModel | null = null;

  /** Inference worker'i (bo'lsa). `null` — asosiy oqim yo'li (zaxira). */
  private workerClient: ProctorWorkerClient | null = null;
  /** Bir vaqtda bitta kadr tahlil qilinsin (worker javobi kutilayotganda yangisi boshlanmasin). */
  private busy = false;

  constructor(
    video: HTMLVideoElement,
    cb: RealtimeProctorCallbacks,
    eyeBaseline?: number | null,
  ) {
    this.video = video;
    this.cb = cb;
    this.eyeBaseline = typeof eyeBaseline === 'number' && eyeBaseline > 0 ? eyeBaseline : null;
  }

  async init(): Promise<boolean> {
    // 1-urinish: inference'ni WORKER'ga chiqaramiz — asosiy oqim (imtihon UI,
    // taymer, savol bosish) og'ir model hisobidan ozod bo'ladi.
    // Worker ko'tarilmasa (eski brauzer, OffscreenCanvas yo'q, WASM xatosi)
    // `create()` `null` qaytaradi va pastdagi eski yo'l ishlaydi — nazorat
    // hech qachon worker sababli o'chib qolmaydi.
    this.workerClient = await ProctorWorkerClient.create(['face']);
    if (this.workerClient) {
      if (this.disposed) {
        this.dispose();
        return false;
      }
      this.cb.onStatus?.('Realtime proctor tayyor (worker).');
      this.cb.onReady?.(true);
      return true;
    }

    // 2-urinish (zaxira): asosiy oqimda. Manbalar tartib bilan sinaladi —
    // avval o'z domenimiz, so'ng CDN.
    let lastErr: unknown = null;
    for (const src of mediapipeAssetSources()) {
      try {
        const vision = await import('@mediapipe/tasks-vision');
        const { FilesetResolver, FaceLandmarker, HandLandmarker } = vision;
        const fileset = await FilesetResolver.forVisionTasks(src.wasmBase);

        this.faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: src.faceModel, delegate: 'GPU' },
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
            baseOptions: { modelAssetPath: src.handModel, delegate: 'GPU' },
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
        this.cb.onStatus?.(`Realtime proctor tayyor (manba: ${src.origin}).`);
        this.cb.onReady?.(true);
        return true;
      } catch (err) {
        lastErr = err;
        this.faceLandmarker = null;
        this.handLandmarker = null;
        console.error(`[realtime-proctor] manba ishlamadi (${src.origin}):`, err);
        this.cb.onStatus?.(`Realtime proctor manbasi ishlamadi: ${src.origin}`);
      }
    }

    console.error(
      "[realtime-proctor] BARCHA manbalar qulaydi — nigoh/pozitsiya nazorati o'chdi:",
      lastErr,
    );
    this.cb.onStatus?.('Realtime proctor modeli yuklanmadi (server proctoring ishlaydi).');
    this.cb.onReady?.(false);
    return false;
  }

  /** O'rganilgan xaritani o'rnatadi/bekor qiladi (`null` = eski chegaralarga qaytish). */
  setGazeModel(model: GazeModel | null): void {
    this.gazeModel = model;
  }

  start(): void {
    // Worker yo'lida `faceLandmarker` bo'sh — shart ikkalasini ham qamrasin.
    if (this.running || (!this.faceLandmarker && !this.workerClient)) return;
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
    // Worker yo'lida `detectOnce` async — keyingi kadrni AVVALGISI TUGAGACH
    // rejalashtiramiz, aks holda javob kutilayotganda navbat o'sib ketardi.
    const analyse = async () => {
      if (!this.running) return;
      try {
        await this.detectOnce();
      } catch {
        /* bitta kadr xatosi loopni to'xtatmasin */
      }
      if (this.running) schedule();
    };

    const schedule = () => {
      this.timer = window.setTimeout(() => {
        this.rafId = window.requestAnimationFrame(() => {
          if (!this.running) return;
          this.timer = window.setTimeout(() => void analyse(), 0);
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
    // Worker o'z modellarini yopadi va o'zini to'xtatadi (aks holda imtihon
    // tugagach ham fon jarayoni kamera kadrlarini kutib turardi).
    this.workerClient?.dispose();
    this.workerClient = null;
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

  /**
   * Bitta kadr: INFERENCE (worker yoki asosiy oqim) → TAHLIL.
   *
   * Inference qayerda bajarilishidan qat'i nazar tahlil bir xil — shuning uchun
   * `analyseFrame` ikkala yo'l uchun yagona. Nigoh chegaralari o'zgarganda faqat
   * o'sha funksiya o'zgaradi, worker'ga tegilmaydi.
   */
  private async detectOnce(): Promise<void> {
    const v = this.video;
    if (!v || v.readyState < 2 || v.videoWidth === 0) return;
    // Worker javobi kutilayotganda yangi kadr boshlanmasin (navbat o'smasin).
    if (this.busy) return;
    this.busy = true;
    try {
      const ts = performance.now();

      // Qo'l modeli har HAND_DETECT_EVERY kadrda ishlaydi (oradagi kadrlarda oxirgi
      // natija ishlatiladi — qo'l holati 260ms da keskin o'zgarmaydi).
      this.frameCount += 1;
      const withHands = this.frameCount % HAND_DETECT_EVERY === 0;

      let faces: FaceLandmark[][] = [];
      let faceBlendshapes: Array<{ categoryName: string; score: number }> | undefined;
      let handsPresent = this.lastHandsPresent;

      if (this.workerClient) {
        const r = await this.workerClient.detect(v, ts, withHands);
        // Kadr yo'qoldi (xato/kechikish) — o'tkazib yuboramiz. `trackContinuous`
        // qisqa uzilishga toqat qiladi, shuning uchun bitta kadr sezilmaydi.
        if (!r) return;
        faces = r.faces as FaceLandmark[][];
        faceBlendshapes = r.blendshapes;
        if (r.handsPresent !== null) {
          handsPresent = r.handsPresent;
          this.lastHandsPresent = handsPresent;
        }
      } else {
        // Zaxira yo'l: asosiy oqimda (worker ko'tarilmagan).
        // Qo'l YUZDAN OLDIN tekshiriladi: qo'l yuzga yaqin/ustida bo'lsa,
        // FaceLandmarker og'iz nuqtalarini noto'g'ri o'qib, soxta "gapiryapti"
        // signali berishi mumkin (occlusion).
        if (this.handLandmarker && withHands) {
          try {
            const hres = this.handLandmarker.detectForVideo(v, ts + 0.001);
            handsPresent = (hres?.landmarks?.length || 0) > 0;
            this.lastHandsPresent = handsPresent;
          } catch {
            /* ignore */
          }
        }
        try {
          const res = this.faceLandmarker.detectForVideo(v, ts);
          faces = res?.faceLandmarks || [];
          faceBlendshapes = res?.faceBlendshapes?.[0]?.categories;
        } catch {
          return;
        }
      }

      this.analyseFrame(faces, faceBlendshapes, handsPresent);
    } finally {
      this.busy = false;
    }
  }

  /** Kadr natijalari ustidan barcha qарorlar — inference manbasidan mustaqil. */
  private analyseFrame(
    faces: FaceLandmark[][],
    faceBlendshapes: Array<{ categoryName: string; score: number }> | undefined,
    handsPresent: boolean,
  ): void {
    // Qo'l ko'tarish — endi ham kichik→katta eskalatsiya qoidasiga bo'ysunadi
    // (README.md "Proctoring eskalatsiya qoidasi"): 1.5s kichik, 3s rasmiy.
    // Oldin darhol (~0.4s) rasmiy ogohlantirish berardi — qo'lni bir zum ko'tarish
    // ham darhol blokka olib kelardi, bu qonunga zid edi.
    this.liveMs.HAND = this.trackContinuous('hand', handsPresent);
    if (this.liveMs.HAND >= LIVE_SIGNAL_ESCALATE_MS) this.emit('HAND_GESTURE_SUSPECTED');

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
      this.cb.onMouthActivity?.(false);
    }

    // Kichik chip (onLiveSignal) — FAQAT badge'siz signallar uchun. Pozitsiya/gaze/yuz
    // (NO_FACE, MULTI_FACE, TOO_FAR/CLOSE, OFF_CENTER, HEAD_AWAY) allaqachon kamera
    // badge'ida (fsCfg) ko'rsatiladi — chip ularni takrorlamasin. Gapirish, qimirlash,
    // qo'l ko'tarishning badge'i yo'q, shu sabab ular uchun chip kerak.
    const atConfirmStage = (Object.entries(this.liveMs) as Array<[LiveSignalType, number]>).filter(
      ([type, ms]) => ms > 0 && ms >= confirmMsFor(type),
    );

    // Gapirish (TALKING) video ledger'ga KIRMAYDI — Silero audio oqimi hisoblaydi.
    const stageForLedger = atConfirmStage.filter(([type]) => type !== 'TALKING');
    this.cb.onSmallWarningStage?.(stageForLedger.map(([type]) => type));

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
    // Ko'z torayib qorachiq o'qilmasa ham "pastga qaragan" deb hisoblanadi —
    // aks holda pastdagi telefonga qarash umuman aniqlanmasdi (qovoq tushadi,
    // iris `null` bo'ladi va nazorat jim qolardi).
    const eyesNarrow = eyesTooNarrowForGaze(lm, this.eyeBaseline);
    const irisDown = (iris != null && iris.dy >= IRIS_GAZE_DOWN) || eyesNarrow;

    // Namuna yig'ish uchun belgilarni tashqariga beramiz (iris o'qilganda).
    const feature: GazeFeature | null =
      iris != null ? { dx: iris.dx, dy: iris.dy, yaw: noseRelX, pitch: noseRelY } : null;
    if (feature) this.cb.onGazeFeature?.(feature);

    // O'RGANILGAN XARITA (bo'lsa) qattiq chegaralarning O'RNIGA ishlaydi.
    // Bosh kuchli burilgan bo'lsa model ishlatilmaydi: bunday poza o'quv
    // namunalaridan uzoq (talaba bosayotganda ekranga qaragan bo'ladi), ya'ni
    // bashorat ekstrapolyatsiya bo'lib ishonchsiz. U holatni FACE_TURNED_AWAY
    // allaqachon qoplaydi.
    const verdict =
      this.gazeModel && feature && absYaw < YAW_HARD
        ? classifyGaze(this.gazeModel, feature)
        : null;

    const headGazeL = absYaw >= YAW_TURN && absYaw < YAW_HARD && noseRelX >= 0;
    const headGazeR = absYaw >= YAW_TURN && absYaw < YAW_HARD && noseRelX < 0;
    const gazeLActive = verdict
      ? verdict.side === 'LEFT_OF'
      : (headGazeL || irisLeft) && absYaw < YAW_HARD;
    const gazeRActive = verdict
      ? verdict.side === 'RIGHT_OF'
      : (headGazeR || irisRight) && absYaw < YAW_HARD;
    const gazeLMs = this.trackContinuous('gazeL', gazeLActive);
    const gazeRMs = this.trackContinuous('gazeR', gazeRActive);
    if (gazeLMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('GAZE_AWAY_LEFT');
    if (gazeRMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('GAZE_AWAY_RIGHT');

    const gazeUpActive = verdict ? verdict.side === 'ABOVE' : noseRelY <= PITCH_UP;
    // MUHIM: `eyesNarrow` model yo'lida ham saqlanadi. Talaba pastga qaraganda
    // qovoq tushadi, iris umuman o'qilmaydi va model hech narsa deya olmaydi —
    // shu holat aynan tizzadagi telefonga qarash edi. Uni yo'qotib bo'lmaydi.
    const gazeDownActive = verdict
      ? verdict.side === 'BELOW' || eyesNarrow
      : noseRelY >= PITCH_DOWN || irisDown;
    const gazeUpMs = this.trackContinuous('gazeUp', gazeUpActive);
    const gazeDownMs = this.trackContinuous('gazeDown', gazeDownActive);
    if (gazeUpMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('GAZE_AWAY_UP');
    if (gazeDownMs >= LIVE_SIGNAL_ESCALATE_MS) this.emit('GAZE_AWAY_DOWN');

    this.liveMs.HEAD_AWAY = Math.max(turnMs, gazeLMs, gazeRMs, gazeUpMs, gazeDownMs);

    // Sozlash rejimi — xom qiymatlarni tashqariga beramiz (talabaga ko'rinmaydi).
    if (this.cb.onDebug) {
      this.cb.onDebug({
        iris,
        eyesNarrow,
        eyeBaseline: this.eyeBaseline,
        head: { yaw: noseRelX, pitch: noseRelY },
        faceHeight: Math.abs(height),
        thresholds: {
          irisX: IRIS_GAZE_X,
          irisDown: IRIS_GAZE_DOWN,
          pitchUp: PITCH_UP,
          pitchDown: PITCH_DOWN,
          yawTurn: YAW_TURN,
          yawHard: YAW_HARD,
        },
        active: {
          up: gazeUpActive,
          down: gazeDownActive,
          left: gazeLActive,
          right: gazeRActive,
          turn: absYaw >= YAW_HARD,
        },
        ms: {
          up: gazeUpMs,
          down: gazeDownMs,
          left: gazeLMs,
          right: gazeRMs,
          turn: turnMs,
        },
        model:
          this.gazeModel && verdict
            ? {
                sx: verdict.sx,
                sy: verdict.sy,
                marginX: gazeMargins(this.gazeModel).x,
                marginY: gazeMargins(this.gazeModel).y,
                samples: this.gazeModel.samples,
              }
            : null,
      });
    }

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
      // tez bo'shatamiz. Chegara past — sekin/yumshoq gapirishni o'tkazib
      // yubormasin (yumshoq nutqda jaw kichik ochiladi, lekin harakat bor).
      // Sezgirlik 30% oshirildi: 0.08 → 0.056 (oldingi barqaror qiymat 0.08).
      const jawClosedNow = jaw.score < 0.056;
      if (!jawClosedNow && jawHist.length >= 4) {
        const mean = jawHist.reduce((a, b) => a + b, 0) / jawHist.length;
        const amp = Math.max(...jawHist) - Math.min(...jawHist);
        let crossings = 0;
        for (let i = 1; i < jawHist.length; i++) {
          if ((jawHist[i - 1] - mean) * (jawHist[i] - mean) < 0) crossings++;
        }
        // Chegaralar 30% sezgirroq — yumshoq/sekin/past gapirish ham aniqlansin.
        // Oldingi barqaror qiymatlar: amp 0.04 / jaw 0.18 + amp 0.03 / jaw 0.12.
        talking =
          (crossings >= 3 && amp >= 0.028) ||
          (jaw.score >= 0.126 && amp >= 0.021) ||
          jawHist.filter((s) => s >= 0.084).length >= 3;
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
          // 30% sezgirroq (oldingi barqaror qiymat: 0.013).
          talking = crossings >= 3 && amp >= 0.0091;
        }
      }
    }

    // Qo'l yuz/og'iz ustida yoki yaqinida bo'lsa — landmark occlusion soxta
    // "gapiryapti" signali berishi mumkin, shu sabab bu freymda hisobga olinmaydi.
    const talking2 = talking && !handsPresent;

    // Gapirish — faqat holat (og'iz qimirlayaptimi). Rasmiy/kichik ogohlantirish
    // MIKROFON orqali Silero VAD bilan chiqadi (ExamRoom) — video og'iz yolg'iz
    // o'tirganda soxta signal berardi.
    const talkMs = this.trackContinuous('mouth', talking2, 350);
    this.liveMs.TALKING = talkMs;
    this.cb.onMouthActivity?.(talkMs >= TALK_SIGNAL_CONFIRM_MS);
  }
}
