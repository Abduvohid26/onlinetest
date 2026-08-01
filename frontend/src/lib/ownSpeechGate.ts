/**
 * "Bu talabaning O'Z ovozimi?" — tashqi shovqin nazorati o'chirilgan imtihonlarda
 * mikrofondagi nutqni faqat og'iz harakati bilan birga hisoblash uchun.
 *
 * Nega kerak: Silero VAD (va DSP zaxira) kimning ovozi ekanini AJRATMAYDI —
 * yonidagi odam, koridordagi gap, televizor ham "nutq" bo'lib chiqadi. Institut
 * binosida o'tkaziladigan imtihonda bu tinimsiz soxta ogohlantirish berardi.
 *
 * Nega bitta kadr yetarli emas: og'iz aniqlagichi qisqa noto'g'ri ijobiy beradi
 * (yutinish, kulish, chaynash) va yonidagi odam gapirayotgan paytga tasodifan mos
 * kelib qolishi mumkin. Shu sabab oxirgi ~2s oynasidagi kadrlarning KO'PCHILIGIDA
 * og'iz harakatda bo'lishi talab qilinadi.
 */

/** 200ms freym × 10 = ~2s oyna. */
export const MOUTH_WINDOW_SAMPLES = 10;
/** Shuncha kadr yig'ilmaguncha qaror qabul qilinmaydi (imtihon boshida). */
export const MOUTH_WINDOW_MIN_SAMPLES = 4;
/** Oynadagi og'iz-harakatli kadrlarning eng kam ulushi. */
export const MOUTH_WINDOW_ACTIVE_RATIO = 0.6;

export class OwnSpeechGate {
  private window: boolean[] = [];

  /**
   * Navbatdagi kadrni qo'shadi va hozir "talabaning o'zi gapiryapti" deb
   * hisoblash mumkinmi — shuni qaytaradi.
   */
  push(mouthActive: boolean): boolean {
    this.window.push(mouthActive);
    if (this.window.length > MOUTH_WINDOW_SAMPLES) this.window.shift();
    if (this.window.length < MOUTH_WINDOW_MIN_SAMPLES) return false;
    const active = this.window.reduce((n, v) => n + (v ? 1 : 0), 0);
    return active / this.window.length >= MOUTH_WINDOW_ACTIVE_RATIO;
  }

  reset(): void {
    this.window = [];
  }
}
