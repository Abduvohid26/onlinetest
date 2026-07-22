/**
 * Kichik ogohlantirishlar hisobi — "3 marta kichik, 4-martasi rasmiy" qonuni.
 *
 * README.md "Proctoring eskalatsiya qoidasi" ning ikkinchi qismi. Ilgari kichik
 * ogohlantirish faqat vizual edi va hech qayerda sanalmasdi — talaba qoidani
 * qayta-qayta buzib, har safar signalni to'xtatib turib, rasmiy ogohlantirishdan
 * qochishi mumkin edi. Endi HAR BIR kichik ogohlantirish sanaladi:
 *
 *   1-, 2-, 3-marta → kichik (kamera panelida chip, backendga hech narsa ketmaydi)
 *   4-marta         → DARHOL rasmiy ogohlantirish (chip chiqishi bilan)
 *
 * Hisob **tur bo'yicha alohida** yuritiladi (gapirish alohida, qo'l alohida...) —
 * har xil turdagi bir martalik tasodifiy signallar qo'shilib jazoga aylanmasin.
 * Rasmiy ogohlantirish berilgach, o'sha tur hisobi nolga qaytadi.
 *
 * "Epizod" tushunchasi: signal uzluksiz davom etsa — bu BITTA kichik ogohlantirish.
 * Signal to'xtab, keyin qaytadan boshlansa — yangi epizod, hisob +1.
 */

/** Necha marta kichik ogohlantirishdan keyin keyingisi rasmiy bo'ladi. */
export const SMALL_WARNINGS_BEFORE_FORMAL = 3;

export class SmallWarningLedger {
  private counts = new Map<string, number>();
  private active = new Set<string>();

  constructor(private readonly limit: number = SMALL_WARNINGS_BEFORE_FORMAL) {}

  /**
   * Signal hozir kichik-ogohlantirish bosqichida (chip ko'rinyapti).
   * Yangi epizod bo'lsa hisobni oshiradi.
   *
   * @returns `true` — bu epizod uchun DARHOL rasmiy ogohlantirish berilishi kerak
   *          (ya'ni limit allaqachon to'lgan edi).
   */
  noteActive(key: string): boolean {
    if (this.active.has(key)) return false; // ayni epizod, qayta sanamaymiz
    this.active.add(key);
    const next = (this.counts.get(key) || 0) + 1;
    this.counts.set(key, next);
    return next > this.limit;
  }

  /** Signal to'xtadi — keyingi safar yangi epizod hisoblanadi. */
  noteCleared(key: string): void {
    this.active.delete(key);
  }

  /** Shu tur uchun nechta kichik ogohlantirish berilgan. */
  count(key: string): number {
    return this.counts.get(key) || 0;
  }

  /** Shu tur bo'yicha yana nechta kichik ogohlantirish qolgani (0 = keyingisi rasmiy). */
  remaining(key: string): number {
    return Math.max(0, this.limit - this.count(key));
  }

  /**
   * Rasmiy ogohlantirish berildi — hisob nolga qaytadi va epizod yopiladi
   * (talabaga toza start; keyingi rasmiy uchun yana 3 ta kichik kerak bo'ladi).
   */
  formalIssued(key: string): void {
    this.counts.delete(key);
    this.active.delete(key);
  }

  reset(): void {
    this.counts.clear();
    this.active.clear();
  }
}
