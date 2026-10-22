import s from '../../styles/AdminPage.module.scss';
import p from './Stats.module.scss';

const num = (x) => (x ?? 0).toLocaleString('ru-RU');
const share = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

const ROLE = { manager: 'менеджер', teamlead: 'тимлид', head: 'хед' };

function Kpi({ title, value, hint }) {
  return (
    <div className={p.kpi}>
      <span className={p.kpiTitle}>{title}</span>
      <span className={p.kpiValue}>{value}</span>
      {hint && <span className={p.kpiHint}>{hint}</span>}
    </div>
  );
}

function Cells({ row }) {
  return (
    <>
      <td className={p.numCell}>{num(row.received)}</td>
      <td className={p.numCell}>
        {num(row.written)} <span className={s.muted}>{share(row.written, row.received)}</span>
      </td>
      <td className={p.numCell}>
        {num(row.replied)} <span className={s.muted}>{share(row.replied, row.written)}</span>
      </td>
      <td className={p.numCell}>
        {num(row.active)} <span className={s.muted}>{share(row.active, row.replied)}</span>
      </td>
    </>
  );
}

export default function ColdTable({ data }) {
  const { totals: t, by_manager: rows, active_after: after } = data;
  return (
    <div className={p.managers}>
      <div className={p.kpis} data-testid="cold-kpis">
        <Kpi title="Получено лидов" value={num(t.received)} hint="холодка за период" />
        <Kpi title="Написали" value={num(t.written)} hint={`${share(t.written, t.received)} от полученных`} />
        <Kpi title="Ответили" value={num(t.replied)} hint={`${share(t.replied, t.written)} от написанных`} />
        <Kpi title="Активные диалоги" value={num(t.active)} hint={`${share(t.active, t.replied)} от ответивших`} />
      </div>
      <p className={s.hint}>
        Считаются холодные лиды, пришедшие за период, — что с ними стало к этому моменту. «Ответили» — лид
        написал хотя бы одно сообщение после нашего первого, «активные» — больше {after} его сообщений.
      </p>
      <div className={s.tableWrap}>
        <table className={s.table} aria-label="Холодка по менеджерам" data-testid="cold-table">
          <thead>
            <tr>
              <th scope="col">Менеджер</th>
              <th scope="col" className={p.numCell}>Получено</th>
              <th scope="col" className={p.numCell}>Написали</th>
              <th scope="col" className={p.numCell}>Ответили</th>
              <th scope="col" className={p.numCell}>Активные</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className={s.empty}>За период холодных лидов не было</td>
              </tr>
            )}
            {rows.map((m) => (
              <tr key={m.user_id ?? 'none'}>
                <td>
                  {m.username}
                  {(m.role || m.region_code) && (
                    <span className={s.muted}>
                      {' '}· {[ROLE[m.role] ?? m.role, m.region_code && `регион ${m.region_code}`].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </td>
                <Cells row={m} />
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr className={p.totalRow}>
                <td>Всего</td>
                <Cells row={t} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
