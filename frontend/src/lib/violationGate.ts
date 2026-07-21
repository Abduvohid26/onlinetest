/**
 * Yagona qoidabuzarlik darvozasi — proctoring eskalatsiya qonuni
 * (README.md "Proctoring eskalatsiya qoidasi") ni BARCHA qoidabuzarlik turlariga
 * bir xil qo'llaydi:
 *   1) confirmMs (1.5s) uzluksiz  → kichik (kamera panelidagi chip), rasmiy emas
 *   2) escalateMs (3s, jami)      → rasmiy ogohlantirish (backendga yuboriladi)
 *
 * Ikki xil manbani ham qamrab oladi:
 *   - State-based (poll): masalan tab yashiringan — har tick `push(type, active)`.
 *   - Event-based (bir martalik keypress: print-screen, clipboard, devtools) —
 *     hodisa bo'lganda `markEvent(type)`, so'ng har tick `push(type, false)`.
 *     Hodisa `eventHoldMs` davomida "faol" sanaladi; takrorlanmasa so'nadi (rasmiy
 *     bo'lmaydi), uzluksiz takrorlansa 3s da rasmiyga o'tadi ("davom etsa" qoidasi).
 */
import { ContinuousSignalTracker } from './continuousSignal';

export type GateStage = 'none' | 'small' | 'official';

export class ViolationGate {
  private trackers = new Map<string, ContinuousSignalTracker>();
  private holdUntil = new Map<string, number>();

  constructor(
    private confirmMs: number,
    private escalateMs: number,
    private graceMs = 700,
    private eventHoldMs = 600,
  ) {}

  private tracker(type: string): ContinuousSignalTracker {
    let t = this.trackers.get(type);
    if (!t) {
      t = new ContinuousSignalTracker(this.graceMs);
      this.trackers.set(type, t);
    }
    return t;
  }

  /** Bir martalik hodisa — turni qisqa vaqt "faol" holatga qo'yadi. */
  markEvent(type: string, now = Date.now()): void {
    this.holdUntil.set(type, now + this.eventHoldMs);
  }

  /**
   * Har tick chaqiriladi. `activeState` — state-based manba uchun (poll qilinadigan
   * holat, masalan tab yashiringan). Event-based turlar uchun `false` bering —
   * markEvent orqali qo'yilgan hold oynasi hisobga olinadi. Uzluksiz davomiylik (ms).
   */
  push(type: string, activeState: boolean, now = Date.now()): number {
    const active = activeState || now < (this.holdUntil.get(type) ?? 0);
    return this.tracker(type).push(active, now);
  }

  /** Davomiylik (ms) → bosqich. */
  stage(ms: number): GateStage {
    if (ms >= this.escalateMs) return 'official';
    if (ms >= this.confirmMs) return 'small';
    return 'none';
  }

  /** Rasmiyga o'tgandan keyin — qayta boshidan (tinimsiz takrorlanmasin). */
  reset(type: string): void {
    this.trackers.get(type)?.reset();
    this.holdUntil.delete(type);
  }
}
