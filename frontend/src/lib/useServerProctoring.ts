import { useEffect, useRef } from 'react';
import { apiUrl } from './apiUrl';
import { compressVideoFrameToJpeg } from './compressToJpeg';

interface UseServerProctoringOpts {
  examId: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  guardHeadersFn: (method: string, path: string) => Promise<Record<string, string>>;
  onViolations: (types: string[]) => void;
  intervalMs?: number;
  disabled?: boolean;
}

/**
 * Har `intervalMs` da video kadrni serverga yuborib yuz/ob'ekt tahlili qiladi.
 * Server Gemini Vision bilan tahlil qilib violations ro'yxatini qaytaradi.
 * Browser-da MediaPipe + COCO-SSD ishlatish shart emas — bundle hajmini ~3 MB kamaytiradi.
 */
export function useServerProctoring({
  examId,
  videoRef,
  guardHeadersFn,
  onViolations,
  intervalMs = 30_000,
  disabled = false,
}: UseServerProctoringOpts): void {
  const busyRef = useRef(false);
  const examIdRef = useRef(examId);

  useEffect(() => {
    examIdRef.current = examId;
  }, [examId]);

  useEffect(() => {
    if (disabled) return;

    type ProctorResult = { violations?: string[]; skipped?: boolean };

    const emit = (data: ProctorResult | null) => {
      if (data && !data.skipped && Array.isArray(data.violations) && data.violations.length > 0) {
        onViolations(data.violations);
      }
    };

    // Async (Celery worker) holat: 202 + {task_id} qaytsa, natijani poll qilamiz.
    // Bir necha urinishdan keyin chiqmasa, kadrni o'tkazib yuboramiz (best-effort proctoring).
    const pollResult = async (
      examId: number,
      taskId: string,
      intervalMs: number,
    ): Promise<ProctorResult | null> => {
      const maxAttempts = 8;
      const wait = Math.max(500, intervalMs || 1500);
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, wait));
        const path = `/api/student/exams/${examId}/proctor-frame/${taskId}`;
        let res: Response;
        try {
          res = await fetch(apiUrl(path), {
            method: 'GET',
            headers: { ...(await guardHeadersFn('GET', path)) },
          });
        } catch {
          continue;
        }
        if (res.status === 202) continue; // hali tayyor emas
        if (!res.ok) return null;
        return (await res.json()) as ProctorResult;
      }
      return null;
    };

    const run = async () => {
      if (busyRef.current) return;
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      busyRef.current = true;
      try {
        const dataUrl = compressVideoFrameToJpeg(video, 0.6, 480);
        if (!dataUrl) return;
        const frameB64 = dataUrl.split(',')[1];

        const path = `/api/student/exams/${examIdRef.current}/proctor-frame`;
        const res = await fetch(apiUrl(path), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(await guardHeadersFn('POST', path)),
          },
          body: JSON.stringify({ frame: frameB64 }),
        });

        if (res.status === 202) {
          // Worker'ga topshirildi — natijani poll qilamiz.
          const q = (await res.json()) as { task_id?: string; poll_after_ms?: number };
          if (q.task_id) {
            emit(await pollResult(examIdRef.current, q.task_id, q.poll_after_ms ?? 1500));
          }
          return;
        }

        if (!res.ok) return;
        emit((await res.json()) as ProctorResult);
      } catch {
        // Tarmoq xatosi — keyingi siklda qayta urinish
      } finally {
        busyRef.current = false;
      }
    };

    const id = window.setInterval(run, intervalMs);
    // Birinchi tekshiruvni tezda o'tkazib yubormaymiz — stream tayyor bo'lishi uchun 5s kutamiz
    const firstTimer = window.setTimeout(run, 5_000);

    return () => {
      clearInterval(id);
      clearTimeout(firstTimer);
    };
  }, [disabled, examId, intervalMs]);
}
