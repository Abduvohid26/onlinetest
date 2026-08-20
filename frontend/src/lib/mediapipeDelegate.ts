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
export async function createWithDelegateFallback(
  Task: any,
  fileset: any,
  opts: any,
): Promise<any | null> {
  if (!Task?.createFromOptions) return null;
  let lastErr: unknown = null;
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      return await Task.createFromOptions(fileset, {
        ...opts,
        baseOptions: { ...opts.baseOptions, delegate },
      });
    } catch (err) {
      lastErr = err;
    }
  }
  // console.error — prod build faqat shuni saqlaydi (vite.config.ts pure_funcs).
  console.error('[mediapipe] GPU va CPU delegate ikkalasi ham ishlamadi:', lastErr);
  return null;
}
