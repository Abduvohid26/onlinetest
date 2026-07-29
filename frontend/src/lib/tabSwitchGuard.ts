/**
 * Tab/oyna almashtirish nazoratining "qurollanish" mantiqi.
 *
 * NIMA UCHUN: fullscreen'ga kirish/chiqishda brauzer `blur`, `visibilitychange`
 * va `fullscreenchange` hodisalarini turli tartibda yuboradi (tartib brauzer va
 * OS oyna menejeriga bog'liq). Har bir hodisani alohida shartlar bilan
 * filtrlashga urinish mo'rt bo'lib chiqdi: bitta tartib kombinatsiyasi o'tib
 * ketib, "Butun ekran talab qilinadi" modali bilan bir vaqtda "Boshqa oynaga
 * o'tildi" qoidabuzarligi yozilardi.
 *
 * YECHIM: hodisalarni filtrlash o'rniga bitta invariant — nazorat imtihon
 * BARQAROR holatda uzluksiz `armMs` turgandagina yoqiladi va har qanday
 * chetlanishda darhol o'chadi. Shunda o'tish paytidagi hodisalar tartibi
 * ahamiyatsiz bo'lib qoladi.
 */

export interface TabGuardState {
  /** Imtihon sessiyasi ochiq (savollar berilgan). */
  sessionStarted: boolean;
  banned: boolean;
  /** "Butun ekran talab qilinadi" gate ochiq. */
  fullscreenRequired: boolean;
  /** Modal/ichki oqim fullscreen'dan chiqargan — jazolanmaydi. */
  fullscreenSuppressed: boolean;
  /** `requestFullscreen()` javobi hali kelmagan. */
  fullscreenRequestInFlight: boolean;
  warningModalOpen: boolean;
  smallWarnOpen: boolean;
  /** Haqiqatan fullscreen ichidamiz (brauzer qo'llab-quvvatlamasa `true`). */
  inFullscreen: boolean;
  /** Talaba ekran oldida: sahifa ko'rinadi va oyna fokusda. */
  present: boolean;
}

/** Barqarorlikni buzadigan holat bormi (ko'rinish/fokusdan tashqari). */
export function tabGuardBlocked(s: TabGuardState): boolean {
  return (
    !s.sessionStarted ||
    s.banned ||
    s.fullscreenRequired ||
    s.fullscreenSuppressed ||
    s.fullscreenRequestInFlight ||
    s.warningModalOpen ||
    s.smallWarnOpen ||
    !s.inFullscreen
  );
}

export class TabSwitchGuard {
  private armedFlag = false;
  private stableSince = 0;
  private awayStartedAt: number | null = null;

  constructor(private readonly armMs: number = 3000) {}

  get armed(): boolean {
    return this.armedFlag;
  }

  /** Nazoratni o'chiradi va to'plangan "ketgan vaqt" hisobini tozalaydi. */
  disarm(): void {
    this.armedFlag = false;
    this.stableSince = 0;
    this.awayStartedAt = null;
  }

  /**
   * Holatni baholaydi. Barqaror bo'lsa `armMs` dan keyin qurollaydi.
   * MUHIM: `present === false` (talaba boshqa oynada) barqarorlikni BUZMAYDI —
   * aynan o'sha holat aniqlanadigan signal. U faqat qurollanishni kechiktiradi.
   */
  evaluate(state: TabGuardState, now: number): boolean {
    if (tabGuardBlocked(state)) {
      this.disarm();
      return false;
    }
    if (this.armedFlag) return true;
    if (!state.present) {
      this.stableSince = 0;
      return false;
    }
    if (!this.stableSince) {
      this.stableSince = now;
      return false;
    }
    if (now - this.stableSince >= this.armMs) {
      this.armedFlag = true;
    }
    return this.armedFlag;
  }

  /** Talaba oynadan ketdi (blur / visibility hidden). */
  markAway(now: number): void {
    if (!this.armedFlag) {
      this.awayStartedAt = null;
      return;
    }
    if (this.awayStartedAt == null) this.awayStartedAt = now;
  }

  /**
   * Talaba qaytdi. Qoidabuzarlik yozilishi kerak bo'lsa `true` qaytaradi
   * (nazorat qurollangan va ketish `thresholdMs` dan uzoq bo'lgan).
   */
  endAway(now: number, thresholdMs: number): boolean {
    const startedAt = this.awayStartedAt;
    this.awayStartedAt = null;
    if (startedAt == null) return false;
    if (!this.armedFlag) return false;
    return now - startedAt >= thresholdMs;
  }
}
