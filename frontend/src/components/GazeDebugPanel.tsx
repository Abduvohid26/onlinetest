/**
 * Nigoh sozlash paneli — FAQAT ishlab chiquvchi uchun (`VITE_GAZE_DEBUG=1`).
 *
 * Nega kerak: nigoh chegaralari hozir qattiq konstantalar (`IRIS_GAZE_X`,
 * `IRIS_GAZE_DOWN`, `PITCH_UP`...) va ular "havoda" tanlangan. Ularni o'rniga
 * o'rganiladigan chegaralar qo'yishdan oldin xom qiymatlar qanday harakat
 * qilishini KO'RISH kerak — aks holda yangi chegaralarni ham taxminan
 * tanlaymiz va o'sha xatoni takrorlaymiz.
 *
 * Panel qorachiq siljishini kvadratda nuqta sifatida chizadi va joriy
 * chegaralarni chiziq qilib qo'yadi. Shu ko'rinishda darrov ma'lum bo'ladi:
 * chap/o'ng va past chegarasi bor, TEPA chegarasi esa YO'Q — aynan shu sabab
 * noutbuk tepasiga qarash aniqlanmaydi.
 *
 * Talabaga hech qachon ko'rsatilmaydi: chaqiruvchi bayroqni tekshiradi.
 */
import type { GazeDebugInfo } from '../lib/realtimeProctor';

/** Grafik ko'rish maydoni: dx/dy shu oraliqda chiziladi. */
const RANGE = 0.45;
const SIZE = 150;

/** dx/dy (-RANGE..RANGE) → SVG piksel (0..SIZE). */
const toPx = (v: number): number => (v / RANGE + 1) * (SIZE / 2);

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-2 tabular-nums">
      <span className="text-slate-400">{label}</span>
      <span className={warn ? 'text-amber-300 font-semibold' : 'text-slate-100'}>{value}</span>
    </div>
  );
}

export function GazeDebugPanel({ info }: { info: GazeDebugInfo | null }) {
  if (!info) {
    return (
      <div className="rounded-lg bg-slate-900 text-slate-400 text-[11px] p-3 font-mono">
        gaze-debug: kutilmoqda…
      </div>
    );
  }

  const { iris, thresholds: th, active, ms, head } = info;
  const xLeft = toPx(-th.irisX);
  const xRight = toPx(th.irisX);
  const yDown = toPx(th.irisDown);
  const dotX = iris ? toPx(Math.max(-RANGE, Math.min(RANGE, iris.dx))) : null;
  const dotY = iris ? toPx(Math.max(-RANGE, Math.min(RANGE, iris.dy))) : null;

  const fmt = (v: number, d = 3) => v.toFixed(d);
  const anyActive = active.up || active.down || active.left || active.right || active.turn;

  return (
    <div className="rounded-lg bg-slate-900 text-slate-100 text-[11px] p-3 font-mono space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-300">gaze-debug</span>
        <span className={anyActive ? 'text-amber-300' : 'text-emerald-400'}>
          {anyActive ? 'SIGNAL' : 'ok'}
        </span>
      </div>

      <svg width={SIZE} height={SIZE} className="bg-slate-950 rounded mx-auto block">
        {/* markaz o'qlari */}
        <line x1={SIZE / 2} y1={0} x2={SIZE / 2} y2={SIZE} stroke="#1e293b" />
        <line x1={0} y1={SIZE / 2} x2={SIZE} y2={SIZE / 2} stroke="#1e293b" />

        {/* mavjud chegaralar */}
        <line x1={xLeft} y1={0} x2={xLeft} y2={SIZE} stroke="#38bdf8" strokeDasharray="3 2" />
        <line x1={xRight} y1={0} x2={xRight} y2={SIZE} stroke="#38bdf8" strokeDasharray="3 2" />
        <line x1={0} y1={yDown} x2={SIZE} y2={yDown} stroke="#38bdf8" strokeDasharray="3 2" />

        {/* Model yo'q ekan — tepa chegarasi ham yo'q (eski qattiq chegaralar). */}
        {!info.model && (
          <text x={4} y={12} fill="#f87171" fontSize="9">
            tepa chegarasi YO'Q
          </text>
        )}

        {dotX !== null && dotY !== null ? (
          <circle cx={dotX} cy={dotY} r={4} fill={anyActive ? '#fbbf24' : '#4ade80'} />
        ) : (
          <text x={SIZE / 2 - 26} y={SIZE / 2} fill="#64748b" fontSize="9">
            iris yo'q
          </text>
        )}
      </svg>

      <div className="space-y-0.5">
        <Row label="dx" value={iris ? fmt(iris.dx) : '—'} warn={active.left || active.right} />
        <Row label="dy" value={iris ? fmt(iris.dy) : '—'} warn={active.down} />
        <Row label="ko'z tor" value={info.eyesNarrow ? 'HA' : "yo'q"} warn={info.eyesNarrow} />
        <Row label="baseline" value={info.eyeBaseline ? fmt(info.eyeBaseline) : 'yo‘q'} />
        <Row label="yaw" value={fmt(head.yaw)} warn={active.turn} />
        <Row label="pitch" value={fmt(head.pitch)} warn={active.up} />
        <Row label="masofa (yuz h)" value={fmt(info.faceHeight)} />
      </div>

      {/* O'rganilgan xarita: ekran to'rtburchagi va bashorat nuqtasi. */}
      {info.model && (
        <div className="pt-1 border-t border-slate-700 space-y-1">
          <div className="text-slate-300">
            xarita: {info.model.samples} namuna
          </div>
          <svg width={SIZE} height={SIZE} className="bg-slate-950 rounded mx-auto block">
            {(() => {
              const mx = info.model!.marginX;
              const my = info.model!.marginY;
              // Ko'rish maydoni: ekran (0..1) + har tomondan oraliq.
              const lo = -Math.max(mx, my) - 0.15;
              const hi = 1 + Math.max(mx, my) + 0.15;
              const p = (v: number) => ((v - lo) / (hi - lo)) * SIZE;
              const px = p(info.model!.sx);
              const py = p(info.model!.sy);
              const inside =
                info.model!.sx >= -mx &&
                info.model!.sx <= 1 + mx &&
                info.model!.sy >= -my &&
                info.model!.sy <= 1 + my;
              return (
                <>
                  {/* Oraliq bilan kengaytirilgan ruxsat sohasi */}
                  <rect
                    x={p(-mx)}
                    y={p(-my)}
                    width={p(1 + mx) - p(-mx)}
                    height={p(1 + my) - p(-my)}
                    fill="none"
                    stroke="#38bdf8"
                    strokeDasharray="3 2"
                  />
                  {/* Haqiqiy ekran */}
                  <rect
                    x={p(0)}
                    y={p(0)}
                    width={p(1) - p(0)}
                    height={p(1) - p(0)}
                    fill="#0f172a"
                    stroke="#475569"
                  />
                  <text x={p(0) + 3} y={p(0) + 10} fill="#475569" fontSize="8">
                    ekran
                  </text>
                  <circle cx={px} cy={py} r={4} fill={inside ? '#4ade80' : '#f87171'} />
                </>
              );
            })()}
          </svg>
          <Row
            label="bashorat"
            value={`${info.model.sx.toFixed(2)}, ${info.model.sy.toFixed(2)}`}
          />
          <Row
            label="oraliq"
            value={`${info.model.marginX.toFixed(2)} / ${info.model.marginY.toFixed(2)}`}
          />
        </div>
      )}

      <div className="pt-1 border-t border-slate-700 space-y-0.5">
        <Row label="tepa" value={`${active.up ? '●' : '·'} ${Math.round(ms.up)}ms`} warn={active.up} />
        <Row label="past" value={`${active.down ? '●' : '·'} ${Math.round(ms.down)}ms`} warn={active.down} />
        <Row label="chap" value={`${active.left ? '●' : '·'} ${Math.round(ms.left)}ms`} warn={active.left} />
        <Row label="o'ng" value={`${active.right ? '●' : '·'} ${Math.round(ms.right)}ms`} warn={active.right} />
      </div>
    </div>
  );
}
