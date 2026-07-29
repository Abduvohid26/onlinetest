/**
 * Qisqa "ko'z qirida" qarashlarni yig'adi.
 *
 * Muammo: talaba yonidagi telefonni 0.5–1.5s bo'lib-bo'lib qaraydi —
 * uzluksiz 4s eskalatsiyaga yetmaydi, lekin cheat bo'ladi.
 *
 * Yechim: har bir yetarli uzun qarash "burst" bo'ladi; oynada N ta burst
 * to'plansa rasmiy signal beriladi (uzluksiz eskalatsiyadan mustaqil).
 */

export const GAZE_BURST_MIN_MS = 280;
export const GAZE_BURST_WINDOW_MS = 12_000;
export const GAZE_BURST_COUNT = 2;

export class GazeBurstTracker {
  private bursts: number[] = [];
  private currentStart: number | null = null;
  private lastDir: 'left' | 'right' | 'down' | 'up' | null = null;

  /** Hozirgi qarash yo'nalishi (emit uchun). */
  get lastDirection(): 'left' | 'right' | 'down' | 'up' | null {
    return this.lastDir;
  }

  /**
   * @returns `true` — burst limiti to'ldi, rasmiy violation yuborilsin.
   */
  push(
    away: boolean,
    direction: 'left' | 'right' | 'down' | 'up' | null,
    now = Date.now(),
  ): boolean {
    if (away) {
      if (this.currentStart == null) this.currentStart = now;
      if (direction) this.lastDir = direction;
      return false;
    }

    if (this.currentStart != null) {
      const dur = now - this.currentStart;
      this.currentStart = null;
      if (dur >= GAZE_BURST_MIN_MS) {
        this.bursts.push(now);
        this.bursts = this.bursts.filter((t) => now - t <= GAZE_BURST_WINDOW_MS);
        if (this.bursts.length >= GAZE_BURST_COUNT) {
          this.bursts = [];
          return true;
        }
      }
    }
    return false;
  }

  reset(): void {
    this.bursts = [];
    this.currentStart = null;
    this.lastDir = null;
  }
}
