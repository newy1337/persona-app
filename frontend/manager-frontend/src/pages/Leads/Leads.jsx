import { CreateLeadForm, LeadsTable } from '../../ui/ManagerRegion';
import { PanelUX } from '../../ui/PanelUX';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Header from '../../components/Header/Header';
import {
  deleteLead,
  getLeadPersonas,
  getLeads,
  getOutreachStatus,
  importLeads,
  startOutreach,
  stopOutreach,
  updateLead,
  writeFromAnother,
} from '../../api/leads';
import s from '../../styles/AdminPage.module.scss';

const STATUS = [
  { key: '', label: 'Все' },
  { key: 'pending', label: 'В базе' },
  { key: 'queued', label: 'В очереди' },
  { key: 'assigned', label: 'Найден' },
  { key: 'contacted', label: 'Написали' },
  { key: 'replied', label: 'Ответил' },
  { key: 'dead', label: 'Недоступен' },
];
const LABEL = Object.fromEntries(STATUS.map((x) => [x.key, x.label]));
const BADGE = {
  pending: s.badgeRetired,
  queued: s.badgeUnauthorized,
  assigned: s.badgeManager,
  contacted: s.badgePaused,
  replied: s.badgeActive,
  dead: s.badgeBanned,
};

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function PersonaSelect({ personas, value, onChange, className }) {
  return (
    <select className={className ?? s.select} value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">любая личность</option>
      {personas.map((p) => (
        <option key={p.slug} value={p.slug}>
          {p.name}
          {p.accounts_ready ? ` · ${p.accounts_ready} акк. в сети` : ' · нет аккаунтов в сети'}
        </option>
      ))}
    </select>
  );
}

function AddForm(props) { return <CreateLeadForm {...props} PersonaSelect={PersonaSelect} />; }

function ImportDialog({ personas, onClose }) {
  const [text, setText] = useState('');
  const [queue, setQueue] = useState(false);
  const [personaId, setPersonaId] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const lines = text.split('\n').filter((l) => l.trim()).length;

  async function submit(e) {
    e.preventDefault();
    if (busy || !lines) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await importLeads({ text, queue, persona_id: personaId }));
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose(Boolean(result))}>
      <form className={s.modal} style={{ width: 560 }} onSubmit={submit}>
        <h3 className={s.modalTitle}>Импорт номеров</h3>
        <p className={s.modalText}>
          По одному лиду в строке: <span className={s.mono}>контакт;имя;город;возраст;сайт</span>, где контакт —
          телефон, <span className={s.mono}>@username</span> или ссылка <span className={s.mono}>t.me/…</span>. Имя, город,
          возраст и сайт необязательны — город и сайт идут в <span className={s.mono}>{'{city}'}</span> и{' '}
          <span className={s.mono}>{'{site}'}</span> диалога. Разделитель — <span className={s.mono}>;</span>, запятая или таб.
          Дубли пропускаются.
        </p>
        {result ? (
          <p className={`${s.modalText} ${s.ok}`}>
            Добавлено: {result.created}, дублей: {result.duplicates}
            {result.errors.length > 0 && (
              <>
                <br />
                <span className={s.error}>Пропущено строк: {result.errors.length}</span>
                <br />
                <span className={s.muted}>{result.errors.slice(0, 5).join(' · ')}{result.errors.length > 5 ? ' …' : ''}</span>
              </>
            )}
          </p>
        ) : (
          <>
            <textarea
              className={s.field}
              rows={10}
              autoFocus
              placeholder={'+79001234567;Олег;Москва;34;beboo\n@some_name;Ира;;;mamba\nt.me/other_name'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              style={{ fontFamily: 'monospace', resize: 'vertical' }}
            />
            <label className={s.label}>
              С какой личности писать всем из списка
              <PersonaSelect personas={personas} value={personaId} onChange={setPersonaId} />
            </label>
            <label className={s.check}>
              <input type="checkbox" checked={queue} onChange={(e) => setQueue(e.target.checked)} />
              Сразу поставить в очередь прозвона
            </label>
          </>
        )}
        {error && <p className={s.error}>{error}</p>}
        <div className={s.modalActions}>
          {result ? (
            <button type="button" className={s.btnPrimary} onClick={() => onClose(true)}>Готово</button>
          ) : (
            <>
              <button type="button" className={s.btn} onClick={() => onClose(false)}>Отмена</button>
              <button type="submit" className={s.btnPrimary} disabled={busy || !lines}>{busy ? 'Импорт…' : `Импортировать (${lines})`}</button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

function OutreachBar({ status, queued }) {
  if (!status) return null;
  const online = status.accounts.filter((a) => a.online);
  const sent = status.accounts.reduce((n, a) => n + a.sent_today, 0);
  const cap = status.accounts.length * status.daily_per_account;
  let problem = null;
  if (!status.enabled) problem = 'прозвон выключен: нет ключей Telegram или включён аварийный стоп';
  else if (!online.length) problem = 'нет ни одного активного аккаунта онлайн — включите аккаунт в разделе «Аккаунты»';
  else if (!status.within_hours) problem = `вне рабочих часов (${status.hours_msk[0]}:00–${status.hours_msk[1]}:00 МСК)`;
  const detail = `Сегодня отправлено ${sent} из ${cap} (лимит ${status.daily_per_account}/акк., пауза ${Math.round(status.min_gap_s / 60)} мин, проверка очереди раз в минуту).`;
  if (problem && queued > 0) {
    return (
      <p className={s.error}>
        Очередь ({queued}) стоит: {problem}. {online.length === 0 && status.enabled && <Link to="/accounts" style={{ color: 'inherit' }}>Открыть аккаунты →</Link>}
      </p>
    );
  }
  return (
    <p className={s.hint}>
      Прозвон — {problem ? `${problem}, очередь ждёт` : `работает: ${online.length} акк. онлайн`}. {detail}
    </p>
  );
}

export function DeleteLeadDialog(props) { return <PanelUX.DeleteLeadModal {...props} />; }

export default function Leads() {
  const navigate = useNavigate();
  const [data, setData] = useState({ items: [], counts: {} });
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [outreach, setOutreach] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(null);
  const [personas, setPersonas] = useState([]);
  const [ready, setReady] = useState(false);

  const loadPersonas = useCallback(() => {
    getLeadPersonas().then((r) => setPersonas(r.items ?? [])).catch(() => setPersonas([]));
  }, []);

  const load = useCallback(() => {
    Promise.all([getLeads({ status, q }), getOutreachStatus().catch(() => null)])
      .then(([d, o]) => { setData(d); setOutreach(o); })
      .catch((e) => setError(e.detail || e.message))
      .finally(() => setReady(true));
  }, [status, q]);

  useEffect(() => {
    load();
    loadPersonas();
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      load();
      loadPersonas();
    }, 10000);
    return () => clearInterval(t);
  }, [load, loadPersonas]);

  async function run(fn) {
    setError(null);
    try {
      await fn();
      setSelected(new Set());
      load();
    } catch (e) {
      setError(e.detail || e.message);
    }
  }

  const toggle = (id) => setSelected((v) => { const n = new Set(v); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = [...selected];
  const counts = data.counts ?? {};

  return (
    <div className="app mr-leads">
      <Header />
      <main className="main">
        <div className="container">
          <div className={s.head}>
            <h2 className={s.title}>Лиды</h2>
            <div className={s.actions}>
              <button className={s.btn} onClick={() => setImporting(true)}>Импорт списка</button>
              {!adding && <button className={s.btn} onClick={() => setAdding(true)}>+ Добавить номер</button>}
              {ids.length > 0 ? (
                <>
                  <button className={s.btnPrimary} onClick={() => run(() => startOutreach(ids))}>В очередь ({ids.length})</button>
                  <button className={s.btn} onClick={() => run(() => stopOutreach(ids))}>Снять ({ids.length})</button>
                </>
              ) : (
                <button className={s.btnPrimary} disabled={!counts.pending} onClick={() => run(() => startOutreach())}>
                  Запустить прозвон ({counts.pending ?? 0})
                </button>
              )}
            </div>
          </div>
          <OutreachBar status={outreach} queued={counts.queued ?? 0} />
          {adding && <AddForm personas={personas} onDone={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}
          {(() => {
            const idle = personas.filter((p) => !p.accounts_ready).map((p) => p.slug);
            const stuck = data.items.filter((l) => l.status === 'queued' && l.persona_id && idle.includes(l.persona_id));
            if (!stuck.length) return null;
            const names = [...new Set(stuck.map((l) => l.persona_name || l.persona_id))].join(', ');
            return (
              <p className={s.error}>
                {stuck.length} лид(ов) в очереди ждут: у личности {names} нет аккаунтов в сети. Включите аккаунт этой личности
                или смените личность у лида.
              </p>
            );
          })()}
          {error && <p className={s.error}>{error}</p>}

          <div className={s.head} style={{ margin: '0 0 12px' }}>
            <div className={s.actions}>
              {STATUS.map((st) => (
                <button
                  key={st.key || 'all'}
                  className={`${s.btnSm} ${status === st.key ? s.btnSelected : ''}`}
                  onClick={() => setStatus(st.key)}
                >
                  {st.label} <span className={s.muted}>{st.key ? counts[st.key] ?? 0 : counts.total ?? 0}</span>
                </button>
              ))}
            </div>
            <input className={s.field} placeholder="поиск: телефон, @username, имя, город" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
          </div>

          <LeadsTable ready={ready} rows={data.items} query={q} status={status} selected={selected}
            onToggle={toggle} onSelectVisible={checked => setSelected(previous => {
              const next = new Set(previous);
              for (const row of data.items) { if (checked) next.add(row.id); else next.delete(row.id); }
              return next;
            })} onClearSelection={() => setSelected(new Set())}
            onChat={id => navigate(`/conversation/${id}`)}
            onQueue={ids => run(() => startOutreach(ids))} onUnqueue={ids => run(() => stopOutreach(ids))}
            onReassign={row => run(() => writeFromAnother(row.id))} onDelete={setDeleting}
            onPersonaChange={(id, persona_id) => run(() => updateLead(id, { persona_id }))}
            personas={personas} helpers={{ PersonaSelect, statusLabels: LABEL, statusClasses: BADGE, date: fmtTs }} />
        </div>
      </main>
      {importing && <ImportDialog personas={personas} onClose={() => { setImporting(false); load(); }} />}
      {deleting && (
        <DeleteLeadDialog
          lead={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={async ({ telegram }) => {
            setError(null);
            try {
              const r = await deleteLead(deleting.id, { telegram });
              const failed = r?.telegram?.failed ?? [];
              if (failed.length) {
                setError(`Лид удалён, но переписку в Telegram удалить не удалось: ${failed.map((f) => (f.account_id ? `аккаунт #${f.account_id} — ${f.error}` : f.error)).join('; ')}`);
              }
            } catch (e) {
              setError(e.detail || e.message);
              throw e;
            }
            setDeleting(null);
            setSelected(new Set());
            load();
          }}
        />
      )}
    </div>
  );
}
