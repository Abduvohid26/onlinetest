/**
 * MediaPipe task'ini avval GPU, so'ng CPU delegate bilan yaratish.
 *
 * NEGA KERAK: GPU (WebGL) har muhitda mavjud emas — apparat tezlashtirish
 * o'chirilgan Chrome, virtual mashina, eski drayver, ba'zi Linux
 * konfiguratsiyalari. GPU-only chaqiruv bunday joyda `createFromOptions`
 * bosqichida, MODEL FAYLINI OLISHDAN OLDIN xato beradi.
 *
 * Aynan shu holat ishlab chiqarishda uchradi: imtihon OLDI tekshiruvi ishlar
 * (`facePositionCheck.ts` da bu zaxira bor edi), imtihon ICHIDAGI real-time
 * nazorat esa jimgina o'chib qolardi (`realtimeProctor.ts` va
 * `forbiddenObjectProctor.ts` faqat GPU so'rardi). Server loglarida buni
 * ko'rish mumkin edi: WASM yuklanadi, lekin `face_landmarker.task` uchun
 * birorta so'rov ketmaydi.
 *
 * CPU sekinroq, lekin nazoratsiz qolishdan yaxshiroq.
 *
 * `null` = ikkalasi ham ishlamadi (chaqiruvchi zaxira yo'liga o'tadi).
 */
export interface DelegateResult {
  task: any | null;
  /** Ikkalasi ham yiqilsa — HAR BIR delegate uchun xato matni. Server logiga
   *  yuboriladi; umumiy "ishlamadi" xabari sababni yashirib qo'yardi. */
  errors?: Record<string, string>;
}

export async function createWithDelegateFallback(
  Task: any,
  fileset: any,
  opts: any,
): Promise<DelegateResult> {
  if (!Task?.createFromOptions) {
    return { task: null, errors: { module: 'Task sinfi mavjud emas' } };
  }
  const errors: Record<string, string> = {};
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      const task = await Task.createFromOptions(fileset, {
        ...opts,
        baseOptions: { ...opts.baseOptions, delegate },
      });
      return { task };
    } catch (err) {
      errors[delegate] = String((err as Error)?.message || err).slice(0, 200);
    }
  }
  // console.error — prod build faqat shuni saqlaydi (vite.config.ts pure_funcs).
  console.error('[mediapipe] GPU va CPU delegate ikkalasi ham ishlamadi:', errors);
  return { task: null, errors };
}

/** Xatolarni bitta qatorga — server logiga yuborish uchun. */
export function formatDelegateErrors(errors?: Record<string, string>): string {
  if (!errors) return '';
  return Object.entries(errors)
    .map(([k, v]) => `${k}=${v}`)
    .join(' | ');
}
