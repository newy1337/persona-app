import s from '../../styles/AdminPage.module.scss';
import p from './Stats.module.scss';

const shortDay = (d) => d.slice(5).split('-').reverse().join('.');
const num = (x) => (x ?? 0).toLocaleString('ru-RU');

export default function StagesTable({ data }) {
  const { stages, days, totals, reached } = data;
  return (
    <div className={p.managers}>
      <p className={s.hint}>
        Чат засчитывается в этап один раз — в день, когда впервые до него дошёл; пройденные
        этапы остаются, откат назад ничего не снимает. Архив отдельно: по дням — сколько чатов
        отправили в архив, «всего» — сколько чатов в архиве сейчас.
      </p>
      <div className={s.tableWrap}>
        <table className={s.table} aria-label="Этапы сделки по дням" data-testid="stages-table">
          <thead>
            <tr>
              <th scope="col">День</th>
              {stages.map((st) => (
                <th key={st.id} scope="col" className={p.numCell}>{st.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.length === 0 && (
              <tr>
                <td colSpan={stages.length + 1} className={s.empty}>За период этапы не менялись</td>
              </tr>
            )}
            {days.map((d) => (
              <tr key={d.day} className={p.dayRow}>
                <td className={p.dayName}>{shortDay(d.day)}</td>
                {stages.map((st) => (
                  <td key={st.id} className={p.numCell}>
                    {d.counts[st.id] ? num(d.counts[st.id]) : <span className={s.muted}>—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={p.totalRow}>
              <td>За период</td>
              {stages.map((st) => (
                <td key={st.id} className={p.numCell}>{num(totals[st.id])}</td>
              ))}
            </tr>
            <tr className={p.totalRow}>
              <td>Всего</td>
              {stages.map((st) => (
                <td key={st.id} className={p.numCell}>{num(reached[st.id])}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
