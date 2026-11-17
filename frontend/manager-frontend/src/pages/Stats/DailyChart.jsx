import { useState } from 'react';
import s from './Stats.module.scss';
import a from '../../styles/AdminPage.module.scss';

const money = (x) => (x >= 1 ? `$${x.toFixed(2)}` : `$${x.toFixed(4)}`);
/** Подпись над столбцом: коротко, чтобы помещалась. */
const short = (x) => (!x ? '' : x >= 1000 ? `$${(x / 1000).toFixed(1)}k` : x >= 100 ? `$${Math.round(x)}` : `$${x.toFixed(1)}`);
const shortDay = (day) => day.slice(5).split('-').reverse().join('.');
const num = (x) => (x ?? 0).toLocaleString('ru-RU');

const PROVIDER = {
  nanogpt: 'NanoGPT',
  openrouter: 'OpenRouter',
  gateway: 'LLMR',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};
const providerName = (id) => PROVIDER[id] ?? id;

/** Фактический расход по дням: столбцы с суммами и таблица с разбивкой по провайдерам. */
export default function DailyChart({ days }) {
  const [hover, setHover] = useState(null);
  if (!days.length) return null;

  const maxCost = Math.max(...days.map((d) => d.cost_usd), 0.000001);
  const maxMsg = Math.max(...days.map((d) => d.messages_in + d.messages_out), 1);
  const W = 1000;
  const H = 200;
  const pad = { left: 4, right: 4, top: 24, bottom: 18 };
  const inner = W - pad.left - pad.right;
  const step = inner / days.length;
  const barW = Math.max(2, Math.min(28, step * 0.62));
  const plotH = H - pad.top - pad.bottom;
  const labels = days.length <= 31;

  const labelEvery = Math.ceil(days.length / 12);
  const current = hover === null ? null : days[hover];
  const total = days.reduce((n, d) => n + d.cost_usd, 0);
  const providers = [...new Set(days.flatMap((d) => (d.by_provider ?? []).map((x) => x.provider)))].sort();

  return (
    <div className={s.chartWrap}>
      <div className={s.chartHead}>
        <span className={s.chartTitle}>Фактический расход по дням</span>
        <span className={s.chartHint}>
          {current
            ? `${shortDay(current.day)}: ${money(current.cost_usd)} · ${num(current.calls)} вызовов · ${current.messages_in}↓ ${current.messages_out}↑`
            : `за период ${money(total)} · максимум за день ${money(maxCost)}`}
        </span>
      </div>
      <svg className={s.chart} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Фактический расход по дням">
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
              {labels && d.cost_usd > 0 && (
                <text x={pad.left + i * step + step / 2} y={pad.top + plotH - h - 5} className={s.barValue} textAnchor="middle">
                  {short(d.cost_usd)}
                </text>
              )}
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

      <details className={s.dailyDetails}>
        <summary>Расход по дням таблицей</summary>
        <div className={a.tableWrap}>
          <table className={a.table} aria-label="Фактический расход по дням" data-testid="daily-costs">
            <thead>
              <tr>
                <th scope="col">День</th>
                <th scope="col" className={s.numCell}>Расход</th>
                {providers.map((id) => <th key={id} scope="col" className={s.numCell}>{providerName(id)}</th>)}
                <th scope="col" className={s.numCell}>Вызовов</th>
                <th scope="col" className={s.numCell}>Сообщений</th>
              </tr>
            </thead>
            <tbody>
              {[...days].reverse().map((d) => {
                const byId = new Map((d.by_provider ?? []).map((x) => [x.provider, x]));
                return (
                  <tr key={d.day}>
                    <td>{shortDay(d.day)}</td>
                    <td className={s.numCell}><b>{money(d.cost_usd)}</b></td>
                    {providers.map((id) => (
                      <td key={id} className={s.numCell}>
                        {byId.get(id)?.cost_usd ? money(byId.get(id).cost_usd) : <span className={a.muted}>—</span>}
                      </td>
                    ))}
                    <td className={s.numCell}>{num(d.calls)}</td>
                    <td className={s.numCell}>{num(d.messages_out)} ↑ / {num(d.messages_in)} ↓</td>
                  </tr>
                );
              })}
              <tr className={s.totalRow}>
                <td>Итого</td>
                <td className={s.numCell}>{money(total)}</td>
                {providers.map((id) => (
                  <td key={id} className={s.numCell}>
                    {money(days.reduce((n, d) => n + ((d.by_provider ?? []).find((x) => x.provider === id)?.cost_usd ?? 0), 0))}
                  </td>
                ))}
                <td className={s.numCell}>{num(days.reduce((n, d) => n + d.calls, 0))}</td>
                <td className={s.numCell}>
                  {num(days.reduce((n, d) => n + d.messages_out, 0))} ↑ / {num(days.reduce((n, d) => n + d.messages_in, 0))} ↓
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
