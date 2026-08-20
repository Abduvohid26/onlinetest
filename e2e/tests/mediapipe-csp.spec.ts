import { test, expect } from '@playwright/test';

/**
 * CSP MediaPipe'ni bloklamasligi — regressiya testi.
 *
 * TARIX: ishlab turgan serverda (online-imtixon.uz) teskari proksi nginx shu
 * sarlavhani qo'yardi:
 *
 *   Content-Security-Policy: default-src 'self'; script-src 'self'; ...
 *
 * `script-src` ko'rsatilgan, lekin `'wasm-unsafe-eval'` YO'Q. Chrome bunday
 * holatda `WebAssembly.instantiate()` ni butunlay bloklaydi. Natijada
 * MediaPipe hech qachon ishga tushmasdi va butun real-time nazorat (yuz,
 * nigoh, bosh burilishi, pozitsiya, qo'l, ob'ekt) o'chiq turardi — tashqaridan
 * esa "kamera ishlayapti" bo'lib ko'rinardi.
 *
 * Bu test ikkala holatni ham o'lchaydi: eski (buzuq) CSP bilan WASM
 * bloklanishini, tuzatilgani bilan esa ishlashini.
 */

const STRICT_BAD =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; " +
  "connect-src 'self' wss: https:; frame-ancestors 'self'; base-uri 'self'; object-src 'none'";

const FIXED =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; " +
  "font-src 'self' data:; connect-src 'self' wss: https:; frame-ancestors 'self'; " +
  "base-uri 'self'; object-src 'none'";

/** Sahifa hujjatiga berilgan CSP bilan WebAssembly kompilyatsiyasini sinaydi. */
async function wasmWorksUnderCsp(page: any, baseURL: string, csp: string): Promise<string> {
  await page.route('**/*', async (route: any) => {
    const req = route.request();
    if (req.resourceType() !== 'document') return route.continue();
    const res = await route.fetch();
    const headers = { ...res.headers(), 'content-security-policy': csp };
    return route.fulfill({ response: res, headers });
  });
  await page.goto(baseURL);

  return page.evaluate(async () => {
    // Eng kichik yaroqli WASM moduli — kompilyatsiya CSP bilan bloklanadimi?
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    try {
      await WebAssembly.instantiate(bytes);
      return 'OK';
    } catch (e: any) {
      return 'BLOKLANDI: ' + String(e?.message || e).slice(0, 120);
    }
  });
}

test("eski CSP ('wasm-unsafe-eval' YO'Q) — WASM bloklanadi", async ({ page, baseURL }) => {
  const r = await wasmWorksUnderCsp(page, baseURL!, STRICT_BAD);
  console.log('\n  eski CSP  →', r);
  expect(r, "bu CSP WASM'ni bloklashi KUTILADI — aks holda diagnoz noto'g'ri").toContain('BLOKLANDI');
});

test("tuzatilgan CSP ('wasm-unsafe-eval' BOR) — WASM ishlaydi", async ({ page, baseURL }) => {
  const r = await wasmWorksUnderCsp(page, baseURL!, FIXED);
  console.log('  tuzatilgan CSP →', r, '\n');
  expect(r, 'tuzatilgan CSP bilan WASM ishlashi SHART').toBe('OK');
});
