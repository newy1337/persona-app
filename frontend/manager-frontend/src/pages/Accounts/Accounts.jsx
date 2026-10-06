import { AccountsTable } from '../../ui/ManagerRegion';
import { PanelUX } from '../../ui/PanelUX';
import { useCallback, useEffect, useState } from 'react';
import Header from '../../components/Header/Header';
import {
  addAccount,
  deleteAccount,
  getAccounts,
  clearAccountFlood,
  getLiveState,
  setAccountStatus,
} from '../../api/accounts';
import { AccountsTableSkeleton } from './AccountsTable';
import AuthWizard from './AuthWizard';
import EditAccountDialog from './EditAccountDialog';
import { getPersonas } from '../../api/personas';
import { getLeadPersonas } from '../../api/leads';
import ProxyDialog, { EMPTY_PROXY, ProxyFields, proxyPayload, proxyValid } from './ProxyDialog';
import ClientAvatar from '../../components/ClientAvatar/ClientAvatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import { NativeSelect } from '@/components/ui/native-select';

const STATUS_LABEL = {
  unauthorized: 'нет сессии',
  active: 'активен',
  paused: 'пауза',
  banned: 'бан Telegram',
  retired: 'выведен',
};

export function accountStatusLabel(a) {
  if (a.status === 'unauthorized' && a.lost_at) return 'сессия завершена';
  return STATUS_LABEL[a.status] ?? a.status;
}

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const EMPTY_FORM = { phone_e164: '', persona_id: 'nastya', purpose: 'prod', daily_msg_quota: '', withProxy: false, proxy: EMPTY_PROXY };

function AddForm({ personas, onDone, onCancel }) {
  const [f, setF] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((v) => ({ ...v, ...patch }));
  const valid = /^\+?\d{10,15}$/.test(f.phone_e164.trim()) && f.persona_id.trim() && (!f.withProxy || proxyValid(f.proxy));

  async function submit(e) {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    try {
      await addAccount({
        phone_e164: f.phone_e164.trim(),
        persona_id: f.persona_id.trim(),
        purpose: f.purpose,
        daily_msg_quota: f.daily_msg_quota ? Number(f.daily_msg_quota) : null,
        proxy_config: f.withProxy ? proxyPayload(f.proxy) : null,
      });
      onDone();
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4 gap-0 py-0">
      <CardContent className="p-4">
        <form className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-x-3 gap-y-1" onSubmit={submit}>
          <Field label="Телефон (E.164)">
            <Input className="font-mono tabular-nums" autoFocus placeholder="+79001234567" value={f.phone_e164} onChange={(e) => set({ phone_e164: e.target.value })} />
          </Field>
          <Field label="Личность">
            <NativeSelect value={f.persona_id} onChange={(e) => set({ persona_id: e.target.value })}>
              {!personas.some((p) => p.slug === f.persona_id) && <option value={f.persona_id}>{f.persona_id}</option>}
              {personas.filter((p) => p.enabled).map((p) => (
                <option key={p.slug} value={p.slug}>{p.name} ({p.slug})</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Назначение">
            <NativeSelect value={f.purpose} onChange={(e) => set({ purpose: e.target.value })}>
              <option value="prod">prod</option>
              <option value="test">test</option>
            </NativeSelect>
          </Field>
          <Field label="Лимит сообщений/день">
            <Input className="tabular-nums" inputMode="numeric" placeholder="без лимита" value={f.daily_msg_quota} onChange={(e) => set({ daily_msg_quota: e.target.value })} />
          </Field>
          {/* Чекбокс выровнен по контролам: та же высота h-9 и та же пустая строка сообщения снизу. */}
          <div className="flex flex-col justify-end gap-1.5">
            <Label className="h-9 cursor-pointer font-normal">
              <NativeCheckbox checked={f.withProxy} onChange={(e) => set({ withProxy: e.target.checked })} />
              Задать прокси сразу
            </Label>
            <span aria-hidden className="min-h-4" />
          </div>
          {f.withProxy && <ProxyFields value={f.proxy} onChange={(proxy) => set({ proxy })} />}
          <p className="col-span-full min-h-4 text-xs text-destructive">{error}</p>
          <div className="col-span-full flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>Отмена</Button>
            <Button type="submit" disabled={busy || !valid}>{busy ? 'Добавление…' : 'Добавить'}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default function Accounts() {
  const [items, setItems] = useState(null);
  const [online, setOnline] = useState({});
  const [error, setError] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [auth, setAuth] = useState(null);
  const [proxyFor, setProxyFor] = useState(null);
  const [editing, setEditing] = useState(null);
  const [flash, setFlash] = useState(null);
  const [personas, setPersonas] = useState([]);

  useEffect(() => {
    getPersonas()
      .then((r) => setPersonas(r.items ?? []))
      .catch(() =>
        getLeadPersonas()
          .then((r) => setPersonas((r.items ?? []).map((p) => ({ ...p, enabled: true }))))
          .catch(() => setPersonas([])),
      );
  }, []);

  // При перезапросе прежний список остаётся на месте: ошибка не обнуляет items.
  // items === null только до первого ОТВЕТА, удачного или нет: если первый
  // запрос упал, заглушка сменяется ошибкой и пустым состоянием, а не висит
  // вечно. Повтор — тот же опрос раз в 10 секунд; его успех снимает ошибку.
  const load = useCallback(() => {
    Promise.all([getAccounts(), getLiveState().catch(() => null)])
      .then(([list, state]) => {
        setItems(list);
        setLoadError(null);
        const map = {};
        for (const a of state?.tg_accounts ?? []) map[a.id] = Boolean(a.alive);
        setOnline(map);
      })
      .catch((e) => {
        setLoadError(e.detail || e.message);
        setItems((prev) => prev ?? []);
      });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 10000);
    return () => clearInterval(t);
  }, [load]);

  async function run(fn) {
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e.detail || e.message);
    }
  }

  async function remove(a) {
    if (!await PanelUX.confirm({ title: 'Удалить аккаунт?', message: `Аккаунт ${a.phone_e164}. Сессия будет стёрта, чаты останутся.`, confirmLabel: 'Удалить', danger: true })) return;
    run(() => deleteAccount(a.id));
  }

  return (
    <div className="app">
      <Header />
      <main className="main">
        <div className="container">
          <div className="my-6 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Telegram-аккаунты</h2>
            <Button disabled={adding} onClick={() => setAdding(true)}>+ Добавить аккаунт</Button>
          </div>
          {adding && <AddForm personas={personas} onDone={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}
          {/* Фиксированный слот под ошибку/уведомление: таблица не прыгает, когда они появляются. */}
          <div className="mb-3 min-h-5 text-sm">
            {(error || loadError) && <p className="text-destructive">{error || loadError}</p>}
            {flash && <p className="text-success-foreground">{flash}</p>}
          </div>

          {items === null ? (
            <AccountsTableSkeleton />
          ) : (
            <AccountsTable rows={items} alive={online} onEdit={setEditing} onLogin={setAuth}
              onProxy={setProxyFor} onStatus={(row, status) => run(() => setAccountStatus(row.id, status, 'operator:web'))}
              onClearFlood={row => run(() => clearAccountFlood(row.id))} onDelete={remove}
              helpers={{ Avatar: ClientAvatar, statusLabel: accountStatusLabel, statusClasses: {}, date: fmtTs }} />
          )}
        </div>
      </main>

      {auth && <AuthWizard account={auth} onClose={() => { setAuth(null); load(); }} />}
      {proxyFor && <ProxyDialog account={proxyFor} onClose={() => { setProxyFor(null); load(); }} />}
      {editing && (
        <EditAccountDialog
          account={editing}
          personas={personas}
          onClose={(saved, r) => {
            setEditing(null);
            if (saved && r) {
              const released = r.released_leads ? `, ${r.released_leads} лид(ов) переданы аккаунтам нужной личности` : '';
              setFlash(`Аккаунт #${r.id} сохранён: личность ${r.persona_name ?? r.persona_id}${released}`);
            }
            load();
          }}
        />
      )}
    </div>
  );
}
