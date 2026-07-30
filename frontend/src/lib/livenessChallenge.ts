/**
 * Faol tiriklik (liveness) tekshiruvi — tasodifiy ko'p-harakatli chaqiriq.
 *
 * NIMA UCHUN QAYTA YOZILDI. Avvalgi tekshiruv ikki qismdan iborat edi:
 *   1) piksel yig'indisining o'zgarishi (passiv),
 *   2) HAR DOIM bitta xil harakat — "tabassum qiling".
 * Ikkalasini ham oldindan yozib olingan video osongina o'tardi: videoda harakat
 * ham bor, tabassum ham bor. Chaqiriq doim bir xil bo'lgani uchun bir marta
 * tayyorlangan yozuv cheksiz ishlatilishi mumkin edi.
 *
 * YANGI YONDASHUV — uchta mustaqil to'siq:
 *   1) TASODIFIYLIK: har urinishda harakatlar to'plamidan 2 tasi tasodifiy
 *      tanlanadi va tasodifiy tartibda so'raladi. Oldindan tayyorlangan yozuv
 *      qaysi harakat so'ralishini bilmaydi.
 *   2) VAQT BOG'LANISHI: har bir harakat so'ralgandan KEYIN boshlanishi shart.
 *      Buning uchun avval "harakat YO'Q" holati kuzatiladi (baseline), keyin
 *      harakatning paydo bo'lishi. Allaqachon tabassum qilib turgan video shu
 *      yerda yiqiladi.
 *   3) KO'Z QISISH: statik foto yoki niqob ko'z qisa olmaydi. Ko'z qisish
 *      "yumildi → qayta ochildi" o'tishi sifatida tekshiriladi, holat sifatida
 *      emas — ya'ni ko'zni yumib turish ham o'tmaydi.
 *
 * Bu modul SOF mantiq (DOM'ga bog'liq emas) — unit testlar bilan qoplangan.
 */

export type LivenessAction = 'BLINK' | 'SMILE' | 'MOUTH_OPEN' | 'TURN_LEFT' | 'TURN_RIGHT';

export const LIVENESS_ACTIONS: readonly LivenessAction[] = [
  'BLINK',
  'SMILE',
  'MOUTH_OPEN',
  'TURN_LEFT',
  'TURN_RIGHT',
];

/** Har bir chaqiriqda nechta harakat so'raladi. */
export const LIVENESS_STEP_COUNT = 2;

interface Pt {
  x: number;
  y: number;
}

// --- Landmark indekslari (MediaPipe FaceLandmarker, 468/478 nuqta) ---
const EYE_L = { out: 33, in: 133, top: 159, bot: 145 };
const EYE_R = { out: 263, in: 362, top: 386, bot: 374 };
const LIP_TOP = 13;
const LIP_BOT = 14;
const MOUTH_L = 61;
const MOUTH_R = 291;

/** Ko'z ochiqligi: balandlik/kenglik. Ochiq ko'zda ~0.25-0.40, yumuqda ~0.05-0.12. */
export const EAR_CLOSED_MAX = 0.14;
export const EAR_OPEN_MIN = 0.20;
/** Og'iz ochilishi: lab oralig'i / og'iz kengligi. */
export const MOUTH_OPEN_MIN = 0.35;

function dist(a: Pt | undefined, b: Pt | undefined): number | null {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Bitta ko'z uchun ochiqlik nisbati (Eye Aspect Ratio). */
export function eyeAspectRatio(lm: Pt[], eye: typeof EYE_L): number | null {
  const w = dist(lm?.[eye.out], lm?.[eye.in]);
  const h = dist(lm?.[eye.top], lm?.[eye.bot]);
  if (w == null || h == null || w < 1e-6) return null;
  return h / w;
}

/** Ikki ko'zning o'rtacha ochiqligi. `null` — landmark yetarli emas. */
export function averageEar(lm: Pt[]): number | null {
  const l = eyeAspectRatio(lm, EYE_L);
  const r = eyeAspectRatio(lm, EYE_R);
  if (l == null && r == null) return null;
  if (l != null && r != null) return (l + r) / 2;
  return (l ?? r) as number;
}

/** Ko'z yumuqmi (ko'z qisish o'tishining birinchi yarmi). */
export function eyesClosed(lm: Pt[]): boolean {
  const ear = averageEar(lm);
  return ear != null && ear <= EAR_CLOSED_MAX;
}

/** Ko'z ishonchli ochiqmi (o'tishning ikkinchi yarmi). */
export function eyesOpen(lm: Pt[]): boolean {
  const ear = averageEar(lm);
  return ear != null && ear >= EAR_OPEN_MIN;
}

/** Og'iz ochiqmi (lab oralig'i og'iz kengligiga nisbatan). */
export function mouthOpenRatio(lm: Pt[]): number | null {
  const gap = dist(lm?.[LIP_TOP], lm?.[LIP_BOT]);
  const w = dist(lm?.[MOUTH_L], lm?.[MOUTH_R]);
  if (gap == null || w == null || w < 1e-6) return null;
  return gap / w;
}

export function isMouthOpen(lm: Pt[]): boolean {
  const r = mouthOpenRatio(lm);
  return r != null && r >= MOUTH_OPEN_MIN;
}

/** Bitta harakat bosqichining sozlamalari. */
export interface ActionSpec {
  /** Harakat boshlanishidan oldin "harakat yo'q" holati shuncha ms kuzatiladi. */
  baselineMs: number;
  /** Harakat shuncha ms uzluksiz davom etishi kerak. */
  holdMs: number;
  /** Harakatdan keyin "yo'q" holatiga qaytish talab qilinadimi (ko'z qisish uchun). */
  requireRelease: boolean;
  /** Bitta bosqichga beriladigan umumiy vaqt. */
  timeoutMs: number;
}

export const ACTION_SPECS: Record<LivenessAction, ActionSpec> = {
  // Ko'z qisish: qisqa, lekin "yumildi → ochildi" o'tishi majburiy.
  BLINK: { baselineMs: 250, holdMs: 60, requireRelease: true, timeoutMs: 10_000 },
  SMILE: { baselineMs: 300, holdMs: 450, requireRelease: false, timeoutMs: 12_000 },
  MOUTH_OPEN: { baselineMs: 300, holdMs: 400, requireRelease: false, timeoutMs: 12_000 },
  TURN_LEFT: { baselineMs: 300, holdMs: 400, requireRelease: false, timeoutMs: 12_000 },
  TURN_RIGHT: { baselineMs: 300, holdMs: 400, requireRelease: false, timeoutMs: 12_000 },
};

export type StepPhase = 'baseline' | 'awaiting' | 'holding' | 'releasing' | 'done' | 'timeout';

/**
 * Bitta harakat bosqichining holat mashinasi.
 *
 * baseline → awaiting → holding → (releasing) → done
 *
 * `baseline` bosqichi eng muhimi: harakat so'ralgan paytda talaba uni
 * BAJARMAYOTGAN bo'lishi kerak. Shu sabab allaqachon harakatni ko'rsatib
 * turgan yozuv (masalan doim tabassumli video) o'ta olmaydi.
 */
export class LivenessStep {
  private phase: StepPhase = 'baseline';
  private phaseSince: number | null = null;
  private startedAt: number | null = null;

  constructor(
    readonly action: LivenessAction,
    private readonly spec: ActionSpec = ACTION_SPECS[action],
  ) {}

  get currentPhase(): StepPhase {
    return this.phase;
  }

  get done(): boolean {
    return this.phase === 'done';
  }

  get failed(): boolean {
    return this.phase === 'timeout';
  }

  /**
   * Har kadrda chaqiriladi. `active` — harakat shu kadrda aniqlanganmi
   * (BLINK uchun: ko'z yumuqmi). `faceOk` — yuz ishonchli ko'rinyaptimi;
   * yuz yo'qolsa hisob to'xtaydi (soxta "bajarildi" bo'lmasin).
   */
  push(active: boolean, now: number, faceOk = true): StepPhase {
    if (this.phase === 'done' || this.phase === 'timeout') return this.phase;
    if (this.startedAt == null) this.startedAt = now;
    if (this.phaseSince == null) this.phaseSince = now;

    if (now - this.startedAt >= this.spec.timeoutMs) {
      this.phase = 'timeout';
      return this.phase;
    }

    // Yuz ko'rinmasa: hech narsa hisoblanmaydi, joriy bosqich hisobi qaytadan.
    if (!faceOk) {
      this.phaseSince = now;
      if (this.phase === 'holding' || this.phase === 'releasing') this.phase = 'awaiting';
      return this.phase;
    }

    switch (this.phase) {
      case 'baseline':
        // Harakat bajarilmayotgan holat barqaror kuzatilishi kerak.
        if (active) {
          this.phaseSince = now;
        } else if (now - this.phaseSince >= this.spec.baselineMs) {
          this.phase = 'awaiting';
          this.phaseSince = now;
        }
        break;

      case 'awaiting':
        if (active) {
          this.phase = 'holding';
          this.phaseSince = now;
        }
        break;

      case 'holding':
        if (!active) {
          // Uzildi — qayta kutishga qaytamiz (baseline'ga emas: talaba
          // harakatni boshlagani aniq, shunchaki yetarlicha ushlab turmadi).
          this.phase = 'awaiting';
          this.phaseSince = now;
        } else if (now - this.phaseSince >= this.spec.holdMs) {
          if (this.spec.requireRelease) {
            this.phase = 'releasing';
            this.phaseSince = now;
          } else {
            this.phase = 'done';
          }
        }
        break;

      case 'releasing':
        // Ko'z qisish: yumilgandan keyin QAYTA OCHILISHI shart.
        if (!active) this.phase = 'done';
        break;
    }
    return this.phase;
  }

  /** Bosqichni qaytadan boshlash (talaba "qayta urinish" bosganda). */
  reset(): void {
    this.phase = 'baseline';
    this.phaseSince = null;
    this.startedAt = null;
  }
}

/** Chaqiriq ketma-ketligining umumiy holati. */
export type SequenceStatus = 'running' | 'passed' | 'failed';

/**
 * Tasodifiy tanlangan harakatlar ketma-ketligi. Bosqichma-bosqich bajariladi;
 * bittasi vaqtida bajarilmasa butun chaqiriq muvaffaqiyatsiz (talaba qayta
 * urinishi mumkin — u holda YANGI tasodifiy ketma-ketlik beriladi).
 */
export class LivenessSequence {
  private index = 0;
  private steps: LivenessStep[];

  constructor(actions: LivenessAction[]) {
    if (actions.length === 0) throw new Error('liveness: kamida bitta harakat kerak');
    this.steps = actions.map((a) => new LivenessStep(a));
  }

  get currentAction(): LivenessAction {
    return this.steps[Math.min(this.index, this.steps.length - 1)].action;
  }

  get currentStep(): LivenessStep {
    return this.steps[Math.min(this.index, this.steps.length - 1)];
  }

  /** Nechanchi bosqich (1 dan boshlab) va jami nechta. */
  get progress(): { step: number; total: number } {
    return { step: Math.min(this.index + 1, this.steps.length), total: this.steps.length };
  }

  push(active: boolean, now: number, faceOk = true): SequenceStatus {
    if (this.index >= this.steps.length) return 'passed';
    const phase = this.steps[this.index].push(active, now, faceOk);
    if (phase === 'timeout') return 'failed';
    if (phase === 'done') {
      this.index += 1;
      if (this.index >= this.steps.length) return 'passed';
    }
    return 'running';
  }
}

/**
 * Tasodifiy harakat ketma-ketligi tuzadi (takrorlanmaydigan).
 *
 * `TURN_LEFT` va `TURN_RIGHT` birgalikda tanlanmaydi — ketma-ket ikki burilish
 * talabani chalkashtiradi va kamera kadridan chiqarib yuborishi mumkin.
 */
export function pickLivenessActions(
  count = LIVENESS_STEP_COUNT,
  random: () => number = Math.random,
): LivenessAction[] {
  const pool = [...LIVENESS_ACTIONS];
  // Fisher–Yates (test uchun `random` almashtiriladi).
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out: LivenessAction[] = [];
  let turnUsed = false;
  for (const a of pool) {
    const isTurn = a === 'TURN_LEFT' || a === 'TURN_RIGHT';
    if (isTurn && turnUsed) continue;
    if (isTurn) turnUsed = true;
    out.push(a);
    if (out.length >= count) break;
  }
  return out;
}
