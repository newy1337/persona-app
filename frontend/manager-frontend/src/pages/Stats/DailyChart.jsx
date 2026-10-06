import { useState } from 'react';
import { Card } from '@/components/ui/card';

const money = (x) => (x >= 1 ? `$${x.toFixed(2)}` : `$${x.toFixed(4)}`);
const shortDay = (day) => day.slice(5).replace('-', '.');

function Legend() {
  return (
    <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-primary/70" /> деньги</span>
      <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-2.5 rounded-sm bg-success-foreground" /> сообщения</span>
    </span>
  );
}

export default function DailyChart({ days }) {
  const [hover, setHover] = useState(null);

  if (!days.length) {
    return (
      <Card className="min-h-[230px] gap-2 p-4">
        <div className="flex min-h-5 items-center justify-between gap-3">
          <span className="text-sm font-medium">Расход по дням</span>
          <Legend />
        </div>
        <p className="flex flex-1 items-center justify-center text-sm text-muted-foreground">За период вызовов не было</p>
      </Card>
    );
  }

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
    <Card className="min-h-[230px] gap-2 p-4">
      <div className="flex min-h-5 items-center gap-3">
        <span className="shrink-0 text-sm font-medium">Расход по дням</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
          {current
            ? `${current.day}: ${money(current.cost_usd)} · ${current.calls} вызовов · ${current.messages_in}↓ ${current.messages_out}↑`
            : `максимум за день ${money(maxCost)}`}
        </span>
        <Legend />
      </div>
      <svg
        className="h-[170px] w-full"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label="Расход по дням"
      >
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
                className={hover === i ? 'fill-primary' : 'fill-primary/70'}
              />
              <rect x={x} y={pad.top + plotH - msgH} width={barW} height="1.5" className="fill-success-foreground" />
              {i % labelEvery === 0 && (
                <text
                  x={pad.left + i * step + step / 2}
                  y={H - 5}
                  className="fill-muted-foreground text-[11px]"
                  textAnchor="middle"
                >
                  {shortDay(d.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </Card>
  );
}
