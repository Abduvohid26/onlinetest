/**
 * "Bu talabaning O'Z ovozimi?" — tashqi shovqin nazorati o'chirilgan imtihonlarda
 * mikrofondagi nutqni faqat og'iz harakati bilan birga hisoblash uchun.
 *
 * Nega kerak: Silero VAD (va DSP zaxira) kimning ovozi ekanini AJRATMAYDI —
 * yonidagi odam, koridordagi gap, televizor ham "nutq" bo'lib chiqadi. Institut
 * binosida o'tkaziladigan imtihonda bu tinimsiz soxta ogohlantirish berardi.
 *
 * MUHIM — sezgirlik: bu darvoza gapirishni aniqlash CHEGARALARIGA (Silero/DSP
 * ostonasi, TALK_SIGNAL_CONFIRM_MS / TALK_SIGNAL_ESCALATE_MS) UMUMAN tegmaydi.
 * U faqat "ovoz manbai kim?" degan savolga javob beradi. Shu sabab og'iz oxirgi
 * ~2s ichida BIR MARTA harakatlangani ham yetarli: talaba gapirganda og'iz ochilib
 * yopiladi, MediaPipe esa har kadrda emas, uzuq-yuluq aniqlaydi (past yorug'lik,
 * niqob, past FPS) — ko'pchilik kadr talab qilinsa, talabaning o'z gapirishi
 * aniqlanmay qolardi. Yonidagi odam gapirganda esa talabaning og'zi umuman
 * qimirlamaydi, ya'ni oyna bo'sh bo'ladi va signal hisoblanmaydi.
 */

/** 200ms freym × 10 = ~2s oyna. */
export const MOUTH_WINDOW_SAMPLES = 10;
/** Oynada shuncha og'iz-harakatli kadr bo'lsa — "o'zi gapiryapti". */
export const MOUTH_WINDOW_MIN_ACTIVE = 1;

export class OwnSpeechGate {
  private window: boolean[] = [];

  /**
   * Navbatdagi kadrni qo'shadi va hozir "talabaning o'zi gapiryapti" deb
   * hisoblash mumkinmi — shuni qaytaradi.
   */
  push(mouthActive: boolean): boolean {
    this.window.push(mouthActive);
    if (this.window.length > MOUTH_WINDOW_SAMPLES) this.window.shift();
    const active = this.window.reduce((n, v) => n + (v ? 1 : 0), 0);
    return active >= MOUTH_WINDOW_MIN_ACTIVE;
  }

  reset(): void {
    this.window = [];
  }
}
