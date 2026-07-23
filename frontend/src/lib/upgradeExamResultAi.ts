import { apiUrl } from './apiUrl';
import { readJsonSafe } from './http';
import type { ExamResultPayload } from '../components/ExamResultSummary';
import type { Language } from '../i18n';

const POLL_INTERVAL_MS = 4000;
const MAX_POLLS = 30;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Natija ekranida AI tahlil hali kutilayaptimi (backend `ai_summary_pending`). */
export function isExamResultAiPending(data: ExamResultPayload | null | undefined): boolean {
  return Boolean(data?.ai_summary_pending);
}

/**
 * Submit dan keyin yoki natija ochilganda: `/result-details` orqali AI tahlilni
 * yangilaydi va `ai_summary_pending` false bo'lguncha (yoki limit) poll qiladi.
 */
export async function pollExamResultAiUpgrade(
  examId: number,
  token: string,
  lang: Language,
  onUpdate: (data: ExamResultPayload) => void,
  signal?: AbortSignal,
): Promise<void> {
  for (let i = 0; i < MAX_POLLS; i++) {
    if (signal?.aborted) return;
    try {
      const res = await fetch(apiUrl(`/api/student/exams/${examId}/result-details`), {
        headers: { Authorization: `Bearer ${token}`, 'X-Student-Lang': lang },
        signal,
      });
      if (!res.ok) break;
      const data = await readJsonSafe<ExamResultPayload>(res);
      if (!data?.result_public_id) break;
      onUpdate(data);
      if (!data.ai_summary_pending) return;
    } catch (err) {
      if (signal?.aborted) return;
      console.warn('[exam-result] AI upgrade poll failed:', err);
      break;
    }
    if (i + 1 < MAX_POLLS) {
      await sleep(POLL_INTERVAL_MS);
    }
  }
}
