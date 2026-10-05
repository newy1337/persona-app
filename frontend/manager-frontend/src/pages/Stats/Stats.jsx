import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/Header/Header';
import { getUsage, getManagerUsage, getBalance, getDealStages } from '../../api/usage';
import DailyChart from './DailyChart';
import DateRangePicker, { mskToday, addDays } from '../../components/DateRangePicker/DateRangePicker';
import PricesEditor from './PricesEditor';
import ManagersTable from './ManagersTable';
import StagesTable from './StagesTable';
import Balance from './Balance';
import s from '../../styles/AdminPage.module.scss';
import p from './Stats.module.scss';

const money = (x) => (x >= 1 ? `$${x.toFixed(2)}` : `$${(x ?? 0).toFixed(4)}`);
const num = (x) => (x ?? 0).toLocaleString('ru-RU');
const kilo = (x) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)} млн` : x >= 1e3 ? `${(x / 1e3).toFixed(1)} тыс.` : String(x ?? 0));
const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;

const STAGE_LABEL = {
  judge_plan: 'Судья: разбор',
  judge_review: 'Судья: проверка',
  generator: 'Ответ',
  media_photo: 'Просмотр фото',
  media_reaction: 'Реакция',
};

function Kpi({ title, value, hint }) {
  return (
    <div className={p.kpi}>
      <span className={p.kpiTitle}>{title}</span>
      <span className={p.kpiValue}>{value}</span>
      {hint && <span className={p.kpiHint}>{hint}</span>}
    </div>
  );
}

function Split({ rows, label }) {
  const total = rows.reduce((n, r) => n + r.cost_usd, 0) || 1;
  return (
    <div className={p.split}>
      <div className={p.splitBar}>
        {rows.map((r, i) => (
          <span
            key={r.key}
            className={p.splitPart}
            style={{ width: `${(r.cost_usd / total) * 100}%`, background: `var(--split-${i % 5})` }}
            title={`${r.label}: ${money(r.cost_usd)}`}
          />
        ))}
      </div>
      <div className={p.splitLegend}>
        {rows.map((r, i) => (
          <span key={r.key}>
            <i className={p.swatch} style={{ background: `var(--split-${i % 5})` }} />
            {r.label} <span className={s.muted}>{money(r.cost_usd)} · {num(r.calls)}</span>
          </span>
        ))}
        {rows.length === 0 && <span className={s.muted}>{label}</span>}
      </div>
    </div>
  );
}

export default function Stats() {
  const navigate = useNavigate();
  const [range, setRange] = useState(() => ({ from: addDays(mskToday(), -29), to: mskToday() }));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [showPrices, setShowPrices] = useState(false);
  const [tab, setTab] = useState('overview');
  const [managers, setManagers] = useState(null);
  const [managersLoading, setManagersLoading] = useState(false);
  const [balance, setBalance] = useState(null);
  const [stages, setStages] = useState(null);

  const load = useCallback(() => {
    getUsage({ from: range.from, to: range.to })
      .then(setData)
      .catch((e) => setError(e.detail || e.message));
  }, [range]);

  useEffect(load, [load]);

  useEffect(() => {
    const pull = () => getBalance().then(setBalance).catch(() => setBalance(null));
    pull();
    const timer = setInterval(() => document.visibilityState === 'visible' && pull(), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (tab !== 'stages') return undefined;
    let alive = true;
    setStages(null);
    getDealStages({ from: range.from, to: range.to })
      .then((r) => alive && setStages(r))
      .catch((e) => alive && setError(e.detail || e.message));
    return () => {
      alive = false;
    };
  }, [tab, range]);

  useEffect(() => {
    if (tab !== 'managers') return undefined;
    let alive = true;
    setManagersLoading(true);
    getManagerUsage({ from: range.from, to: range.to })
      .then((r) => alive && setManagers(r.by_manager ?? []))
      .catch((e) => alive && setError(e.detail || e.message))
      .finally(() => alive && setManagersLoading(false));
    return () => {
      alive = false;
    };
  }, [tab, range]);

  const t = data?.totals;

  return (
    <div className="app">
      <Header />
      <main className="main">
        <div className="container">
          <div className={s.head}>
            <h2 className={s.title}>Статистика</h2>
            <div className={s.actions}>
              <DateRangePicker
                from={range.from}
                to={range.to}
                firstDay={data?.range?.first_day ?? null}
                onChange={setRange}
              />
              <button className={s.btn} onClick={() => setShowPrices((v) => !v)}>
                {showPrices ? 'Скрыть цены' : 'Цены моделей'}
              </button>
            </div>
          </div>

          <Balance data={balance} />

          {error && <p className={s.error}>{error}</p>}
          {data?.prices?.is_default && (
            <p className={s.hint}>
              Деньги посчитаны по ценам из кода — если прайс-лист изменился, поправьте его в «Ценах моделей».
            </p>
          )}
          {data?.unpriced_models?.length > 0 && (
            <p className={s.error}>
              Без цены в таблице: {data.unpriced_models.join(', ')} — их вызовы считаются по нулю.
            </p>
          )}

          {showPrices && <PricesEditor onChanged={load} onError={setError} />}

          <div className={p.tabs} role="tablist">
            {[['overview', 'Обзор'], ['managers', 'По менеджерам'], ['stages', 'Этапы']].map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={`${p.tab} ${tab === id ? p.tabActive : ''}`}
                data-testid={`stats-tab-${id}`}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'stages' ? (
            stages ? <StagesTable data={stages} /> : <p className={s.empty}>Считаю этапы…</p>
          ) : tab === 'managers' ? (
            managersLoading || !managers ? (
              <p className={s.empty} data-testid="managers-loading">Считаю по менеджерам…</p>
            ) : (
              <ManagersTable rows={managers} />
            )
          ) : !data ? (
            <p className={s.empty}>Загружаю…</p>
          ) : (
            <>
              <div className={p.kpis}>
                <Kpi title="Расход" value={money(t.cost_usd)} hint={`${num(t.calls)} вызовов модели`} />
                <Kpi
                  title="За ход клиента"
                  value={t.messages_in ? money(t.cost_usd / t.messages_in) : '—'}
                  hint={`${num(t.messages_in)} входящих`}
                />
                <Kpi title="Из кеша" value={pct(t.cache_hit_rate)} hint={`${kilo(t.tokens.cache_read)} токенов дешёвых`} />
                <Kpi
                  title="Токенов"
                  value={kilo(t.tokens.input + t.tokens.cache_read + t.tokens.cache_write)}
                  hint={`выход ${kilo(t.tokens.output)}`}
                />
                <Kpi title="Сообщений" value={`${num(t.messages_in)} ↓ / ${num(t.messages_out)} ↑`} hint={`руками ${pct(t.manual_share)}`} />
                <Kpi title="Чатов" value={num(t.chats)} hint={t.avg_latency_ms ? `ответ модели ~${(t.avg_latency_ms / 1000).toFixed(1)} с` : null} />
              </div>

              <DailyChart days={data.by_day} />

              <div className={p.columns}>
                <section className={p.card}>
                  <h3 className={p.cardTitle}>Куда уходят деньги</h3>
                  <Split
                    label="вызовов ещё не было"
                    rows={data.by_stage.map((r) => ({ key: r.stage, label: STAGE_LABEL[r.stage] ?? r.stage, cost_usd: r.cost_usd, calls: r.calls }))}
                  />
                  {data.by_persona.length > 1 && (
                    <>
                      <h3 className={p.cardTitle} style={{ marginTop: 18 }}>По личностям</h3>
                      <Split
                        label="—"
                        rows={data.by_persona.map((r) => ({ key: r.persona_id, label: r.persona_id, cost_usd: r.cost_usd, calls: r.calls }))}
                      />
                    </>
                  )}
                </section>

                <section className={p.card}>
                  <h3 className={p.cardTitle}>Модели</h3>
                  <div className={s.tableWrap}>
                    <table className={s.table}>
                      <thead>
                        <tr><th>Модель</th><th>Вызовов</th><th>Вход</th><th>Выход</th><th>Расход</th><th>Ответ</th></tr>
                      </thead>
                      <tbody>
                        {data.by_model.map((m) => (
                          <tr key={m.model}>
                            <td className={s.mono}>
                              {m.model}
                              {!m.priced && <span className={s.error}> без цены</span>}
                            </td>
                            <td>{num(m.calls)}</td>
                            <td className={s.muted}>{kilo(m.tokens.input + m.tokens.cache_read + m.tokens.cache_write)}</td>
                            <td className={s.muted}>{kilo(m.tokens.output)}</td>
                            <td>{money(m.cost_usd)}</td>
                            <td className={s.muted}>{m.avg_latency_ms ? `${(m.avg_latency_ms / 1000).toFixed(1)} с` : '—'}</td>
                          </tr>
                        ))}
                        {data.by_model.length === 0 && (
                          <tr><td colSpan={6} className={s.muted}>За период вызовов не было</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              <section className={p.card}>
                <h3 className={p.cardTitle}>Самые дорогие диалоги</h3>
                <div className={s.tableWrap}>
                  <table className={s.table}>
                    <thead>
                      <tr><th>Чат</th><th>Вызовов</th><th>Токенов</th><th>Расход</th><th></th></tr>
                    </thead>
                    <tbody>
                      {data.top_chats.map((c) => (
                        <tr key={c.chat_id}>
                          <td className={s.mono}>{c.chat_id}</td>
                          <td>{num(c.calls)}</td>
                          <td className={s.muted}>{kilo(c.tokens.input + c.tokens.cache_read + c.tokens.cache_write + c.tokens.output)}</td>
                          <td>{money(c.cost_usd)}</td>
                          <td><button className={s.btnSm} onClick={() => navigate(`/conversation/${c.chat_id}`)}>Открыть</button></td>
                        </tr>
                      ))}
                      {data.top_chats.length === 0 && (
                        <tr><td colSpan={5} className={s.muted}>Пока пусто</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
