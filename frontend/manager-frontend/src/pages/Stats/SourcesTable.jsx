import s from '../../styles/AdminPage.module.scss';
import p from './Stats.module.scss';
import { TRAFFIC_SOURCES } from '../../utils/trafficSource';
import { money } from '../../utils/money';

const num = (x) => (x ? x.toLocaleString('ru-RU') : null);
const cell = (x) => num(x) ?? <span className={s.muted}>—</span>;

export const LEAD_STATUS_LABELS = {
  pending: 'В базе',
  queued: 'В очереди',
  assigned: 'Найден',
  contacted: 'Написали',
  replied: 'Ответил',
  dead: 'Недоступен',
};

/** Деньги или прочерк; perN — доля на одного (лида, ответившего…). */
const usdCell = (x, perN) =>
  perN === undefined
    ? (x ? money(x) : <span className={s.muted}>—</span>)
    : (x && perN ? money(x / perN) : <span className={s.muted}>—</span>);

const SOURCE_COLUMNS = [...TRAFFIC_SOURCES, { id: 'none', label: 'Не отмечен' }];

/** Статусы до первого сообщения (в базе, в очереди, найден) в таблице не показываем. */
const HIDDEN_STATUSES = new Set(['pending', 'queued', 'assigned']);

/**
 * Лиды по источнику трафика: строки — регионы (админ) или источники (хед),
 * столбцы — сколько лидов, в каких статусах и до каких этапов дошли.
 * showSources — раскладка строки по источникам, когда фильтр «все».
 */
export default function SourcesTable({ data, rows, rowTitle, ariaLabel, showSources = false, empty = 'За период лидов не было' }) {
  const statuses = data.statuses.filter((st) => !HIDDEN_STATUSES.has(st));
  const stages = data.stages;
  // Расход приходит только админу: у хеда этих колонок нет.
  const withCost = Boolean(data.with_cost);
  return (
    <div className={s.tableWrap}>
      <table className={s.table} aria-label={ariaLabel} data-testid="sources-table">
        <thead>
          <tr>
            <th scope="col">{rowTitle}</th>
            <th scope="col" className={p.numCell}>Лидов</th>
            {showSources && SOURCE_COLUMNS.map((x) => <th key={x.id} scope="col" className={p.numCell}>{x.label}</th>)}
            {statuses.map((st) => <th key={st} scope="col" className={p.numCell}>{LEAD_STATUS_LABELS[st] ?? st}</th>)}
            {stages.map((st) => <th key={st.id} scope="col" className={p.numCell}>{st.label}</th>)}
            {withCost && <th scope="col" className={p.numCell} title="Расход модели на диалоги этих лидов за всё время">Расход</th>}
            {withCost && <th scope="col" className={p.numCell} title="Расход, делённый на число лидов">На лид</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={2 + (showSources ? SOURCE_COLUMNS.length : 0) + statuses.length + stages.length + (withCost ? 2 : 0)} className={s.empty}>{empty}</td></tr>
          )}
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.title}</td>
              <td className={p.numCell}><b>{cell(r.leads)}</b></td>
              {showSources && SOURCE_COLUMNS.map((x) => <td key={x.id} className={p.numCell}>{cell(r.by_source?.[x.id])}</td>)}
              {statuses.map((st) => <td key={st} className={p.numCell}>{cell(r.statuses?.[st])}</td>)}
              {stages.map((st) => <td key={st.id} className={p.numCell}>{cell(r.stages?.[st.id])}</td>)}
              {withCost && <td className={p.numCell}>{usdCell(r.cost_usd)}</td>}
              {withCost && <td className={p.numCell}>{usdCell(r.cost_usd, r.leads)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Вкладка админа: фильтр по источнику, строки — регионы и итог. */
export function SourcesByRegion({ data, source, onSource }) {
  const rows = [
    ...data.regions.map((r) => ({ ...r, key: r.region, title: r.region === '—' ? 'Без региона' : `Регион ${r.region}` })),
    ...(data.regions.length > 1 ? [{ ...data.total, key: 'total', title: 'Итого' }] : []),
  ];
  return (
    <div className={p.managers}>
      <div className={s.actions} style={{ alignItems: 'center', marginBottom: 8 }}>
        <label className={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          Источник
          <select className={s.select} aria-label="Источник трафика" value={source} onChange={(e) => onSource(e.target.value)}>
            <option value="">Все</option>
            {SOURCE_COLUMNS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
      </div>
      <p className={s.hint}>
        Лиды, добавленные за период. Регион — регион менеджера лида. Статусы — где лид сейчас; этапы — до каких этапов
        сделки дошёл его диалог. «Не отмечен» — лиды, добавленные до появления источника.
      </p>
      {data.with_cost && <SourceCosts data={data} />}
      <SourcesTable data={data} rows={rows} rowTitle="Регион" ariaLabel="Лиды по регионам" showSources={!source} />
    </div>
  );
}

/**
 * Стоимость по источникам: сколько ушло на модель в диалогах лидов каждого
 * источника и сколько это на лида, на ответившего и на дошедшего до «Лида».
 */
function SourceCosts({ data }) {
  const rows = [
    ...data.by_source.map((r) => ({ ...r, key: r.source, title: r.label })),
    ...(data.by_source.length > 1 ? [{ ...data.total, key: 'total', title: 'Итого' }] : []),
  ];
  return (
    <>
      <h3 className={s.title} style={{ fontSize: 15, margin: '8px 0 8px' }}>Стоимость по источникам</h3>
      <div className={s.tableWrap} style={{ marginBottom: 16 }}>
        <table className={s.table} aria-label="Стоимость по источникам" data-testid="source-costs">
          <thead>
            <tr>
              <th scope="col">Источник</th>
              <th scope="col" className={p.numCell}>Лидов</th>
              <th scope="col" className={p.numCell}>Ответили</th>
              <th scope="col" className={p.numCell}>Дошли до «Лида»</th>
              <th scope="col" className={p.numCell} title="Расход модели на диалоги этих лидов за всё время">Расход</th>
              <th scope="col" className={p.numCell}>На лид</th>
              <th scope="col" className={p.numCell}>На ответившего</th>
              <th scope="col" className={p.numCell}>На «Лид»</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className={s.empty}>За период лидов не было</td></tr>}
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.key === 'total' ? <b>{r.title}</b> : r.title}</td>
                <td className={p.numCell}><b>{cell(r.leads)}</b></td>
                <td className={p.numCell}>{cell(r.statuses?.replied)}</td>
                <td className={p.numCell}>{cell(r.stages?.lead)}</td>
                <td className={p.numCell}>{usdCell(r.cost_usd)}</td>
                <td className={p.numCell}>{usdCell(r.cost_usd, r.leads)}</td>
                <td className={p.numCell}>{usdCell(r.cost_usd, r.statuses?.replied)}</td>
                <td className={p.numCell}>{usdCell(r.cost_usd, r.stages?.lead)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
