import { useEffect, useRef } from 'react';
import {
  RealtimeProctor,
  type RealtimeViolation,
  type FaceStatusLive,
  type LiveSignalType,
  type GazeDebugInfo,
} from './realtimeProctor';
import type { GazeFeature, GazeModel } from './gazeMapping';

interface UseRealtimeProctoringOpts {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Real-time signal — odatda ExamRoom dagi logViolation ga ulanadi. */
  onViolation: (type: RealtimeViolation) => void;
  /** Person-swap shubhasi — darhol server identity-compare ishga tushiriladi. */
  onRecheckIdentity?: () => void;
  /** Har kadrda real-time yuz holati — kamera overlay uchun. */
  onFaceStatus?: (status: FaceStatusLive) => void;
  /** Davomiy signal (gapirish/bosh burilishi/pozitsiya) kichik→katta eskalatsiya holati. */
  onLiveSignal?: (type: LiveSignalType | null, elapsedMs: number) => void;
  /** Og'iz qimirlashi (Silero nutqini o'zi/boshqa deb ajratish). */
  onMouthActivity?: (active: boolean) => void;
  /** Kichik ogohlantirish bosqichidagi barcha signallar — "3 kichik → rasmiy" qonuni uchun. */
  onSmallWarningStage?: (types: LiveSignalType[]) => void;
  /** Stream tayyor bo'lgani: shu o'zgarganda engine qayta ishga tushadi. */
  streamRevision?: number;
  /** Imtihon oldi tekshiruvida o'lchangan tabiiy ko'z ochiqligi (nisbiy nigoh nazorati). */
  eyeBaseline?: number | null;
  disabled?: boolean;
  onReady?: (ok: boolean) => void;
  /** Sozlash rejimi (VITE_GAZE_DEBUG) — xom nigoh o'lchovlari. */
  onDebug?: (info: GazeDebugInfo) => void;
  /** Har kadrdagi nigoh belgilari — o'rganiladigan xarita namunasi uchun. */
  onGazeFeature?: (f: GazeFeature) => void;
  /** O'rganilgan xarita. `null` — eski qattiq chegaralar ishlaydi. */
  gazeModel?: GazeModel | null;
}

/**
 * MediaPipe asosidagi real-time proctoring (gaze/bosh burilishi, qimirlash,
 * qo'l/imo-ishora, ko'p yuz, yuz yo'q). Server proctoring bilan birga (gibrid) ishlaydi.
 * Model yuklanmasa jim o'chadi.
 */
export function useRealtimeProctoring({
  videoRef,
  onViolation,
  onRecheckIdentity,
  onFaceStatus,
  onLiveSignal,
  onMouthActivity,
  onSmallWarningStage,
  streamRevision = 0,
  eyeBaseline = null,
  disabled = false,
  onReady,
  onDebug,
  onGazeFeature,
  gazeModel = null,
}: UseRealtimeProctoringOpts): void {
  const proctorRef = useRef<RealtimeProctor | null>(null);

  useEffect(() => {
    if (disabled) return;
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    const proctor = new RealtimeProctor(video, {
      onViolation,
      onRecheckIdentity,
      onFaceStatus,
      onLiveSignal,
      onMouthActivity,
      onSmallWarningStage,
      onReady,
      onDebug,
      onGazeFeature,
      onStatus: (m) => console.info('[realtime-proctor]', m),
    }, eyeBaseline);

    void proctor.init().then((ok) => {
      if (cancelled) {
        proctor.dispose();
        return;
      }
      if (ok) proctor.start();
    });

    proctorRef.current = proctor;

    return () => {
      cancelled = true;
      proctorRef.current = null;
      proctor.dispose();
    };
    // streamRevision o'zgarsa (kamera qayta ishga tushsa) engine qayta yaratiladi.
  }, [disabled, streamRevision]);

  // Model alohida yangilanadi — engine qayta yaratilmasin (u og'ir va model
  // har necha bosishda qayta quriladi).
  useEffect(() => {
    proctorRef.current?.setGazeModel(gazeModel);
  }, [gazeModel]);
}
