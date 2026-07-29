/**
 * Ko'z yo'nalishi (gaze) — iris landmark + MediaPipe blendshape fusion.
 *
 * Maqsad: bosh to'g'ri turgan holda ham yonidagi telefon/qog'ozga qarashni
 * iloji boricha ushlash. Iris yolg'iz past resolution/yorug'likda "miltillaydi";
 * blendshape (eyeLook*) ko'pincha barqarorroq — ikkalasini OR bilan birlashtiramiz.
 */

export type GazeDirection = 'left' | 'right' | 'down' | 'up';

export type GazeSample = {
  dx: number;
  dy: number;
  /** Qaysi manba(lar) signal berdi */
  sources: Array<'iris' | 'blend'>;
};

/** Iris: ko'z kengligiga nisbatan gorizontal siljish (sezgir — peripheral). */
export const IRIS_GAZE_X = 0.085;
/**
 * Iris pastga: ham kenglikka normalize (ko'z qisman yumilganda h kichrayib
 * false-positive bermasligi uchun). ~0.10 ≈ aniq pastga qarash.
 */
export const IRIS_GAZE_DOWN = 0.10;
/** Iris yuqoriga (manfiy dy). */
export const IRIS_GAZE_UP = 0.12;

/** Blendshape eyeLook* ostonalari (0..1). */
export const BLEND_GAZE_SIDE = 0.32;
export const BLEND_GAZE_DOWN = 0.28;
export const BLEND_GAZE_UP = 0.35;

/** Ko'z ochiqligi (h/w). Bundan past — iris ishonchsiz. */
const EYE_OPEN_MIN_RATIO = 0.12;

const IRIS_L = 468;
const IRIS_R = 473;
/** Chap iris kontur (markaz atrofida) — o'rtacha barqarorroq. */
const IRIS_L_RING = [468, 469, 470, 471, 472];
const IRIS_R_RING = [473, 474, 475, 476, 477];
const EYE_L = { out: 33, in: 133, top: 159, bot: 145 };
const EYE_R = { out: 263, in: 362, top: 386, bot: 374 };

export interface Pt {
  x: number;
  y: number;
}

function avgPoint(lm: Pt[], idxs: number[]): Pt | null {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const i of idxs) {
    const p = lm[i];
    if (!p) continue;
    x += p.x;
    y += p.y;
    n += 1;
  }
  return n > 0 ? { x: x / n, y: y / n } : null;
}

function eyeOffset(
  iris: Pt | null,
  c1: Pt | undefined,
  c2: Pt | undefined,
  top: Pt | undefined,
  bot: Pt | undefined,
): { dx: number; dy: number } | null {
  if (!iris || !c1 || !c2 || !top || !bot) return null;
  const w = Math.abs(c2.x - c1.x);
  const h = Math.abs(bot.y - top.y);
  if (w < 1e-4) return null;
  if (h / w < EYE_OPEN_MIN_RATIO) return null;
  const cx = (c1.x + c2.x) / 2;
  const cy = (top.y + bot.y) / 2;
  // dx va dy IKALASI ham ko'z kengligiga normalize — h o'zgarishi (qisman yumilish)
  // dy ni sun'iy oshirmasin / so'ndirmasin.
  return { dx: (iris.x - cx) / w, dy: (iris.y - cy) / w };
}

/**
 * Qorachiq asosida gaze. `null` = ishonchsiz (yumilgan yoki iris yo'q).
 * dx>0 → tasvirda o'ngga, dy>0 → pastga.
 */
export function computeIrisGaze(lm: Pt[]): { dx: number; dy: number } | null {
  if (!lm || lm.length <= IRIS_R) return null;

  const lIris = avgPoint(lm, IRIS_L_RING) ?? (lm[IRIS_L] ? { x: lm[IRIS_L].x, y: lm[IRIS_L].y } : null);
  const rIris = avgPoint(lm, IRIS_R_RING) ?? (lm[IRIS_R] ? { x: lm[IRIS_R].x, y: lm[IRIS_R].y } : null);

  const l = eyeOffset(lIris, lm[EYE_L.out], lm[EYE_L.in], lm[EYE_L.top], lm[EYE_L.bot]);
  const r = eyeOffset(rIris, lm[EYE_R.out], lm[EYE_R.in], lm[EYE_R.top], lm[EYE_R.bot]);
  if (l && r) return { dx: (l.dx + r.dx) / 2, dy: (l.dy + r.dy) / 2 };
  return l ?? r;
}

export type BlendGaze = {
  left: number;
  right: number;
  down: number;
  up: number;
};

function blendScore(
  cats: Array<{ categoryName: string; score: number }> | undefined,
  name: string,
): number {
  if (!cats) return 0;
  const hit = cats.find((c) => c.categoryName === name);
  return hit ? Number(hit.score) || 0 : 0;
}

/**
 * MediaPipe FaceLandmarker blendshapes (ARKit eyeLook*).
 * Subjectning chap/o'ng qarashi — ikki ko'z o'rtachasi.
 */
export function computeBlendshapeGaze(
  cats: Array<{ categoryName: string; score: number }> | undefined,
): BlendGaze | null {
  if (!cats || cats.length === 0) return null;
  // Subject left = left eye Out + right eye In
  const left =
    (blendScore(cats, 'eyeLookOutLeft') + blendScore(cats, 'eyeLookInRight')) / 2;
  const right =
    (blendScore(cats, 'eyeLookInLeft') + blendScore(cats, 'eyeLookOutRight')) / 2;
  const down =
    (blendScore(cats, 'eyeLookDownLeft') + blendScore(cats, 'eyeLookDownRight')) / 2;
  const up =
    (blendScore(cats, 'eyeLookUpLeft') + blendScore(cats, 'eyeLookUpRight')) / 2;
  return { left, right, down, up };
}

/**
 * Iris + blendshape ni birlashtiradi (OR — birortasi chetga desa, away).
 */
export function fuseGaze(
  iris: { dx: number; dy: number } | null,
  blend: BlendGaze | null,
): {
  sample: GazeSample | null;
  away: boolean;
  direction: GazeDirection | null;
  left: boolean;
  right: boolean;
  down: boolean;
  up: boolean;
} {
  const sources: Array<'iris' | 'blend'> = [];
  let dx = 0;
  let dy = 0;
  let n = 0;

  let irisLeft = false;
  let irisRight = false;
  let irisDown = false;
  let irisUp = false;
  if (iris) {
    sources.push('iris');
    dx += iris.dx;
    dy += iris.dy;
    n += 1;
    irisLeft = iris.dx >= IRIS_GAZE_X;
    irisRight = iris.dx <= -IRIS_GAZE_X;
    irisDown = iris.dy >= IRIS_GAZE_DOWN;
    irisUp = iris.dy <= -IRIS_GAZE_UP;
  }

  let blendLeft = false;
  let blendRight = false;
  let blendDown = false;
  let blendUp = false;
  if (blend) {
    sources.push('blend');
    // Mirror webcam: subject left ≈ image right (+dx).
    const bDx = blend.left - blend.right;
    dx += bDx * 0.5;
    dy += (blend.down - blend.up) * 0.5;
    n += 1;
    blendLeft = blend.left >= BLEND_GAZE_SIDE;
    blendRight = blend.right >= BLEND_GAZE_SIDE;
    blendDown = blend.down >= BLEND_GAZE_DOWN;
    blendUp = blend.up >= BLEND_GAZE_UP;
  }

  if (n === 0) {
    return {
      sample: null,
      away: false,
      direction: null,
      left: false,
      right: false,
      down: false,
      up: false,
    };
  }

  const sample: GazeSample = { dx: dx / n, dy: dy / n, sources };

  const left = irisLeft || blendLeft;
  const right = irisRight || blendRight;
  const down = irisDown || blendDown;
  const up = irisUp || blendUp;
  const away = left || right || down || up;

  let direction: GazeDirection | null = null;
  if (left && !right) direction = 'left';
  else if (right && !left) direction = 'right';
  else if (left && right) {
    direction = (blend?.left ?? Math.abs(iris?.dx ?? 0)) >= (blend?.right ?? 0) ? 'left' : 'right';
  } else if (down) direction = 'down';
  else if (up) direction = 'up';

  return { sample, away, direction, left, right, down, up };
}

export function isIrisGazeAway(iris: { dx: number; dy: number } | null): boolean {
  if (iris == null) return false;
  return (
    Math.abs(iris.dx) >= IRIS_GAZE_X ||
    iris.dy >= IRIS_GAZE_DOWN ||
    iris.dy <= -IRIS_GAZE_UP
  );
}

/**
 * Iris miltillashini yumshatadi — qisqa "yo'qolish" away holatini buzmasin.
 * alpha yuqori = sezgirroq (tezroq ushlaydi).
 */
export class GazeEma {
  private dx = 0;
  private dy = 0;
  private has = false;

  constructor(private readonly alpha = 0.45) {}

  push(sample: { dx: number; dy: number } | null): { dx: number; dy: number } | null {
    if (!sample) {
      // Iris bir zum yo'qolsa — EMA ni darhol o'chirmaymiz (hold).
      return this.has ? { dx: this.dx, dy: this.dy } : null;
    }
    if (!this.has) {
      this.dx = sample.dx;
      this.dy = sample.dy;
      this.has = true;
    } else {
      this.dx = this.dx * (1 - this.alpha) + sample.dx * this.alpha;
      this.dy = this.dy * (1 - this.alpha) + sample.dy * this.alpha;
    }
    return { dx: this.dx, dy: this.dy };
  }

  reset(): void {
    this.has = false;
    this.dx = 0;
    this.dy = 0;
  }
}
