import { useMemo, useState } from 'react';
import s from '../../styles/AdminPage.module.scss';
import p from './Stats.module.scss';
import { DEAL_STAGES } from '../../data/dealStages';


const money = (x) => (x >= 1 ? `$${x.toFixed(2)}` : `$${(x ?? 0).toFixed(4)}`);
const num = (x) => (x ?? 0).toLocaleString('ru-RU');
const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
const shortDay = (d) => d.slice(5).split('-').reverse().join('.');

const COLUMNS = [
  { id: 'cost_usd', title: 'Расход', hint: 'Деньги за вызовы моделей' },
  { id: 'leads_valid', title: 'Номеров', hint: 'Нашлись в Telegram из загруженных за период' },
  { id: 'leads_replied', title: 'Ответили', hint: 'Из валидных ответили на первое сообщение' },
  { id: 'active_chats', title: 'Переписок', hint: 'Диалоги, где собеседник писал в этот период' },
  { id: 'active_dialogs', title: 'Активных', hint: 'Диалоги, ставшие активными: собеседник прислал 6-е сообщение после нашего первого (как в холодке). По дням — в день 6-го сообщения' },
  { id: 'messages_out', title: 'Сообщений', hint: 'Исходящие и входящие' },
  ...DEAL_STAGES.map((st) => ({ id: `stage:${st.id}`, title: st.label, hint: `Сколько чатов перешло в этап «${st.label}» за период` })),
];

const SUM_KEYS = ['cost_usd', 'calls', 'leads_uploaded', 'leads_valid', 'leads_replied', 'active_chats', 'active_dialogs', 'messages_in', 'messages_out'];

const metric = (r, key) => (key.startsWith('stage:') ? r.stages?.[key.slice(6)] ?? 0 : r[key] ?? 0);

/** Сумма строк: итог таблицы и группа «Без команды». */
function sumRows(rows) {
  const acc = {
    cost_usd: 0, calls: 0, leads_uploaded: 0, leads_valid: 0, leads_replied: 0,
    active_chats: 0, active_dialogs: 0, messages_in: 0, messages_out: 0, manual_share: 0,
    stages: Object.fromEntries(DEAL_STAGES.map((st) => [st.id, 0])),
  };
  let manual = 0;
  for (const r of rows) {
    for (const key of SUM_KEYS) acc[key] += r[key] ?? 0;
    for (const st of DEAL_STAGES) acc.stages[st.id] += r.stages?.[st.id] ?? 0;
    manual += (r.manual_share ?? 0) * (r.messages_out ?? 0);
  }
  acc.manual_share = acc.messages_out ? manual / acc.messages_out : 0;
  return acc;
}

const dash = <span className={s.muted}>—</span>;

function Cells({ row, share }) {
  return (
    <>
      <td className={p.numCell}>
        {money(row.cost_usd)}
        {share !== null && <span className={s.muted}> · {pct(share)}</span>}
      </td>
      <td className={p.numCell} title={row.leads_uploaded ? `из ${num(row.leads_uploaded)} загруженных` : undefined}>
        {row.leads_uploaded ? (
          <>
            {num(row.leads_valid)}
            <span className={s.muted}> · {pct(row.leads_valid / row.leads_uploaded)}</span>
          </>
        ) : dash}
      </td>
      <td className={p.numCell}>
        {row.leads_valid ? (
          <>
            {num(row.leads_replied)}
            <span className={s.muted}> · {pct(row.leads_replied / row.leads_valid)}</span>
          </>
        ) : dash}
      </td>
      <td className={p.numCell}>{num(row.active_chats)}</td>
      <td className={p.numCell} data-testid="active-dialogs">{row.active_dialogs ? num(row.active_dialogs) : dash}</td>
      <td className={p.numCell}>
        {num(row.messages_out)} ↑<span className={s.muted}> / {num(row.messages_in)} ↓</span>
        {row.manual_share > 0 && <span className={s.muted}> · руками {pct(row.manual_share)}</span>}
      </td>
      {DEAL_STAGES.map((st) => (
        <td key={st.id} className={p.numCell} data-testid={`stage-${st.id}`}>
          {row.stages?.[st.id] ? num(row.stages[st.id]) : dash}
        </td>
      ))}
    </>
  );
}

const ROLE_TITLE = { head: 'хед', teamlead: 'тимлид' };
const people = (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'человек' : 'чел.'}`;

/**
 * Дерево команд: хед → его тимлиды и прямые менеджеры, тимлид → менеджеры.
 * Тимлид, у которого есть хед, отдельной строкой наверху не повторяется.
 * Менеджеры вне команд — в группе «Без команды».
 */
function buildTree(managers, teams) {
  const teamById = new Map(teams.map((t) => [t.manager_id, t]));
  const managerById = new Map(managers.filter((m) => m.manager_id !== null).map((m) => [m.manager_id, m]));
  const inTeam = new Set();
  const nodeOfTeam = (t, seen) => {
    seen.add(t.manager_id);
    const children = [];
    const own = managerById.get(t.manager_id);
    if (own) {
      inTeam.add(t.manager_id);
      children.push({ kind: 'manager', key: `m${t.manager_id}`, row: { ...own, username: `${own.username} — лично` } });
    }
    for (const id of t.direct ?? []) {
      if (seen.has(id)) continue;
      if (teamById.has(id)) children.push(nodeOfTeam(teamById.get(id), seen));
      else if (managerById.has(id)) {
        inTeam.add(id);
        children.push({ kind: 'manager', key: `m${id}`, row: managerById.get(id) });
      }
    }
    return { kind: 'team', key: `t${t.manager_id}`, row: t, children };
  };
  const roots = teams
    .filter((t) => t.lead_id == null || !teamById.has(t.lead_id))
    .map((t) => nodeOfTeam(t, new Set()));
  const loose = managers.filter((m) => m.manager_id === null || !inTeam.has(m.manager_id));
  if (loose.length)
    roots.push({
      kind: 'team',
      key: 'loose',
      row: { ...sumRows(loose), username: 'Без команды', members: loose.length, loose: true },
      children: loose.map((m) => ({ kind: 'manager', key: `m${m.manager_id ?? 'none'}`, row: m })),
    });
  return roots;
}

export default function ManagersTable({
  rows,
  teams = null,
  title = 'По менеджерам',
  hint = 'Нажмите на строку — раскроются дни. Заголовок столбца сортирует таблицу.',
  empty = 'За период работы не было',
}) {
  const [open, setOpen] = useState(() => new Set());
  const [sort, setSort] = useState('cost_usd');
  const tree = Boolean(teams?.length);

  const total = useMemo(() => sumRows(rows ?? []), [rows]);
  const nodes = useMemo(() => {
    const list = tree
      ? buildTree(rows ?? [], teams)
      : (rows ?? []).map((m) => ({ kind: 'manager', key: `m${m.manager_id ?? 'none'}`, row: m }));
    const order = (items) =>
      [...items]
        .sort((a, b) => (a.row.loose ? 1 : 0) - (b.row.loose ? 1 : 0) || metric(b.row, sort) - metric(a.row, sort))
        .map((n) => (n.children ? { ...n, children: order(n.children) } : n));
    return order(list);
  }, [rows, teams, tree, sort]);

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
        <h3 className={p.cardTitle}>{title}</h3>
        <p className={s.muted}>{empty}</p>
      </section>
    );
  }

  const renderNode = (node, depth) => {
    const r = node.row;
    const shown = open.has(node.key);
    const indent = { paddingLeft: 12 + depth * 20 };
    if (node.kind === 'team') {
      const id = r.loose ? 'loose' : r.manager_id;
      return [
        <tr key={node.key} className={`${p.rowClickable} ${p.teamRow}`} onClick={() => toggle(node.key)} data-testid={`team-row-${id}`}>
          <td style={indent}>
            <span className={p.caret} aria-hidden="true">{shown ? '▾' : '▸'}</span>
            <b>{r.username}</b>
            <div className={s.muted} data-testid={`team-meta-${id}`}>
              {r.loose
                ? `${people(r.members ?? 0)}`
                : [ROLE_TITLE[r.role] ?? r.role, r.region_code ? `регион ${r.region_code}` : null, `команда: ${people(r.members ?? 0)}`].filter(Boolean).join(' · ')}
            </div>
          </td>
          <Cells row={r} share={total.cost_usd ? r.cost_usd / total.cost_usd : null} />
        </tr>,
        ...(shown ? node.children.flatMap((child) => renderNode(child, depth + 1)) : []),
        shown && !node.children.length && (
          <tr key={`${node.key}-empty`} className={p.dayRow}>
            <td style={{ paddingLeft: 12 + (depth + 1) * 20 }} className={p.dayName}>—</td>
            <td colSpan={COLUMNS.length} className={s.muted}>За период у команды не было работы</td>
          </tr>
        ),
      ];
    }
    const id = r.manager_id ?? 'none';
    return [
      <tr key={node.key} className={p.rowClickable} onClick={() => toggle(node.key)} data-testid={`manager-row-${id}`}>
        <td style={indent}>
          <span className={p.caret} aria-hidden="true">{shown ? '▾' : '▸'}</span>
          {r.username}
        </td>
        <Cells row={r} share={total.cost_usd ? r.cost_usd / total.cost_usd : null} />
      </tr>,
      ...(shown
        ? (r.days ?? []).map((d) => (
            <tr key={`${node.key}-${d.day}`} className={p.dayRow} data-testid={`manager-day-${id}-${d.day}`}>
              <td className={p.dayName} style={{ paddingLeft: 12 + (depth + 1) * 20 }}>{shortDay(d.day)}</td>
              <Cells row={d} share={r.cost_usd ? d.cost_usd / r.cost_usd : null} />
            </tr>
          ))
        : []),
      shown && !(r.days ?? []).length && (
        <tr key={`${node.key}-empty`} className={p.dayRow} data-testid={`manager-day-${id}-none`}>
          <td className={p.dayName} style={{ paddingLeft: 12 + (depth + 1) * 20 }}>—</td>
          <td colSpan={COLUMNS.length} className={s.muted}>Дней с работой нет</td>
        </tr>
      ),
    ];
  };

  return (
    <section className={p.card}>
      <h3 className={p.cardTitle}>{title}</h3>
      {hint && <p className={s.hint}>{hint}</p>}
      <div className={s.tableWrap}>
        <table className={`${s.table} ${p.managers}`}>
          <thead>
            <tr>
              <th>{tree ? 'Команда / менеджер' : 'Менеджер'}</th>
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
            {nodes.flatMap((n) => renderNode(n, 0))}
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
