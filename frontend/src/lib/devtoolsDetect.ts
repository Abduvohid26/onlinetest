/**
 * DevTools ochilganini aniqlash.
 *
 * NIMA UCHUN QAYTA YOZILDI. Ilgari faqat oyna o'lchami evristikasi bor edi va u
 * `VITE_DEVTOOLS_SIZE_HEURISTIC` bayrog'i ortida — bayroq hech qayerda
 * o'rnatilmagani uchun amalda DEVTOOLS UMUMAN ANIQLANMASDI. Yagona to'siq
 * klaviatura yorliqlarini bloklash edi (F12, Ctrl+Shift+I), uni esa brauzer
 * menyusidan bemalol chetlab o'tish mumkin.
 *
 * Endi ikki mustaqil signal bor:
 *
 *  1) GETTER-ZOND (asosiy). Konsolga maxsus obyekt yoziladi; DevTools uni
 *     ko'rsatish uchun xossasini o'qiydi va getter ishga tushadi. DevTools
 *     yopiq bo'lsa hech kim o'qimaydi — getter jim turadi. Oyna o'lchamiga
 *     bog'liq emas: doklangan ham, alohida oynada ham ishlaydi.
 *
 *  2) O'LCHAM EVRISTIKASI (qo'shimcha). Fullscreen ichida outer/inner farqi
 *     BAZAVIY qiymatdan sezilarli oshsa. Absolyut chegara ishlatilmaydi —
 *     OS masshtablash va doimiy panellar doimiy soxta signal berardi.
 *
 * Ikkalasi ham `false positive` bermasligi uchun chaqiruvchi tomonda uzluksiz
 * davomiylik talab qilinadi (ViolationGate: 1.5s kichik, 4s rasmiy).
 */

/** O'lcham evristikasining sof mantiqi — unit test qilinadi. */
export class WindowSizeDevtoolsHeuristic {
  private baseDw: number | null = null;
  private baseDh: number | null = null;

  constructor(
    private readonly growW = 320,
    private readonly growH = 180,
  ) {}

  /** Bazaviy qiymatni unutadi (fullscreen'dan chiqildi / fokus yo'qoldi). */
  reset(): void {
    this.baseDw = null;
    this.baseDh = null;
  }

  /**
   * @param dw outerWidth - innerWidth (absolyut)
   * @param dh outerHeight - innerHeight (absolyut)
   * @returns shubhali holatmi
   */
  push(dw: number, dh: number): boolean {
    if (this.baseDw == null || this.baseDh == null) {
      // Birinchi o'lchov — joriy farq "normal" deb belgilanadi.
      this.baseDw = dw;
      this.baseDh = dh;
      return false;
    }
    // Panel yopilsa farq kamayadi — bazani pasaytiramiz (aks holda bir marta
    // ochilgandan keyin baza yuqori qolib, keyingi ochilish sezilmasdi).
    if (dw < this.baseDw) this.baseDw = dw;
    if (dh < this.baseDh) this.baseDh = dh;
    return dw - this.baseDw > this.growW || dh - this.baseDh > this.growH;
  }
}

/**
 * Konsolga yozilganda DevTools tomonidan o'qiladigan zond.
 *
 * `console.log(obj)` chaqirilganda DevTools obyektni ko'rsatish uchun uning
 * xossalarini o'qiydi — shunda getter ishlaydi. DevTools yopiq bo'lsa brauzer
 * obyektni umuman ochib ko'rmaydi.
 */
export class ConsoleProbeDevtoolsDetector {
  private fired = false;
  private probe: object;
  private available: boolean;

  constructor() {
    this.available =
      typeof console !== 'undefined' && typeof Object.defineProperty === 'function';
    const self = this;
    const obj: Record<string, unknown> = {};
    try {
      Object.defineProperty(obj, 'id', {
        get() {
          self.fired = true;
          return '';
        },
        configurable: false,
        enumerable: true,
      });
    } catch {
      this.available = false;
    }
    this.probe = obj;
  }

  /** Bitta tekshiruv. `true` — DevTools ochiq deb hisoblanadi. */
  check(): boolean {
    if (!this.available) return false;
    this.fired = false;
    try {
      // `console.log` konsolni to'ldiradi; imtihon davomida bu zararsiz —
      // aksincha, konsoldan foydalanmoqchi bo'lgan talabaga xalaqit beradi.
      console.log('%c', this.probe);
      console.clear?.();
    } catch {
      return false;
    }
    return this.fired;
  }
}
