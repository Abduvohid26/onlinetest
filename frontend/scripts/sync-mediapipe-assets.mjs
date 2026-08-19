/**
 * MediaPipe Tasks Vision artefaktlarini `public/mediapipe/` ga tayyorlaydi (build oldidan).
 *
 * NEGA KERAK: ilgari WASM runtime va uchta model to'g'ridan-to'g'ri tashqi
 * CDN'dan (jsdelivr + storage.googleapis.com) yuklanardi. Talaba tarmog'ida
 * o'sha hostlar ochilmasa `RealtimeProctor.init()` jimgina `false` qaytarardi —
 * ya'ni real-time yuz/nigoh/qo'l/ob'ekt nazorati BUTUNLAY o'chib qolardi va
 * buni na talaba, na admin sezardi. Endi artefaktlar o'z domenimizdan beriladi.
 *
 * `sync-vad-assets.mjs` bilan bir xil konventsiya: WASM `node_modules` dan
 * ko'chiriladi, modellar bir marta yuklanib `frontend/vendor/` da keshlanadi
 * (internetsiz muhitda ham build ishlaydi), hammasi `.gitignore` da.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(root, 'public/mediapipe');
const CACHE_DIR = path.join(root, 'vendor/mediapipe');

/** WASM runtime — npm paketining ichida keladi, tarmoq kerak emas. */
const WASM_SRC = path.join(root, 'node_modules/@mediapipe/tasks-vision/wasm');

/**
 * Modellar. SHA256 pin — ta'minot zanjiri xavfsizligi uchun (VAD modeli bilan
 * bir xil yondashuv). Versiya ko'tarilsa hash ham yangilanishi shart.
 *
 * DIQQAT: bu chegaralar/aniqlik `realtimeProctor.ts` va
 * `forbiddenObjectProctor.ts` dagi konstantalarga moslangan — modelni
 * almashtirish soxta ogohlantirishlar sonini o'zgartiradi.
 */
const MODELS = [
  {
    name: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  },
  {
    name: 'hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1',
  },
  {
    name: 'efficientdet_lite2.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite',
    sha256: '5d4ebec1029bc9907aeadb9e7b4ac9cb1da6a19d01ad375210a9ae18ba173302',
  },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function copyWasm() {
  if (!fs.existsSync(WASM_SRC)) {
    throw new Error(
      `@mediapipe/tasks-vision wasm katalogi topilmadi: ${WASM_SRC}\n"npm ci" ishga tushiring.`,
    );
  }
  const dest = path.join(OUT_DIR, 'wasm');
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(WASM_SRC)) {
    const from = path.join(WASM_SRC, file);
    const to = path.join(dest, file);
    if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue;
    fs.copyFileSync(from, to);
    console.log(`[mediapipe-assets] ${file} ko'chirildi`);
  }
}

async function fetchModel({ name, url, sha256: expected }) {
  const dest = path.join(OUT_DIR, 'models', name);
  const cache = path.join(CACHE_DIR, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  if (fs.existsSync(dest) && sha256(fs.readFileSync(dest)) === expected) return;

  if (fs.existsSync(cache)) {
    const buf = fs.readFileSync(cache);
    if (sha256(buf) === expected) {
      fs.writeFileSync(dest, buf);
      console.log(`[mediapipe-assets] ${name} keshdan olindi`);
      return;
    }
  }

  console.log(`[mediapipe-assets] ${name} yuklanmoqda…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name} yuklanmadi: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== expected) {
    throw new Error(`${name} SHA256 mos kelmadi.\n  kutilgan: ${expected}\n  olingan:  ${got}`);
  }
  fs.mkdirSync(path.dirname(cache), { recursive: true });
  fs.writeFileSync(cache, buf);
  fs.writeFileSync(dest, buf);
  console.log(`[mediapipe-assets] ${name} yuklandi va keshlandi`);
}

copyWasm();
for (const m of MODELS) await fetchModel(m);
