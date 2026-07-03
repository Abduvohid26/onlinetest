import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Card, CardContent } from '../components/ui';
import { motion } from 'motion/react';
import { translations, Language, formatPreExamMediaAccessFailure } from '../i18n';
import { readJsonSafe } from '../lib/http';
import { apiUrl } from '../lib/apiUrl';
import { examAuthHeaders, setDeviceSessionToken } from '../lib/deviceFingerprint';
import { compressVideoFrameToJpeg } from '../lib/compressToJpeg';
import { FacePositionChecker, type FacePositionStatus } from '../lib/facePositionCheck';
import { InstituteLogo } from '../components/InstituteLogo';
import { IdentityVerifiedSuccess } from '../components/IdentityVerifiedSuccess';
import { AdminBtn, AdminAlert, AdminInput } from './admin/ui';
import { Check } from 'lucide-react';
import {
  attachDefaultMicrophone,
  openCameraByTryingVideoInputs,
  openPreferredCameraStream,
  VIRTUAL_CAMERA_BLOCKED_MESSAGE,
} from '../lib/preferredCameraStream';

const PASSIVE_LIVE_SAMPLES = 12;
const PASSIVE_LIVE_GAP_MS = 260;
const PASSIVE_LIVE_THRESHOLD = 400;
const LIVENESS_W = 80;
const LIVENESS_H = 60;

/** Kadr yoritilishi/piksel yig'indisi o'zgarishi — foydalanuvchi harakat yoki tabiiy harakat */
async function samplePassiveFrameMotion(captureFrame: () => number): Promise<boolean> {
  let maxDelta = 0;
  let prev = 0;
  for (let i = 0; i < PASSIVE_LIVE_SAMPLES; i++) {
    await new Promise((r) => setTimeout(r, PASSIVE_LIVE_GAP_MS));
    const cur = captureFrame();
    if (cur > 0 && prev > 0) {
      maxDelta = Math.max(maxDelta, Math.abs(cur - prev));
    }
    if (cur > 0) prev = cur;
  }
  return maxDelta >= PASSIVE_LIVE_THRESHOLD;
}

export function PreExamCheck({
  exam,
  token,
  user,
  lang,
  onComplete,
  onCancel,
}: {
  exam: any;
  token: string;
  user: any;
  lang: Language;
  onComplete: (examData: any, seId: number) => void;
  onCancel: () => void;
}) {
  const [cameraReady, setCameraReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  /** Kamera bor, mikrofon ochilmagan — qizil xato emas, ogohlantirish */
  const [mediaHint, setMediaHint] = useState('');
  const [starting, setStarting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [verifyScore, setVerifyScore] = useState<number | null>(null);
  const [showVerifyCelebration, setShowVerifyCelebration] = useState(false);
  const [livenessPassed, setLivenessPassed] = useState(false);
  const [livenessChecking, setLivenessChecking] = useState(false);
  const [livenessRetryKey, setLivenessRetryKey] = useState(0);
  const [livenessFailed, setLivenessFailed] = useState(false);
  /** Pre-exam yuz pozitsiyasi gate (kameraga yaqin + markaz + to'g'ri qaragan). */
  const [positionStatus, setPositionStatus] = useState<FacePositionStatus>('WAITING');
  const [positionOk, setPositionOk] = useState(false);
  /** VAC qoidalari ro'yxati oxirigacha aylantirilgani (katta ekranda ham majburiy). */
  const [vacRulesScrolledEnd, setVacRulesScrolledEnd] = useState(false);
  const vacRulesBoxRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** Identity snapshot (JPEG) — faqat verifyIdentity */
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Liveness getImageData — alohida canvas (bir canvas da kontekst aralashmasin) */
  const livenessCanvasRef = useRef<HTMLCanvasElement>(null);
  const t = translations[lang];
  // Til faqat xato xabarlari uchun — ref orqali. Kamera effekti dependency'siga `lang`
  // qo'shilsa, til almashtirilganda kamera/getUserMedia qayta ishga tushadi (liveness uziladi).
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useLayoutEffect(() => {
    setVacRulesScrolledEnd(false);
    setAgreed(false);
  }, [lang]);

  useEffect(() => {
    const el = vacRulesBoxRef.current;
    if (!el) return;
    const measure = () => {
      const end =
        el.scrollHeight <= el.clientHeight + 12 ||
        el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
      setVacRulesScrolledEnd(end);
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [lang]);

  /**
   * Kamera kadridan piksel yig'indisini hisoblaydi.
   * Ko'z yumish yoki tabassum paytida yuz maydoni o'zgaradi — delta katta bo'ladi.
   */
  const captureFrame = (): number => {
    if (!videoRef.current || !livenessCanvasRef.current) return 0;
    const video = videoRef.current;
    const canvas = livenessCanvasRef.current;
    if (!video.videoWidth || !video.videoHeight) return 0;
    // O'lchamni faqat o'zgartirganda yangilaymiz — har kadrda width/height qayta yazilganda
    // canvas tozalanadi va Chromium willReadFrequently ogohlantirishini beradi.
    if (canvas.width !== LIVENESS_W) canvas.width = LIVENESS_W;
    if (canvas.height !== LIVENESS_H) canvas.height = LIVENESS_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 0;
    // Markaziy yuz zonasini olish
    const sw = video.videoWidth;
    const sh = video.videoHeight * 0.6;
    const sx = 0;
    const sy = 0;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Yorug'lik intensivligi (grayscale)
      sum += (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }
    return sum;
  };

  useEffect(() => {
    let stream: MediaStream | null = null;
    const checkDevices = async () => {
      const t = tRef.current; // joriy til (effekt qayta ishga tushmaydi)
      setError('');
      setMediaHint('');
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t.preExamMediaUnsupported);
        return;
      }
      const host = window.location.hostname;
      const isLocal =
        host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
      // Brauzerlar kamera/mikrofonni oddiy http:// domen uchun bloklaydi (localhost bundan mustasno)
      if (!isLocal && window.location.protocol !== 'https:') {
        setError(t.preExamRequiresHttps);
        return;
      }
      if (!isLocal && !window.isSecureContext) {
        setError(t.preExamRequiresHttps);
        return;
      }

      try {
        const q = navigator.permissions?.query?.bind(navigator.permissions);
        if (q) {
          try {
            const st = await q({ name: 'camera' as PermissionName });
            if (st.state === 'denied') {
              setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
              return;
            }
          } catch {
            /* Chromium: ba'zi versiyalarda query qo'llab-quvvatlanmaydi */
          }
        }
      } catch {
        /* ignore */
      }

      const domName = (err: unknown) =>
        err instanceof DOMException ? err.name : err instanceof Error ? err.name : '';

      const attachStream = (s: MediaStream) => {
        stream = s;
        setCameraReady(s.getVideoTracks().length > 0);
        setMicReady(s.getAudioTracks().length > 0);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      };

      // 1) Avval faqat kamera, keyin mikrofon — Windows/Chrome da bir vaqtda olish ko'pincha yiqiladi.
      try {
        const v = await openPreferredCameraStream(false, true);
        const micOk = await attachDefaultMicrophone(v);
        attachStream(v);
        if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
        return;
      } catch (e0: unknown) {
        const n0 = domName(e0);
        if (n0 === 'NotAllowedError' || n0 === 'PermissionDeniedError') {
          if (e0 instanceof DOMException && e0.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
            setError(t.virtualCameraBlocked);
            return;
          }
          setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
          return;
        }
        if (n0 === 'SecurityError') {
          setError(t.preExamRequiresHttps);
          return;
        }
        if (n0 === 'NotFoundError' || n0 === 'DevicesNotFoundError') {
          setError(t.preExamMediaNotFound);
          return;
        }
        if (n0 === 'NotReadableError' || n0 === 'TrackStartError') {
          try {
            const rotated = await openCameraByTryingVideoInputs();
            attachStream(rotated);
            if (rotated.getAudioTracks().length === 0) {
              setMediaHint(t.preExamMicOnlyFailed);
            }
            setError('');
            return;
          } catch {
            /* keyingi getUserMedia yo'llariga o'tamiz */
          }
        }
      }

      try {
        const s = await openPreferredCameraStream(true, true);
        attachStream(s);
        if (s.getAudioTracks().length === 0) setMediaHint(t.preExamMicOnlyFailed);
      } catch (e1: unknown) {
        const n1 = domName(e1);
        if (e1 instanceof DOMException && e1.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
          setError(t.virtualCameraBlocked);
        } else if (n1 === 'NotReadableError' || n1 === 'TrackStartError' || n1 === 'NotAllowedError') {
          let vOnly: MediaStream | null = null;
          try {
            vOnly = await openPreferredCameraStream(false, true);
            const micOk = await attachDefaultMicrophone(vOnly);
            attachStream(vOnly);
            if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
            setError('');
          } catch (innerErr: unknown) {
            if (vOnly) vOnly.getTracks().forEach((tr) => tr.stop());
            const ni = domName(innerErr);
            const ref = ni || n1;
            if (ref === 'NotAllowedError' || ref === 'PermissionDeniedError') {
              if (innerErr instanceof DOMException && innerErr.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
                setError(t.virtualCameraBlocked);
              } else {
                setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
              }
            } else if (ref === 'SecurityError') {
              setError(t.preExamRequiresHttps);
            } else if (ref === 'NotFoundError' || ref === 'DevicesNotFoundError') {
              setError(t.preExamMediaNotFound);
            } else {
              try {
                const rotated = await openCameraByTryingVideoInputs();
                attachStream(rotated);
                if (rotated.getAudioTracks().length === 0) {
                  setMediaHint(t.preExamMicOnlyFailed);
                }
                setError('');
              } catch {
                try {
                  const raw = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false,
                  });
                  const micOk = await attachDefaultMicrophone(raw);
                  attachStream(raw);
                  if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
                  setError('');
                } catch (rawErr: unknown) {
                  setError(formatPreExamMediaAccessFailure(rawErr, lang));
                }
              }
            }
          }
        } else if (n1 === 'SecurityError') {
          setError(t.preExamRequiresHttps);
        } else if (n1 === 'NotFoundError' || n1 === 'DevicesNotFoundError') {
          setError(t.preExamMediaNotFound);
        } else if (n1 === 'NotAllowedError' || n1 === 'PermissionDeniedError') {
          if (e1 instanceof DOMException && e1.message === VIRTUAL_CAMERA_BLOCKED_MESSAGE) {
            setError(t.virtualCameraBlocked);
          } else {
            setError(`${t.preExamPermissionDenied}\n\n${t.preExamSiteSettingsHint}`);
          }
        } else {
          setError(t.preExamCameraError);
        }
      }

      if (!stream) {
        try {
          const rotated = await openCameraByTryingVideoInputs();
          attachStream(rotated);
          if (rotated.getAudioTracks().length === 0) {
            setMediaHint(t.preExamMicOnlyFailed);
          }
          setError('');
        } catch {
          try {
            const raw = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
            const micOk = await attachDefaultMicrophone(raw);
            attachStream(raw);
            if (!micOk) setMediaHint(t.preExamMicOnlyFailed);
            setError('');
          } catch (finalErr: unknown) {
            setError((prev) =>
              prev && prev.length > 0 ? prev : formatPreExamMediaAccessFailure(finalErr, lang)
            );
          }
        }
      }
    };
    checkDevices();
    return () => {
      if (stream) stream.getTracks().forEach((track) => track.stop());
    };
    // Kamera faqat bir marta ochiladi (mount). Til o'zgarishi kamerani qayta ishga tushirmaydi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Pre-exam yuz pozitsiyasi gate (MediaPipe): yaqin + markaz + to'g'ri qaragan.
   *  Identity verify'dan OLDIN pozitsiyani ta'minlaymiz. */
  useEffect(() => {
    if (!cameraReady || verified) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    const checker = new FacePositionChecker(video, (status, okSustained) => {
      if (cancelled) return;
      setPositionStatus(status);
      setPositionOk(okSustained);
    });
    void checker.init().then((ok) => {
      if (cancelled) {
        checker.dispose();
        return;
      }
      if (ok) {
        checker.start();
      } else {
        // Model yuklanmadi (CDN bloklangan / eski qurilma) — gate skip, imtihon bloklanmasin.
        setPositionStatus('OK');
        setPositionOk(true);
      }
    });
    return () => {
      cancelled = true;
      checker.dispose();
    };
  }, [cameraReady, verified]);

  /** Shaxs tasdiqlandi — tugmasiz: kamera kadrlarida yengil harakat qidiriladi */
  useEffect(() => {
    if (!verified || livenessPassed || !cameraReady) return;

    let cancelled = false;
    const run = async () => {
      setLivenessChecking(true);
      setLivenessFailed(false);
      setError('');
      await new Promise((r) => setTimeout(r, 450));
      for (let round = 0; round < 3; round++) {
        if (cancelled) return;
        const ok = await samplePassiveFrameMotion(() => captureFrame());
        if (ok) {
          if (!cancelled) {
            setLivenessPassed(true);
            setLivenessChecking(false);
            setLivenessFailed(false);
            setError('');
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!cancelled) {
        setLivenessChecking(false);
        setLivenessFailed(true);
        setError(tRef.current.preExamLivenessFail);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, cameraReady, livenessPassed, livenessRetryKey]);

  useEffect(() => {
    if (!verified) {
      setShowVerifyCelebration(false);
      return;
    }
    setShowVerifyCelebration(true);
    const timer = window.setTimeout(() => setShowVerifyCelebration(false), 2800);
    return () => window.clearTimeout(timer);
  }, [verified]);

  const verifyIdentity = async () => {
    if (!videoRef.current || !canvasRef.current || !user.profile_image) return;
    setVerifying(true);
    setError('');
    try {
      const video = videoRef.current;
      const liveDataUrl = compressVideoFrameToJpeg(video, 0.78, 480, true);
      if (!liveDataUrl) return;
      const capturedImageBase64 = liveDataUrl.split(',')[1];
      const profilePayload = String(user.profile_image).includes(',')
        ? user.profile_image
        : `data:image/jpeg;base64,${user.profile_image}`;

      const response = await fetch(apiUrl('/api/student/identity-compare'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...examAuthHeaders(token),
        },
        body: JSON.stringify({
          exam_id: exam.id,
          profile_image_base64: profilePayload,
          live_capture_base64: capturedImageBase64,
        }),
      });
      const data =
        (await readJsonSafe<{
          match?: boolean;
          skipped?: boolean;
          code?: string;
          error?: string;
          score?: number;
          method?: string;
        }>(response)) || {};
      if (response.status === 503) {
        const code = data?.code || '';
        setError(
          code === 'GEMINI_UNAVAILABLE' || code === 'FACE_ENGINE_UNAVAILABLE'
            ? t.identityVerifyServiceDown
            : code === 'GEMINI_MODEL_INVALID'
              ? t.identityVerifyGeminiModelInvalid
              : code === 'GEMINI_ERROR'
                ? t.identityVerifyGeminiError
                : t.identityVerifyError
        );
        return;
      }
      if (response.status === 403) {
        const code = data?.code || '';
        const sessionLocked =
          code === 'DEVICE_MISMATCH' ||
          code === 'DEVICE_TOKEN_REQUIRED' ||
          code === 'DEVICE_FINGERPRINT_REQUIRED' ||
          code === 'VAC_HMAC_SESSION_MISSING' ||
          code.startsWith('VAC_');
        setError(
          code === 'STUDENT_ONLY'
            ? 'Yuz tekshiruvi faqat talaba hisobi uchun. Talaba ID bilan kiring.'
            : code === 'EXAM_NOT_ASSIGNED'
              ? 'Siz ushbu imtihon guruhiga biriktirilmagansiz. Administrator bilan bog‘laning.'
              : sessionLocked
                ? 'Bu imtihon allaqachon boshlangan (tugallanmagan sessiya bor). Avvalgi qurilma/oynada davom eting yoki administratordan imtihonni qayta ochishni so‘rang.'
                : t.identityVerifyError,
        );
        return;
      }
      if (!response.ok) {
        setError(t.identityVerifyError);
        return;
      }
      if (data.match === true) {
        setVerified(true);
        setVerifyScore(typeof data.score === 'number' ? data.score : null);
        setError('');
      } else {
        const code = data?.code || '';
        setError(
          code === 'FACE_NOT_DETECTED' ? t.identityVerifyFaceNotDetected : t.identityVerifyFailed,
        );
      }
    } catch {
      setError(t.identityVerifyError);
    } finally {
      setVerifying(false);
    }
  };

  const handleStart = async () => {
    if (exam.has_pin && !pin) {
      setError(t.enterPin);
      return;
    }
    setStarting(true);
    setError('');
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${exam.id}/start`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...examAuthHeaders(token),
        },
        body: JSON.stringify({ pin }),
      });
      const data = await readJsonSafe<{
        error?: string;
        exam?: any;
        studentExamId?: number;
        startedAt?: string;
        sessionKey?: string;
        sessionSeqStart?: number;
        sessionChallenge?: string;
        deviceToken?: string;
      }>(res);
      if (!res.ok) {
        setError(data?.error || t.preExamStartError);
        setStarting(false);
        return;
      }
      if (!data?.exam || data.studentExamId == null) {
        setError(t.preExamServerError);
        setStarting(false);
        return;
      }
      if (data.deviceToken) {
        setDeviceSessionToken(data.deviceToken);
      }
      onComplete(
        {
          ...data.exam,
          startedAt: data.startedAt,
          sessionKey: data.sessionKey,
          sessionSeqStart: data.sessionSeqStart,
          sessionChallenge: data.sessionChallenge,
        },
        data.studentExamId,
      );
    } catch {
      setError(t.preExamNetworkError);
      setStarting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="w-full min-h-[calc(100dvh-4.5rem)] flex flex-col bg-gray-50 pb-4"
    >
      <div className="shrink-0 w-full max-w-6xl mx-auto px-3 sm:px-4 pt-3 pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <InstituteLogo size="sm" />
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight truncate">{t.preExamTitle}</h1>
              <p className="text-xs sm:text-sm text-slate-500 truncate">{exam.title}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
            <span className={`px-3 py-1 rounded-full transition-all ${cameraReady ? 'bg-emerald-100 text-emerald-700 shadow-sm' : 'bg-gray-100 text-gray-600'}`}>
              {cameraReady ? '✓ Kamera' : '◯ Kamera'}
            </span>
            <span className={`px-3 py-1 rounded-full transition-all ${verified ? 'bg-emerald-100 text-emerald-700 shadow-sm' : 'bg-gray-100 text-gray-600'}`}>
              {verified ? '✓ Yuz' : '◯ Yuz'}
            </span>
            <span className={`px-3 py-1 rounded-full transition-all ${livenessPassed ? 'bg-emerald-100 text-emerald-700 shadow-sm' : 'bg-gray-100 text-gray-600'}`}>
              {livenessPassed ? '✓ Jonlilik' : '◯ Jonlilik'}
            </span>
          </div>
        </div>
      </div>

      <Card className="flex flex-col w-full max-w-6xl mx-3 sm:mx-auto rounded-2xl border border-indigo-200 bg-white shadow-md overflow-hidden">
        <CardContent className="flex flex-col p-3 sm:p-5 gap-4">
          {(error || mediaHint) && (
            <div className="shrink-0 space-y-2">
              {error && <AdminAlert type="error">{error}</AdminAlert>}
              {mediaHint && !error && <AdminAlert type="warning">{mediaHint}</AdminAlert>}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 items-start">
            <div className="flex flex-col overflow-hidden rounded-xl border border-amber-300 bg-amber-50 max-h-[46vh] lg:max-h-[440px] shadow-sm">
              <div className="shrink-0 px-3 py-2.5 border-b border-amber-200 bg-gradient-to-r from-amber-100/80 to-amber-50">
                <h3 className="font-bold text-amber-950 text-sm">{t.preExamVacRulesTitle}</h3>
                <p className="text-[11px] text-amber-900/70 mt-0.5 leading-snug line-clamp-2">{t.preExamVacRulesIntro}</p>
              </div>
              <div
                ref={vacRulesBoxRef}
                className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-3 py-2.5 text-[13px] text-gray-900 leading-relaxed space-y-2"
              >
                  {t.preExamVacRulesItems.split('|||RULE|||').map((line, i) => (
                    <div key={i} className="flex gap-2">
                      <span className="shrink-0 font-bold text-amber-800 tabular-nums w-5 text-right text-xs">{i + 1}.</span>
                      <p className="min-w-0 flex-1">{line.trim()}</p>
                    </div>
                  ))}
                </div>
                {!vacRulesScrolledEnd && (
                  <p className="shrink-0 px-3 py-1.5 text-center text-[10px] font-medium text-amber-900 bg-amber-100/60 border-t border-amber-100">
                    ↓ {t.preExamVacRulesScrollHint}
                  </p>
                )}
            </div>

            <div className="flex flex-col gap-3">
              <div className="shrink-0 flex justify-center">
                <div className="relative w-[min(64vw,260px)] sm:w-[280px] rounded-xl overflow-hidden border-2 border-indigo-300 bg-slate-900 aspect-[3/4] shadow-lg">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                    style={{
                      transform: 'scaleX(-1)',
                      filter: 'brightness(1.15) contrast(1.1) saturate(1.05)'
                    }}
                  />
                  <canvas ref={canvasRef} className="hidden" aria-hidden />
                  <canvas ref={livenessCanvasRef} className="hidden" aria-hidden />
                  {!cameraReady && (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs bg-white/90 px-2 text-center">
                      {t.preExamWaitCamera}
                    </div>
                  )}
                  {showVerifyCelebration && (
                    <IdentityVerifiedSuccess
                      title={t.identityVerifySuccessTitle}
                      subtitle={t.identityVerifySuccessSubtitle}
                      scoreLabel={
                        verifyScore != null
                          ? t.identityVerifyScore.replace('{score}', String(Math.round(verifyScore * 100)))
                          : undefined
                      }
                    />
                  )}
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1.5 shadow-lg">
                    <span className={`w-2 h-2 rounded-full ${cameraReady ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
                    <span className="text-white text-[11px] font-semibold">
                      {cameraReady ? t.preExamCameraActive : t.preExamWaitCamera}
                    </span>
                  </div>
                  <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1.5 shadow-lg">
                    <span className={`w-2 h-2 rounded-full ${micReady ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    <span className="text-white text-[11px] font-semibold">
                      {micReady ? t.preExamMicActive : t.preExamMicInactive}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2.5">
                {exam.custom_rules && (
                  <div className="p-2.5 border border-slate-300 bg-slate-50 rounded-lg text-xs text-slate-700 shadow-sm">
                    <span className="font-semibold text-slate-900">{t.customRules}: </span>
                    {exam.custom_rules}
                  </div>
                )}

                {user.profile_image ? (
                <div
                  className={`p-3 border rounded-xl space-y-2.5 shadow-sm transition-all ${
                    verified ? 'border-emerald-300 bg-emerald-50' : 'border-indigo-200 bg-indigo-50/40'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <img
                        src={user.profile_image}
                        alt={t.profilePhotoLabel}
                        className="w-11 h-11 rounded-lg object-cover border border-white shadow ring-1 ring-gray-200"
                        referrerPolicy="no-referrer"
                      />
                      {verified && (
                        <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white ring-2 ring-white">
                          <Check className="h-3 w-3 stroke-[3]" aria-hidden />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="font-semibold text-slate-900 text-sm">{t.identityVerification}</h4>
                      <p className="text-[11px] text-slate-500 truncate">{user.name || user.id}</p>
                    </div>
                  </div>

                  {!verified && (
                    <div
                      className={`rounded-lg px-2.5 py-2 border flex items-center gap-2 shadow-sm transition-all ${
                        positionOk ? 'bg-green-50 border-green-300' : 'bg-amber-50 border-amber-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                          positionOk ? 'bg-green-500' : 'bg-amber-500 animate-pulse'
                        }`}
                      />
                      <p className={`text-xs font-semibold leading-snug ${positionOk ? 'text-green-700' : 'text-amber-700'}`}>
                        {(
                          {
                            WAITING: t.preExamPositionWaiting,
                            NO_FACE: t.preExamPositionNoFace,
                            MULTIPLE_FACES: t.preExamPositionMulti,
                            TOO_FAR: t.preExamPositionTooFar,
                            TOO_CLOSE: t.preExamPositionTooClose,
                            OFF_CENTER: t.preExamPositionOffCenter,
                            TURNED: t.preExamPositionTurned,
                            OK: t.preExamPositionOk,
                          } as Record<FacePositionStatus, string>
                        )[positionStatus]}
                      </p>
                    </div>
                  )}

                  <AdminBtn
                    onClick={verifyIdentity}
                    disabled={!cameraReady || verifying || verified || !positionOk}
                    variant={verified ? 'emerald' : 'blue'}
                    size="md"
                    loading={verifying}
                    className="w-full"
                  >
                    {verified ? t.identityVerified : t.identityVerifyBtn}
                  </AdminBtn>

                  {(verified || livenessChecking || livenessPassed || livenessFailed) && (
                    <div className="text-xs text-gray-600">
                      {verified && !livenessPassed && !livenessChecking && !livenessFailed && (
                        <p>{t.preExamLivenessSelfHint}</p>
                      )}
                      {livenessChecking && (
                        <p className="text-indigo-700 flex items-center gap-1.5">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
                          {t.preExamLivenessWaiting}
                        </p>
                      )}
                      {livenessPassed && (
                        <p className="font-semibold text-green-700">{t.preExamLivenessPassed}</p>
                      )}
                      {verified && !livenessPassed && livenessFailed && !livenessChecking && (
                        <AdminBtn
                          variant="ghost"
                          size="sm"
                          className="w-full mt-1"
                          onClick={() => {
                            setLivenessFailed(false);
                            setError('');
                            setLivenessRetryKey((k) => k + 1);
                          }}
                        >
                          {t.preExamLivenessRetryBtn}
                        </AdminBtn>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 border border-red-300 bg-red-50 rounded-lg text-red-800 text-xs font-semibold shadow-sm">
                  {t.profilePhotoMissingExam}
                </div>
              )}

              </div>
            </div>
          </div>

          <div className="shrink-0 pt-2 border-t border-gray-200 space-y-2.5">
            {exam.has_pin && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4 p-3.5 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-white shadow-sm">
                <div className="flex items-center gap-2.5 shrink-0">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm shadow-indigo-500/30">
                    <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                  </span>
                  <label htmlFor="exam-pin" className="min-w-0">
                    <span className="block text-sm font-bold text-indigo-950 leading-tight">{t.enterPin}</span>
                    <span className="block text-[11px] text-indigo-700/70 leading-tight mt-0.5">{t.preExamPinHint}</span>
                  </label>
                </div>
                <AdminInput
                  id="exam-pin"
                  type="password"
                  inputMode="numeric"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="• • • • • •"
                  className="text-center text-lg tracking-[0.4em] font-semibold h-11 sm:ml-auto sm:max-w-[220px] bg-white border-indigo-200 focus:border-indigo-400"
                  autoComplete="off"
                />
              </div>
            )}

          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <label className="flex items-start gap-2.5 cursor-pointer flex-1 min-w-0">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                disabled={!vacRulesScrolledEnd}
                className="w-4 h-4 mt-0.5 text-black rounded border-gray-300 shrink-0 disabled:opacity-40"
              />
              <span className="font-medium text-gray-800 text-xs sm:text-sm leading-snug">{t.preExamAgreeAllRules}</span>
            </label>
            <div className="flex flex-col gap-2 shrink-0 sm:items-end w-full sm:w-auto">
              {/* Nima sabab tugma yopiq ekanini ko'rsatish */}
              {(() => {
                const blocked: string[] = [];
                if (!cameraReady) blocked.push(t.preExamBlockedCamera);
                if (!vacRulesScrolledEnd) blocked.push(t.preExamBlockedRules);
                if (!agreed) blocked.push(t.preExamBlockedAgree);
                if (exam.has_pin && !pin) blocked.push(t.preExamBlockedPin);
                if (!user.profile_image) blocked.push(t.preExamBlockedPhoto);
                if (!verified) blocked.push(t.preExamBlockedIdentity);
                if (!livenessPassed || livenessChecking) blocked.push(t.preExamBlockedLiveness);
                if (blocked.length === 0) return null;
                return (
                  <div className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 sm:max-w-xs sm:text-right">
                    <p className="font-semibold mb-0.5">{t.preExamStartChecklist}</p>
                    <ul className="space-y-0.5">
                      {blocked.slice(0, 4).map((b) => (
                        <li key={b}>✗ {b}</li>
                      ))}
                      {blocked.length > 4 && <li>+{blocked.length - 4} …</li>}
                    </ul>
                  </div>
                );
              })()}
              <div className="flex gap-2 w-full sm:w-auto">
                <AdminBtn variant="ghost" size="md" onClick={onCancel} disabled={starting} className="flex-1 sm:flex-none">
                  {t.cancel}
                </AdminBtn>
                <AdminBtn
                  variant="blue"
                  size="md"
                  loading={starting}
                  onClick={handleStart}
                  disabled={
                    !cameraReady ||
                    !agreed ||
                    !vacRulesScrolledEnd ||
                    (exam.has_pin && !pin) ||
                    !user.profile_image ||
                    !verified ||
                    !livenessPassed ||
                    livenessChecking
                  }
                  className="flex-1 sm:flex-none sm:px-6"
                >
                  {starting ? t.preExamStarting : t.takeExam}
                </AdminBtn>
              </div>
            </div>
          </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
