import s from '../../styles/AdminPage.module.scss';
import p from './Stats.module.scss';
import { money } from '../../utils/money';

/** Сколько в среднем стоит диалог к моменту, когда ему ставят этап. */
export default function StageCosts({ data }) {
  const rows = data?.stages ?? [];
  return (
    <>
      <h3 className={s.title} style={{ fontSize: 15, margin: '24px 0 4px' }}>Цена диалога до этапа</h3>
      <p className={s.muted} style={{ margin: '0 0 8px', fontSize: 12 }}>
        Расход модели на диалог от начала до момента, когда ему поставили этап. Считаются диалоги, дошедшие до этапа за период.
      </p>
      <div className={s.tableWrap}>
        <table className={s.table} aria-label="Цена диалога до этапа" data-testid="stage-costs">
          <thead>
            <tr>
              <th scope="col">Этап</th>
              <th scope="col" className={p.numCell}>Дошли</th>
              <th scope="col" className={p.numCell}>Средняя цена</th>
              <th scope="col" className={p.numCell} title="Половина диалогов дешевле, половина дороже">Медиана</th>
              <th scope="col" className={p.numCell}>Всего</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stage}>
                <td>{r.label}</td>
                <td className={p.numCell}>{r.chats ? r.chats.toLocaleString('ru-RU') : <span className={s.muted}>—</span>}</td>
                <td className={p.numCell}>{r.avg_usd == null ? <span className={s.muted}>—</span> : money(r.avg_usd)}</td>
                <td className={p.numCell}>{r.median_usd == null ? <span className={s.muted}>—</span> : money(r.median_usd)}</td>
                <td className={p.numCell}>{r.chats ? money(r.total_usd) : <span className={s.muted}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
