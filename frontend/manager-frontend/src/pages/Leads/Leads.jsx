import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Search } from 'lucide-react';
import Header from '../../components/Header/Header';
import { PanelUX } from '../../ui/PanelUX';
import { CreateLeadForm } from './CreateLeadForm';
import { LeadsTable } from './LeadsTable';
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
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

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
/* Единственная карта «статус лида -> Badge». Нарочно не совпадает с цветами
   стадий диалогов из data/stages.js: статусы лида — про воронку прозвона. */
const BADGE = {
  pending: { variant: 'outline' },
  queued: { variant: 'secondary' },
  assigned: { variant: 'default' },
  contacted: { variant: 'success' },
  replied: { variant: 'success', className: 'border-success-foreground/40 font-semibold' },
  dead: { variant: 'destructive' },
};
const SEARCH_DEBOUNCE_MS = 250;

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function PersonaSelect({ personas, value, onChange, className, ...props }) {
  return (
    <NativeSelect className={className} value={value || ''} onChange={(e) => onChange(e.target.value)} {...props}>
      <option value="">любая личность</option>
      {personas.map((p) => (
        <option key={p.slug} value={p.slug}>
          {p.name}
          {p.accounts_ready ? ` · ${p.accounts_ready} акк. в сети` : ' · нет аккаунтов в сети'}
        </option>
      ))}
    </NativeSelect>
  );
}

function AddForm(props) { return <CreateLeadForm {...props} PersonaSelect={PersonaSelect} />; }

const Mono = ({ children }) => <span className="font-mono text-foreground">{children}</span>;

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
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(Boolean(result)); }}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <DialogHeader className="p-6 pb-4">
            <DialogTitle>Импорт номеров</DialogTitle>
            <DialogDescription>
              По одному лиду в строке: <Mono>контакт;имя;город;возраст;сайт</Mono>, где контакт —
              телефон, <Mono>@username</Mono> или ссылка <Mono>t.me/…</Mono>. Имя, город,
              возраст и сайт необязательны — город и сайт идут в <Mono>{'{city}'}</Mono> и{' '}
              <Mono>{'{site}'}</Mono> диалога. Разделитель — <Mono>;</Mono>, запятая или таб.
              Дубли пропускаются.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-[360px] min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-6 [scrollbar-gutter:stable]">
            {result ? (
              <div className="rounded-lg border bg-card p-4 text-sm">
                <p className="text-success-foreground">Добавлено: <span className="tabular-nums">{result.created}</span>, дублей: <span className="tabular-nums">{result.duplicates}</span></p>
                {result.errors.length > 0 && (
                  <>
                    <p className="mt-2 text-destructive">Пропущено строк: <span className="tabular-nums">{result.errors.length}</span></p>
                    <p className="mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{result.errors.slice(0, 5).join(' · ')}{result.errors.length > 5 ? ' …' : ''}</p>
                  </>
                )}
              </div>
            ) : (
              <>
                <Textarea
                  className="min-h-[240px] resize-y font-mono text-xs field-sizing-fixed [field-sizing:fixed] md:text-xs"
                  rows={10}
                  autoFocus
                  placeholder={'+79001234567;Олег;Москва;34;beboo\n@some_name;Ира;;;mamba\nt.me/other_name'}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <Field label="С какой личности писать всем из списка">
                  <PersonaSelect personas={personas} value={personaId} onChange={setPersonaId} />
                </Field>
                <div className="flex items-center gap-2">
                  <Checkbox id="import-queue" checked={queue} onCheckedChange={(v) => setQueue(v === true)} />
                  <Label htmlFor="import-queue" className="cursor-pointer font-normal">Сразу поставить в очередь прозвона</Label>
                </div>
              </>
            )}
            <p className="min-h-4 text-xs text-destructive" aria-live="polite">{error}</p>
          </div>
          <DialogFooter className="p-6 pt-4">
            {result ? (
              <Button type="button" onClick={() => onClose(true)}>Готово</Button>
            ) : (
              <>
                <Button type="button" variant="outline" disabled={busy} onClick={() => onClose(false)}>Отмена</Button>
                <Button type="submit" disabled={busy || !lines}>
                  {busy && <Loader2 className="animate-spin" />}
                  <span>{busy ? 'Импорт…' : <>Импортировать (<span className="tabular-nums">{lines}</span>)</>}</span>
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
      <p className="text-xs text-destructive tabular-nums">
        Очередь ({queued}) стоит: {problem}. {online.length === 0 && status.enabled && <Link to="/accounts" className="underline underline-offset-4">Открыть аккаунты →</Link>}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground tabular-nums">
      Прозвон — {problem ? `${problem}, очередь ждёт` : `работает: ${online.length} акк. онлайн`}. {detail}
    </p>
  );
}

function StuckWarning({ items, personas }) {
  const idle = personas.filter((p) => !p.accounts_ready).map((p) => p.slug);
  const stuck = items.filter((l) => l.status === 'queued' && l.persona_id && idle.includes(l.persona_id));
  if (!stuck.length) return null;
  const names = [...new Set(stuck.map((l) => l.persona_name || l.persona_id))].join(', ');
  return (
    <p className="text-xs text-destructive">
      {stuck.length} лид(ов) в очереди ждут: у личности {names} нет аккаунтов в сети. Включите аккаунт этой личности
      или смените личность у лида.
    </p>
  );
}

export function DeleteLeadDialog(props) { return <PanelUX.DeleteLeadModal {...props} />; }

export default function Leads() {
  const navigate = useNavigate();
  // items === null только до первого ответа: таблица рисует скелет нужной высоты.
  const [data, setData] = useState({ items: null, counts: {} });
  const [status, setStatus] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [outreach, setOutreach] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(null);
  const [personas, setPersonas] = useState([]);

  useEffect(() => {
    const t = setTimeout(() => setQ(qInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [qInput]);

  const loadPersonas = useCallback(() => {
    getLeadPersonas().then((r) => setPersonas(r.items ?? [])).catch(() => setPersonas([]));
  }, []);

  const load = useCallback(() => {
    Promise.all([getLeads({ status, q }), getOutreachStatus().catch(() => null)])
      .then(([d, o]) => { setData(d); if (o) setOutreach(o); })
      .catch((e) => setError(e.detail || e.message));
  }, [status, q]);

  useEffect(() => {
    load();
    loadPersonas();
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      load();
      loadPersonas();
    };
    const t = setInterval(refresh, 10000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', refresh);
    };
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
  const items = data.items ?? [];

  return (
    <div className="app">
      <Header />
      <main className="main">
        <div className="container">
          <div className="my-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Лиды</h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setImporting(true)}>Импорт списка</Button>
              <Button variant="outline" disabled={adding} onClick={() => setAdding(true)}>+ Добавить номер</Button>
              {ids.length > 0 ? (
                <>
                  <Button onClick={() => run(() => startOutreach(ids))}><span>В очередь (<span className="tabular-nums">{ids.length}</span>)</span></Button>
                  <Button variant="outline" onClick={() => run(() => stopOutreach(ids))}><span>Снять (<span className="tabular-nums">{ids.length}</span>)</span></Button>
                </>
              ) : (
                <Button disabled={!counts.pending} onClick={() => run(() => startOutreach())}>
                  <span>Запустить прозвон (<span className="inline-block min-w-[1ch] text-center tabular-nums">{counts.pending ?? 0}</span>)</span>
                </Button>
              )}
            </div>
          </div>

          <div className="mb-4 flex min-h-5 flex-col gap-1" aria-live="polite">
            <OutreachBar status={outreach} queued={counts.queued ?? 0} />
            <StuckWarning items={items} personas={personas} />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          {adding && <AddForm personas={personas} onDone={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Статус">
              {STATUS.map((st) => {
                const active = status === st.key;
                return (
                  <Button
                    key={st.key || 'all'}
                    size="sm"
                    variant={active ? 'secondary' : 'ghost'}
                    aria-pressed={active}
                    onClick={() => setStatus(st.key)}
                  >
                    {st.label} <span className="min-w-[2ch] text-right text-xs tabular-nums text-muted-foreground">{st.key ? counts[st.key] ?? 0 : counts.total ?? 0}</span>
                  </Button>
                );
              })}
            </div>
            <div className="relative w-full sm:w-auto sm:min-w-[300px]">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                className="h-8 pl-8"
                placeholder="поиск: телефон, @username, имя, город"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
            </div>
          </div>

          <LeadsTable rows={data.items} query={q} status={status} selected={selected}
            onToggle={toggle} onSelectVisible={checked => setSelected(previous => {
              const next = new Set(previous);
              for (const row of items) { if (checked) next.add(row.id); else next.delete(row.id); }
              return next;
            })} onClearSelection={() => setSelected(new Set())}
            onChat={id => navigate(`/conversation/${id}`)}
            onQueue={ids => run(() => startOutreach(ids))} onUnqueue={ids => run(() => stopOutreach(ids))}
            onReassign={row => run(() => writeFromAnother(row.id))} onDelete={setDeleting}
            onPersonaChange={(id, persona_id) => run(() => updateLead(id, { persona_id }))}
            personas={personas} helpers={{ PersonaSelect, statusLabels: LABEL, statusBadges: BADGE, date: fmtTs }} />
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
