import { useMemo, useState } from 'react';
import s from '../../styles/AdminPage.module.scss';
import p from './Stats.module.scss';
import { DEAL_STAGES } from '../../data/dealStages';


const money = (x) => (x >= 1 ? `$${x.toFixed(2)}` : `$${(x ?? 0).toFixed(4)}`);
const num = (x) => (x ?? 0).toLocaleString('ru-RU');
const kilo = (x) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)} млн` : x >= 1e3 ? `${(x / 1e3).toFixed(1)} тыс.` : String(x ?? 0));
const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
const shortDay = (d) => d.slice(5).split('-').reverse().join('.');
const tokensOf = (t) => (t ? t.input + t.cache_read + t.cache_write : 0);

const COLUMNS = [
  { id: 'cost_usd', title: 'Расход', hint: 'Деньги за вызовы моделей' },
  { id: 'calls', title: 'Вызовов', hint: 'Обращений к модели' },
  { id: 'leads_uploaded', title: 'Номеров', hint: 'Загружено номеров и ников за период' },
  { id: 'leads_valid', title: 'Валидных', hint: 'Из загруженных нашлись в Telegram' },
  { id: 'leads_replied', title: 'Ответили', hint: 'Из загруженных ответили на первое сообщение' },
  { id: 'active_chats', title: 'Переписок', hint: 'Диалоги, где собеседник писал в этот период' },
  { id: 'messages_out', title: 'Сообщений', hint: 'Исходящие и входящие' },
  { id: 'stages_total', title: 'Этапы', hint: 'Сколько чатов менеджера перешло в этап за период' },
];

const stagesTotal = (st) => DEAL_STAGES.reduce((n, s) => n + (st?.[s.id] ?? 0), 0);
function StagesCell({ stages }) {
  const parts = DEAL_STAGES.filter((s) => stages?.[s.id]).map((s) => `${s.label.toLowerCase()} ${stages[s.id]}`);
  const title = DEAL_STAGES.map((s) => `${s.label}: ${stages?.[s.id] ?? 0}`).join('\n');
  return (
    <td className={p.numCell} title={title} data-testid="stages-cell">
      {parts.length ? parts.join(' · ') : <span className={s.muted}>—</span>}
    </td>
  );
}

function Cells({ row, share }) {
  return (
    <>
      <td className={p.numCell}>
        {money(row.cost_usd)}
        {share !== null && <span className={s.muted}> · {pct(share)}</span>}
      </td>
      <td className={p.numCell}>
        {num(row.calls)}
        <span className={s.muted}> · {kilo(tokensOf(row.tokens))}</span>
      </td>
      <td className={p.numCell}>{row.leads_uploaded ? num(row.leads_uploaded) : <span className={s.muted}>—</span>}</td>
      <td className={p.numCell}>
        {row.leads_uploaded ? (
          <>
            {num(row.leads_valid)}
            <span className={s.muted}> · {pct(row.leads_valid / row.leads_uploaded)}</span>
          </>
        ) : (
          <span className={s.muted}>—</span>
        )}
      </td>
      <td className={p.numCell}>
        {row.leads_valid ? (
          <>
            {num(row.leads_replied)}
            <span className={s.muted}> · {pct(row.leads_replied / row.leads_valid)}</span>
          </>
        ) : (
          <span className={s.muted}>—</span>
        )}
      </td>
      <td className={p.numCell}>{num(row.active_chats)}</td>
      <td className={p.numCell}>
        {num(row.messages_out)} ↑<span className={s.muted}> / {num(row.messages_in)} ↓</span>
        {row.manual_share > 0 && <span className={s.muted}> · руками {pct(row.manual_share)}</span>}
      </td>
      <StagesCell stages={row.stages} />
    </>
  );
}

export default function ManagersTable({ rows }) {
  const [open, setOpen] = useState(() => new Set());
  const [sort, setSort] = useState('cost_usd');

  const metric = (r, key) => (key === 'stages_total' ? stagesTotal(r.stages) : r[key] ?? 0);
  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) => metric(b, sort) - metric(a, sort)), [rows, sort]);
  const total = useMemo(
    () =>
      (rows ?? []).reduce(
        (acc, r) => {
          for (const key of ['cost_usd', 'calls', 'leads_uploaded', 'leads_valid', 'leads_replied', 'active_chats', 'messages_in', 'messages_out']) {
            acc[key] += r[key] ?? 0;
          }
          for (const key of ['input', 'output', 'cache_read', 'cache_write']) acc.tokens[key] += r.tokens?.[key] ?? 0;
          for (const st of DEAL_STAGES) acc.stages[st.id] += r.stages?.[st.id] ?? 0;
          return acc;
        },
        {
          cost_usd: 0, calls: 0, leads_uploaded: 0, leads_valid: 0, leads_replied: 0,
          active_chats: 0, messages_in: 0, messages_out: 0, manual_share: 0,
          tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
          stages: Object.fromEntries(DEAL_STAGES.map((st) => [st.id, 0])),
        },
      ),
    [rows],
  );

  const toggle = (id) =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!rows?.length) {
    return (
      <section className={p.card}>
        <h3 className={p.cardTitle}>По менеджерам</h3>
        <p className={s.muted}>За период работы не было</p>
      </section>
    );
  }

  return (
    <section className={p.card}>
      <h3 className={p.cardTitle}>По менеджерам</h3>
      <p className={s.hint}>Нажмите на строку — раскроются дни. Заголовок столбца сортирует таблицу.</p>
      <div className={s.tableWrap}>
        <table className={`${s.table} ${p.managers}`}>
          <thead>
            <tr>
              <th>Менеджер</th>
              {COLUMNS.map((c) => (
                <th
                  key={c.id}
                  title={c.hint}
                  className={`${p.sortable} ${sort === c.id ? p.sorted : ''}`}
                  onClick={() => setSort(c.id)}
                >
                  {c.title}
                  {sort === c.id && <span className={p.caret}> ▾</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const id = r.manager_id ?? 'none';
              const shown = open.has(id);
              return [
                <tr key={id} className={p.rowClickable} onClick={() => toggle(id)} data-testid={`manager-row-${id}`}>
                  <td>
                    <span className={p.caret} aria-hidden="true">{shown ? '▾' : '▸'}</span>
                    {r.username}
                  </td>
                  <Cells row={r} share={total.cost_usd ? r.cost_usd / total.cost_usd : null} />
                </tr>,
                ...(shown
                  ? r.days.map((d) => (
                      <tr key={`${id}-${d.day}`} className={p.dayRow} data-testid={`manager-day-${id}-${d.day}`}>
                        <td className={p.dayName}>{shortDay(d.day)}</td>
                        <Cells row={d} share={r.cost_usd ? d.cost_usd / r.cost_usd : null} />
                      </tr>
                    ))
                  : []),
                shown && !r.days.length && (
                  <tr key={`${id}-empty`} className={p.dayRow} data-testid={`manager-day-${id}-none`}>
                    <td className={p.dayName}>—</td>
                    <td colSpan={COLUMNS.length} className={s.muted}>Дней с работой нет</td>
                  </tr>
                ),
              ];
            })}
            <tr className={p.totalRow}>
              <td>Итого</td>
              <Cells row={total} share={null} />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
