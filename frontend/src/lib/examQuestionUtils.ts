/** Savol variantlarini ko'rsatish uchun normalizatsiya (bo'sh stringlarni filtrlash). */
export function normalizeQuestionOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const cleaned = options.map((o) => String(o ?? '').trim()).filter(Boolean);
  if (cleaned.length >= 2) return cleaned.slice(0, 5);
  const letters = ['A', 'B', 'C', 'D', 'E'];
  const count = Math.max(2, Math.min(5, options.length || 2));
  return Array.from({ length: count }, (_, i) => {
    const raw = String(options[i] ?? '').trim();
    if (raw) return raw;
    return `${letters[i]}) Variant`;
  });
}

export function optionLetter(index: number): string {
  return String.fromCharCode(65 + index);
}

/** Savol matnidan import qoldiqlarini olib tashlash */
export function cleanQuestionPrompt(text: string): string {
  return (text || '')
    .replace(/\n?\s*Выберите один из \d+ вариантов ответа:?\s*$/i, '')
    .replace(/\n?\s*5 ta javob variantidan birini tanlang:?\s*$/i, '')
    .replace(/\n?\s*Choose one of \d+ answer options:?\s*$/i, '')
    .trim();
}
