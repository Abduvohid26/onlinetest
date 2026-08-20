import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

const API_TARGET = process.env.VITE_PROXY_API || 'http://127.0.0.1:8000';
const WS_TARGET = API_TARGET.replace(/^http/, 'ws');

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
      // onnxruntime-web: .wasm faylini bundle'ga QO'SHMASLIK (aks holda 27MB
      // asset chiqadi). Bu shart bilan u tashqi fayl sifatida yuklanadi —
      // biz uni `public/ort/` dan beramiz (`ort.env.wasm.wasmPaths`).
      conditions: ['onnxruntime-web-use-extern-wasm', 'import', 'module', 'browser', 'default'],
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: API_TARGET,
          changeOrigin: true,
        },
        '/ws': {
          target: WS_TARGET,
          ws: true,
          changeOrigin: true,
        },
      },
      hmr:
        process.env.DISABLE_HMR === 'true'
          ? false
          : {
              path: '/__vite_hmr',
            },
    },
    build: {
      // Production build: console.* larni butunlay o'chirish (minifier darajasida)
      minify: 'terser',
      terserOptions: isProd
        ? {
            compress: {
              drop_console: false,
              drop_debugger: true,
              // console.error saqlanadi (prod monitoring / ErrorBoundary)
              pure_funcs: ['console.log', 'console.info', 'console.warn', 'console.debug'],
            },
          }
        : undefined,
    },
  };
});
