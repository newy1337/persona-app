import { useState } from 'react';
import s from './Stats.module.scss';

const money = (x) => (x >= 1 ? `$${x.toFixed(2)}` : `$${x.toFixed(4)}`);
const shortDay = (day) => day.slice(5).replace('-', '.');

export default function DailyChart({ days }) {
  const [hover, setHover] = useState(null);
  if (!days.length) return null;

  const maxCost = Math.max(...days.map((d) => d.cost_usd), 0.000001);
  const maxMsg = Math.max(...days.map((d) => d.messages_in + d.messages_out), 1);
  const W = 1000;
  const H = 180;
  const pad = { left: 4, right: 4, top: 10, bottom: 18 };
  const inner = W - pad.left - pad.right;
  const step = inner / days.length;
  const barW = Math.max(2, Math.min(28, step * 0.62));
  const plotH = H - pad.top - pad.bottom;

  const labelEvery = Math.ceil(days.length / 12);
  const current = hover === null ? null : days[hover];

  return (
    <div className={s.chartWrap}>
      <div className={s.chartHead}>
        <span className={s.chartTitle}>Расход по дням</span>
        <span className={s.chartHint}>
          {current
            ? `${current.day}: ${money(current.cost_usd)} · ${current.calls} вызовов · ${current.messages_in}↓ ${current.messages_out}↑`
            : `максимум за день ${money(maxCost)}`}
        </span>
      </div>
      <svg className={s.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Расход по дням">
        {days.map((d, i) => {
          const x = pad.left + i * step + (step - barW) / 2;
          const h = (d.cost_usd / maxCost) * plotH;
          const msgH = ((d.messages_in + d.messages_out) / maxMsg) * plotH;
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.left + i * step} y={pad.top} width={step} height={plotH} fill="transparent" />
              <rect
                x={x}
                y={pad.top + plotH - h}
                width={barW}
                height={Math.max(h, d.cost_usd > 0 ? 1.5 : 0)}
                rx="2"
                className={hover === i ? s.barHot : s.bar}
              />
              <rect x={x} y={pad.top + plotH - msgH} width={barW} height="1.5" className={s.msgLine} />
              {i % labelEvery === 0 && (
                <text x={pad.left + i * step + step / 2} y={H - 5} className={s.tick} textAnchor="middle">
                  {shortDay(d.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className={s.legend}>
        <span><i className={s.swatchBar} /> деньги</span>
        <span><i className={s.swatchMsg} /> сообщения</span>
      </div>
    </div>
  );
}
