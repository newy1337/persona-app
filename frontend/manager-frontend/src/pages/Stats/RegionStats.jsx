import { useEffect, useState } from 'react';
import { getRegionStats } from '../../api/regionStats';
import DateRangePicker, { mskToday, addDays } from '../../components/DateRangePicker/DateRangePicker';
import ManagersTable from './ManagersTable';
import StagesTable from './StagesTable';
import ColdTable from './ColdTable';
import SourcesTable from './SourcesTable';
import AccountsStats from './AccountsStats';
import TableSkeleton from '../../components/TableSkeleton/TableSkeleton';
import s from '../../styles/AdminPage.module.scss';
import p from './Stats.module.scss';

const money = (x) => (x >= 1 ? `$${x.toFixed(2)}` : `$${(x ?? 0).toFixed(4)}`);
const num = (x) => (x ?? 0).toLocaleString('ru-RU');
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

function Kpi({ title, value, hint }) {
  return (
    <div className={p.kpi}>
      <span className={p.kpiTitle}>{title}</span>
      <span className={p.kpiValue}>{value}</span>
      {hint && <span className={p.kpiHint}>{hint}</span>}
    </div>
  );
}

/** Номера и расход по типу трафика личности: холодка, hot, не указан. */
export function TrafficTable({ rows }) {
  const shown = rows.filter((r) => r.leads_uploaded || r.cost_usd);
  return (
    <div className={p.managers}>
      <p className={s.hint}>
        Тип трафика личности (Холодка / Hot) задаётся у личности — это не источник номера. Номера — добавленные за период лиды менеджеров региона, расход — вызовы
        моделей в их диалогах.
      </p>
      <div className={s.tableWrap}>
        <table className={s.table} aria-label="По типу трафика" data-testid="traffic-table">
          <thead>
            <tr>
              <th scope="col">Трафик</th>
              <th scope="col" className={p.numCell}>Номеров</th>
              <th scope="col" className={p.numCell}>Ответили</th>
              <th scope="col" className={p.numCell}>Расход</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={4} className={s.empty}>За период ничего не было</td></tr>
            )}
            {shown.map((r) => (
              <tr key={r.type}>
                <td>{r.label}</td>
                <td className={p.numCell}>{num(r.leads_uploaded)}</td>
                <td className={p.numCell}>
                  {num(r.leads_replied)}
                  <span className={s.muted}> · {pct(r.leads_replied, r.leads_uploaded)}</span>
                </td>
                <td className={p.numCell}>{money(r.cost_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TABS = [['managers', 'По менеджерам'], ['stages', 'Этапы'], ['cold', 'Холодка'], ['sources', 'По источнику'], ['traffic', 'По трафику'], ['accounts', 'Аккаунты']];

export default function RegionStats() {
  const [range, setRange] = useState(() => ({ from: addDays(mskToday(), -29), to: mskToday() }));
  const [region, setRegion] = useState('');
  const [tab, setTab] = useState('managers');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getRegionStats({ from: range.from, to: range.to, region })
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive) setError(e.detail || e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [range, region]);

  const t = data?.total;
  return (
    <>
      <div className={s.head}>
        <div>
          <h2 className={s.title}>Статистика региона</h2>
          <span className={s.muted}>{data?.region ? `регион ${data.region}` : loading ? 'загружаем…' : ''}</span>
        </div>
        <div className={s.actions}>
          {data?.regions?.length > 0 && (
            <select className={s.select} aria-label="Регион" value={data.region ?? ''} onChange={(e) => setRegion(e.target.value)} style={{ maxWidth: 160 }}>
              {data.regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          )}
          <DateRangePicker from={range.from} to={range.to} firstDay={null} onChange={setRange} />
        </div>
      </div>

      {error && <p className={s.error} role="alert">{error}</p>}

      {t && (
        <div className={p.kpis} data-testid="region-kpis">
          <Kpi title="Расход" value={money(t.cost_usd)} hint="вызовы моделей в диалогах региона" />
          <Kpi title="Номеров" value={num(t.leads_uploaded)} hint={`валидных ${num(t.leads_valid)} · ${pct(t.leads_valid, t.leads_uploaded)}`} />
          <Kpi title="Ответили" value={num(t.leads_replied)} hint={`${pct(t.leads_replied, t.leads_valid)} от валидных`} />
          <Kpi title="Переписок" value={num(t.active_chats)} hint={`сообщений ${num(t.messages_out)} ↑ / ${num(t.messages_in)} ↓`} />
        </div>
      )}

      <div className={p.tabs} role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`${p.tab} ${tab === id ? p.tabActive : ''}`}
            data-testid={`region-tab-${id}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {!data ? (
        <TableSkeleton rows={5} label="Считаю статистику региона…" />
      ) : tab === 'stages' ? (
        <StagesTable data={data.stages} />
      ) : tab === 'cold' ? (
        <ColdTable data={data.cold} />
      ) : tab === 'accounts' ? (
        <AccountsStats data={data.accounts} />
      ) : tab === 'sources' ? (
        <div className={p.managers}>
          <p className={s.hint}>
            Откуда номера: базовик, горячий или холодный лидген. Лиды, добавленные за период менеджерам региона, — в каких
            они статусах и до каких этапов дошли. «Не отмечен» — добавленные до появления источника.
          </p>
          <SourcesTable data={data.sources} ariaLabel="Лиды по источнику" rowTitle="Источник"
            rows={data.sources.by_source.map((r) => ({ ...r, key: r.source, title: r.label }))} />
        </div>
      ) : tab === 'traffic' ? (
        <TrafficTable rows={data.traffic} />
      ) : (
        <ManagersTable rows={data.managers} empty="За период работы в регионе не было" />
      )}
    </>
  );
}
