/**
 * Silero VAD uchun kerakli fayllarni `public/` ga ko'chiradi (build oldidan).
 *
 * Nega skript: bu ikki fayl JAMI ~16MB va ikkalasi ham hosil qilinadigan artefakt —
 * onnxruntime-web WASM runtime'i `node_modules` dan, model esa bir marta yuklab
 * olinadigan relizdan keladi. Ularni git'ga qo'yish repo'ni og'irlashtiradi, shu
 * sabab `.gitignore` da va har build'da shu skript orqali qayta hosil qilinadi.
 *
 * Model (2.3MB) internetdan tushiriladi va `frontend/vendor/` da keshlanadi —
 * ya'ni internetsiz muhitda ham (kesh mavjud bo'lsa) build ishlaydi.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL_URL =
  'https://raw.githubusercontent.com/snakers4/silero-vad/v6.2.1/src/silero_vad/data/silero_vad.onnx';
/**
 * Yuklangan model aynan kutilgan fayl ekanini tekshiramiz (ta'minot zanjiri xavfsizligi).
 * Bu — `docs/VAD_BENCHMARK.md` da o'lchangan AYNAN shu model (silero-vad v6.2.1).
 * Versiya ko'tarilsa benchmark qayta o'lchanishi kerak, shu sabab pin qilingan.
 */
const MODEL_SHA256 = '1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3';

const targets = [
  {
    from: path.join(root, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm'),
    to: path.join(root, 'public/ort/ort-wasm-simd-threaded.wasm'),
  },
  {
    from: path.join(root, 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs'),
    to: path.join(root, 'public/ort/ort-wasm-simd-threaded.mjs'),
  },
];

function copyRuntime() {
  fs.mkdirSync(path.join(root, 'public/ort'), { recursive: true });
  for (const { from, to } of targets) {
    if (!fs.existsSync(from)) {
      throw new Error(`onnxruntime-web fayli topilmadi: ${from}\n"npm ci" ishga tushiring.`);
    }
    if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue;
    fs.copyFileSync(from, to);
    console.log(`[vad-assets] ${path.basename(to)} ko'chirildi`);
  }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function fetchModel() {
  const dest = path.join(root, 'public/models/silero_vad.onnx');
  const cache = path.join(root, 'vendor/silero_vad.onnx');
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest) && sha256(fs.readFileSync(dest)) === MODEL_SHA256) return;

  if (fs.existsSync(cache)) {
    const buf = fs.readFileSync(cache);
    if (sha256(buf) === MODEL_SHA256) {
      fs.writeFileSync(dest, buf);
      console.log('[vad-assets] model keshdan olindi');
      return;
    }
  }

  console.log('[vad-assets] Silero VAD modeli yuklanmoqda…');
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`model yuklanmadi: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== MODEL_SHA256) {
    throw new Error(`model SHA256 mos kelmadi.\n  kutilgan: ${MODEL_SHA256}\n  olingan:  ${got}`);
  }
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, buf);
  fs.writeFileSync(dest, buf);
  console.log('[vad-assets] model yuklandi va keshlandi');
}

copyRuntime();
await fetchModel();
