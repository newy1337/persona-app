import { useState } from 'react';
import s from '../../styles/AdminPage.module.scss';
import p from './Stats.module.scss';

const pctText = (x) => `${Number.isInteger(x) ? x : x.toFixed(1)}%`;

function Meter({ value }) {
  return (
    <span className={p.goalMeter} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <span className={p.goalMeterFill} style={{ width: `${Math.min(100, value)}%` }} />
    </span>
  );
}

/** Цели по личностям: вкладка на личность, в ней — в какой доле диалогов узнана каждая цель. */
export default function GoalsStats({ data }) {
  const rows = data.personas ?? [];
  const [picked, setPicked] = useState(null);
  if (!rows.length)
    return <p className={s.muted}>За период бот не начал ни одного диалога.</p>;
  const r = rows.find((x) => x.persona_id === picked) ?? rows[0];
  return (
    <>
      <div className={p.subTabs} role="tablist" aria-label="Личности">
        {rows.map((x) => (
          <button
            key={x.persona_id}
            type="button"
            role="tab"
            aria-selected={x.persona_id === r.persona_id}
            className={`${p.tab} ${x.persona_id === r.persona_id ? p.tabActive : ''}`}
            data-testid={`goals-tab-${x.persona_id}`}
            onClick={() => setPicked(x.persona_id)}
          >
            {x.name}
            <span className={s.muted}> · {x.chats.toLocaleString('ru-RU')}</span>
          </button>
        ))}
      </div>
      <section className={p.card} data-testid={`goals-${r.persona_id}`}>
        <h3 className={p.cardTitle}>
          {r.name}
          <span className={s.muted} style={{ fontWeight: 400 }}>
            {' '}· {r.chats.toLocaleString('ru-RU')} диалогов · узнано в среднем {pctText(r.percent)}
          </span>
        </h3>
        <div className={s.tableWrap}>
          <table className={s.table} aria-label={`Цели: ${r.name}`}>
            <thead>
              <tr>
                <th scope="col">Цель</th>
                <th scope="col" className={p.numCell}>Узнали</th>
                <th scope="col" className={p.numCell}>Доля диалогов</th>
                <th scope="col" style={{ width: '30%' }}></th>
              </tr>
            </thead>
            <tbody>
              {r.goals.length === 0 && <tr><td colSpan={4} className={s.empty}>У личности не заданы цели</td></tr>}
              {r.goals.map((g) => (
                <tr key={g.id}>
                  <td title={g.topic ?? undefined}>
                    {g.title}
                    {g.title !== g.id && <span className={s.muted}> · {g.id}</span>}
                  </td>
                  <td className={p.numCell}>{g.known.toLocaleString('ru-RU')}</td>
                  <td className={p.numCell}>{pctText(g.percent)}</td>
                  <td><Meter value={g.percent} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
