import s from '../../styles/AdminPage.module.scss';
import p from './Stats.module.scss';

const cell = (x) => (x ? x.toLocaleString('ru-RU') : <span className={s.muted}>—</span>);
const ROLE = { head: 'Хед', teamlead: 'Тимлид' };

function Kpi({ title, value, hint }) {
  return (
    <div className={p.kpi}>
      <span className={p.kpiTitle}>{title}</span>
      <span className={p.kpiValue}>{value}</span>
      {hint && <span className={p.kpiHint}>{hint}</span>}
    </div>
  );
}

function Table({ rows, title, label, nameTitle, team = false }) {
  return (
    <>
      <h3 className={s.title} style={{ fontSize: 15, margin: '16px 0 8px' }}>{title}</h3>
      <div className={s.tableWrap}>
        <table className={s.table} aria-label={label} data-testid={team ? 'accounts-teams' : 'accounts-managers'}>
          <thead>
            <tr>
              <th scope="col">{nameTitle}</th>
              <th scope="col">Регион</th>
              <th scope="col" className={p.numCell}>Добавлено TG</th>
              <th scope="col" className={p.numCell}>Добавлено VK</th>
              <th scope="col" className={p.numCell}>Слетело TG</th>
              <th scope="col" className={p.numCell}>Слетело VK</th>
              <th scope="col" className={p.numCell} title="Сколько диалогов было на аккаунтах в момент слёта">Диалогов на слетевших</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className={s.empty}>За период ничего не добавляли и не теряли</td></tr>}
            {rows.map((r) => (
              <tr key={`${r.role ?? 'm'}-${r.manager_id ?? 'none'}`}>
                <td>
                  {r.username}
                  {team && <span className={s.muted}> · {ROLE[r.role] ?? r.role}{r.members ? `, ${r.members} в команде` : ''}</span>}
                </td>
                <td>{r.region_code ?? <span className={s.muted}>—</span>}</td>
                <td className={p.numCell}>{cell(r.tg_added)}</td>
                <td className={p.numCell}>{cell(r.vk_added)}</td>
                <td className={p.numCell}>{cell(r.tg_lost)}</td>
                <td className={p.numCell}>{cell(r.vk_lost)}</td>
                <td className={p.numCell}>{cell(r.lost_chats)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Аккаунты за период: добавлено и слетело (бан, сессия), по командам и менеджерам. */
export default function AccountsStats({ data }) {
  const t = data.total;
  const added = t.tg_added + t.vk_added;
  const lost = t.tg_lost + t.vk_lost;
  return (
    <div className={p.managers}>
      <div className={p.kpis} data-testid="accounts-kpis">
        <Kpi title="Добавлено" value={added.toLocaleString('ru-RU')} hint={`TG ${t.tg_added} · VK ${t.vk_added}`} />
        <Kpi title="Слетело" value={lost.toLocaleString('ru-RU')} hint={`TG ${t.tg_lost} · VK ${t.vk_lost}`} />
        <Kpi title="Диалогов на слетевших" value={t.lost_chats.toLocaleString('ru-RU')} hint="сколько было в момент слёта" />
      </div>
      <p className={s.hint}>
        «Слетело» — аккаунт забанили или завершили его сессию (повторный слёт того же аккаунта не считается). Менеджер —
        за кем аккаунт был в момент события. Аккаунты, удалённые до 3 ноября, в статистику не попали.
      </p>
      {data.teams.length > 0 && <Table rows={data.teams} title="По командам" label="Аккаунты по командам" nameTitle="Команда" team />}
      <Table rows={data.managers} title="По менеджерам" label="Аккаунты по менеджерам" nameTitle="Менеджер" />
    </div>
  );
}
