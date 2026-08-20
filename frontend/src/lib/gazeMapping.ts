/**
 * O'rganiladigan nigoh xaritasi — qorachiq + bosh pozasidan EKRAN koordinatasi.
 *
 * MUAMMO (nima uchun bu modul bor):
 * `realtimeProctor.ts` da nigoh chegaralari qattiq konstantalar edi —
 * `IRIS_GAZE_X = 0.16`, `IRIS_GAZE_DOWN = 0.32`, `PITCH_UP = 0.30`. Ular
 * "havoda" tanlangan va har bir qurilmada boshqacha ma'no beradi: kamera
 * ekranning tepasida, noutbuk baland yoki past turadi, talaba yaqin yoki uzoq
 * o'tiradi. Natijada TEPAGA qarash (noutbuk ustidagi shpargalka, ikkinchi
 * monitor) umuman aniqlanmasdi — vertikal chegara faqat bosh burchagiga
 * bog'liq edi va u juda qattiq.
 *
 * YECHIM: chegarani taxmin qilmaymiz — O'LCHAYMIZ. Talaba javob variantini
 * bosganda u o'sha joyga qaragan bo'ladi (WebGazer.js ning asosiy g'oyasi).
 * Bosish koordinatasi bizga ma'lum, o'sha ondagi nigoh belgilari ham. Shu
 * juftliklardan chiziqli model o'rganamiz:
 *
 *     ekran_x ≈ a0 + a1·dx + a2·yaw
 *     ekran_y ≈ b0 + b1·dy + b2·pitch
 *
 * Bosh pozasi (yaw/pitch) modelga KIRADI, chunki bir xil qorachiq holati bosh
 * burilganda boshqa joyni bildiradi.
 *
 * MUHIM: chiqish — 4 ta mustaqil "ha/yo'q" emas, UZLUKSIZ nuqta. Shu sababli
 * diagonal nigoh to'g'ri ishlaydi va chegara bitta soha sifatida qaraladi.
 *
 * Talaba uchun qo'shimcha qadam YO'Q: bosishlar imtihon davomida o'zi bo'ladi.
 * Model tayyor bo'lguncha (yetarli namuna yo'q) eski qattiq chegaralar ishlaydi
 * — ya'ni hech qachon bugungidan yomon holatga tushmaymiz.
 */

/** Bitta kadrdagi nigoh belgilari. */
export interface GazeFeature {
  /** Qorachiqning ko'z markazidan gorizontal siljishi (`computeIrisGaze`). */
  dx: number;
  /** Vertikal siljish. Manfiy = tepaga qaragan. */
  dy: number;
  /** Bosh gorizontal og'ishi (0 ≈ markaz). */
  yaw: number;
  /** Bosh vertikal og'ishi (0.5 ≈ markaz). */
  pitch: number;
}

/** O'quv namunasi: belgilar + o'sha ondagi ekran nuqtasi (0..1 oralig'ida). */
export interface GazeSample {
  f: GazeFeature;
  /** Bosilgan nuqta, ekran kengligiga nisbatan (0 = chap chet, 1 = o'ng chet). */
  sx: number;
  /** Ekran balandligiga nisbatan (0 = tepa, 1 = past). */
  sy: number;
}

export interface GazeModel {
  /** [a0, a1(dx), a2(yaw)] */
  x: [number, number, number];
  /** [b0, b1(dy), b2(pitch)] */
  y: [number, number, number];
  /** Qoldiqlar standart og'ishi (ekran ulushida) — xavfsizlik oralig'i shundan. */
  residual: { x: number; y: number };
  /** Modelga kirgan namunalar soni (chetlatilganlardan keyin). */
  samples: number;
}

export type GazeFitFailure =
  /** Hali yetarli bosish bo'lmadi. */
  | 'NOT_ENOUGH_SAMPLES'
  /** Bosishlar ekranning bitta joyida to'plangan — model qurib bo'lmaydi. */
  | 'NO_SPREAD'
  /** Chiziqli tenglama yechilmadi (belgilar bir-biriga bog'liq). */
  | 'DEGENERATE'
  /** Model mos kelmadi: qoldiqlar juda katta (talaba qaramasdan bosgan). */
  | 'POOR_FIT';

export type GazeFitResult =
  | { ok: true; model: GazeModel }
  | { ok: false; reason: GazeFitFailure };

/** Model qurish uchun eng kam namuna. 3 ta parametr — zaxira bilan. */
export const MIN_SAMPLES = 8;
/** Bosishlar shundan kam tarqalgan bo'lsa model ishonchsiz (ekran ulushi). */
export const MIN_SPREAD = 0.12;
/** Qoldiq shundan katta bo'lsa — model mos emas. */
export const MAX_RESIDUAL = 0.35;
/** Chetlatish chegarasi: qoldiq shu ko'p sigmadan katta bo'lsa namuna tashlanadi. */
const OUTLIER_SIGMA = 2.5;
/** Ridge regularizatsiyasi — belgilar deyarli bog'liq bo'lganda portlab ketmasin. */
const RIDGE_LAMBDA = 1e-4;
/** Xavfsizlik oralig'i = shuncha × qoldiq. */
export const MARGIN_K = 3;
/** Oraliq shu chegaralarda ushlanadi (ekran ulushi). */
export const MARGIN_MIN = 0.08;
export const MARGIN_MAX = 0.45;

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((v) => (v - m) ** 2)));
}

/**
 * 3×3 chiziqli tizimni yechadi (qisman pivotlash bilan). `null` = yechimsiz.
 * Kichik va o'z-o'zicha yetarli — matritsa kutubxonasi olib kelishga arzimaydi.
 */
function solve3(a: number[][], b: number[]): [number, number, number] | null {
  const m = [
    [a[0][0], a[0][1], a[0][2], b[0]],
    [a[1][0], a[1][1], a[1][2], b[1]],
    [a[2][0], a[2][1], a[2][2], b[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const factor = m[r][col] / m[col][col];
      for (let c = col; c < 4; c++) m[r][c] -= factor * m[col][c];
    }
  }
  const out: [number, number, number] = [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
  return out.every((v) => Number.isFinite(v)) ? out : null;
}

/** Bitta o'q uchun ridge-regressiya: rows = [1, belgi1, belgi2], target = ekran ulushi. */
function fitAxis(rows: Array<[number, number, number]>, target: number[]): [number, number, number] | null {
  const ata = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const atb = [0, 0, 0];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    for (let p = 0; p < 3; p++) {
      atb[p] += r[p] * target[i];
      for (let q = 0; q < 3; q++) ata[p][q] += r[p] * r[q];
    }
  }
  // Erkin had (intercept) jazolanmaydi — faqat koeffitsiyentlar.
  ata[1][1] += RIDGE_LAMBDA * rows.length;
  ata[2][2] += RIDGE_LAMBDA * rows.length;
  return solve3(ata, atb);
}

const rowX = (f: GazeFeature): [number, number, number] => [1, f.dx, f.yaw];
const rowY = (f: GazeFeature): [number, number, number] => [1, f.dy, f.pitch];

const applyRow = (c: [number, number, number], r: [number, number, number]): number =>
  c[0] * r[0] + c[1] * r[1] + c[2] * r[2];

/**
 * Namunalardan model quradi.
 *
 * Bir marta chetlatish bosqichi bor: talaba ba'zan qaramasdan bosadi (sichqonchani
 * ko'rmasdan, yoki javobni oldindan bilib). Bunday namuna modelni buzadi, shuning
 * uchun katta qoldiqlilari tashlanadi va model qayta quriladi.
 */
export function fitGazeModel(samples: GazeSample[]): GazeFitResult {
  if (!samples || samples.length < MIN_SAMPLES) {
    return { ok: false, reason: 'NOT_ENOUGH_SAMPLES' };
  }
  if (std(samples.map((s) => s.sx)) < MIN_SPREAD || std(samples.map((s) => s.sy)) < MIN_SPREAD) {
    return { ok: false, reason: 'NO_SPREAD' };
  }

  const build = (list: GazeSample[]): GazeModel | null => {
    const cx = fitAxis(list.map((s) => rowX(s.f)), list.map((s) => s.sx));
    const cy = fitAxis(list.map((s) => rowY(s.f)), list.map((s) => s.sy));
    if (!cx || !cy) return null;
    const rx = list.map((s) => s.sx - applyRow(cx, rowX(s.f)));
    const ry = list.map((s) => s.sy - applyRow(cy, rowY(s.f)));
    return {
      x: cx,
      y: cy,
      residual: { x: std(rx), y: std(ry) },
      samples: list.length,
    };
  };

  const first = build(samples);
  if (!first) return { ok: false, reason: 'DEGENERATE' };

  // Chetlatish: qoldig'i OUTLIER_SIGMA dan katta namunalarni tashlaymiz.
  const kept = samples.filter((s) => {
    const ex = Math.abs(s.sx - applyRow(first.x, rowX(s.f)));
    const ey = Math.abs(s.sy - applyRow(first.y, rowY(s.f)));
    const okX = first.residual.x < 1e-9 || ex <= OUTLIER_SIGMA * first.residual.x;
    const okY = first.residual.y < 1e-9 || ey <= OUTLIER_SIGMA * first.residual.y;
    return okX && okY;
  });

  const model =
    kept.length >= MIN_SAMPLES && kept.length < samples.length ? build(kept) ?? first : first;

  if (model.residual.x > MAX_RESIDUAL || model.residual.y > MAX_RESIDUAL) {
    return { ok: false, reason: 'POOR_FIT' };
  }
  return { ok: true, model };
}

/** Belgilardan ekran nuqtasini bashorat qiladi (0..1 dan tashqariga chiqishi MUMKIN). */
export function predictGaze(model: GazeModel, f: GazeFeature): { sx: number; sy: number } {
  return { sx: applyRow(model.x, rowX(f)), sy: applyRow(model.y, rowY(f)) };
}

/** Xavfsizlik oralig'i — model qanchalik shovqinli bo'lsa shunchalik keng. */
export function gazeMargins(model: GazeModel): { x: number; y: number } {
  const clamp = (v: number) => Math.max(MARGIN_MIN, Math.min(MARGIN_MAX, v));
  return { x: clamp(MARGIN_K * model.residual.x), y: clamp(MARGIN_K * model.residual.y) };
}

/** Nigoh ekranning qaysi chetidan chiqdi. `null` = ekran ichida. */
export type OffScreenSide = 'ABOVE' | 'BELOW' | 'LEFT_OF' | 'RIGHT_OF';

export interface GazeVerdict {
  side: OffScreenSide | null;
  /** Bashorat qilingan ekran nuqtasi — debug va chip uchun. */
  sx: number;
  sy: number;
  /** Chegaradan qanchalik uzoqqa chiqqani (oraliqqa nisbatan). Tanlash uchun. */
  overshoot: number;
}

/**
 * Nigoh ekrandan tashqaridami — eng kuchli chetga chiqishni qaytaradi.
 *
 * Yo'nalish EKRANGA nisbatan beriladi (`ABOVE` = ekran tepasidan yuqori).
 * Uni violation turiga aylantirish chaqiruvchining ishi — shu sabab bu modul
 * `GAZE_AWAY_*` nomlarini bilmaydi va mustaqil test qilinadi.
 */
export function classifyGaze(model: GazeModel, f: GazeFeature): GazeVerdict {
  const { sx, sy } = predictGaze(model, f);
  const m = gazeMargins(model);

  const candidates: Array<{ side: OffScreenSide; over: number }> = [
    { side: 'ABOVE', over: (-m.y - sy) / m.y },
    { side: 'BELOW', over: (sy - (1 + m.y)) / m.y },
    { side: 'LEFT_OF', over: (-m.x - sx) / m.x },
    { side: 'RIGHT_OF', over: (sx - (1 + m.x)) / m.x },
  ];

  let best: { side: OffScreenSide; over: number } | null = null;
  for (const c of candidates) {
    if (c.over > 0 && (!best || c.over > best.over)) best = c;
  }
  return { side: best?.side ?? null, sx, sy, overshoot: best?.over ?? 0 };
}

/**
 * Namunalar uchun aylanma bufer.
 *
 * Nega cheklangan: talaba imtihon davomida holatini o'zgartiradi (orqaga
 * suyanadi, yaqinlashadi). Eski namunalar modelni eskirgan holatga tortadi,
 * shu sabab faqat oxirgilari saqlanadi.
 */
export class GazeSampleBuffer {
  private items: GazeSample[] = [];

  constructor(private readonly capacity = 40) {}

  push(sample: GazeSample): void {
    this.items.push(sample);
    while (this.items.length > this.capacity) this.items.shift();
  }

  all(): GazeSample[] {
    return this.items.slice();
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}
