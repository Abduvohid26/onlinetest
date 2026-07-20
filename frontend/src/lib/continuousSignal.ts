/**
 * Umumiy "davomiy signal" hisoblagichi — proctoring eskalatsiya qoidasi uchun
 * (README.md "Proctoring eskalatsiya qoidasi"). Video (realtimeProctor.ts) va
 * audio (ExamRoom ovoz tekshiruvi) signallari shu bir xil mexanizmni ishlatadi:
 * xom holat uzluksiz qancha vaqt davom etayotganini hisoblaydi, qisqa uzilishga
 * (freym flicker, so'zlar orasidagi pauza) grace-oyna bilan toqat qiladi.
 */
export class ContinuousSignalTracker {
  private activeSince: number | null = null;
  private lastActiveAt: number | null = null;

  constructor(private graceMs = 500) {}

  /** Xom holatni beradi, uzluksiz davomiylikni (ms) qaytaradi (0 = faol emas). */
  push(rawActive: boolean, now = Date.now()): number {
    if (rawActive) {
      if (this.activeSince == null) this.activeSince = now;
      this.lastActiveAt = now;
      return now - this.activeSince;
    }
    if (this.lastActiveAt != null && now - this.lastActiveAt <= this.graceMs) {
      return this.activeSince != null ? now - this.activeSince : 0;
    }
    this.activeSince = null;
    this.lastActiveAt = null;
    return 0;
  }

  /** Eskalatsiya (rasmiy violation) yuborilgandan keyin — qayta boshidan hisoblansin. */
  reset(): void {
    this.activeSince = null;
    this.lastActiveAt = null;
  }
}
