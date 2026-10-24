import { PanelUX } from '../../ui/PanelUX';
import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  addAccount,
  addVkAccount,
  deleteAccount,
  getAccounts,
  clearAccountFlood,
  getLiveState,
  setAccountStatus,
} from '../../api/accounts';
import { AccountsTable, AccountsTableSkeleton } from './AccountsTable';
import AuthWizard from './AuthWizard';
import EditAccountDialog from './EditAccountDialog';
import { getPersonas } from '../../api/personas';
import { getLeadPersonas } from '../../api/leads';
import ProxyDialog, { EMPTY_PROXY, EMPTY_VK_PROXY, ProxyFields, proxyPayload, proxyValid } from './ProxyDialog';
import VkSessionDialog, { VkCookieFields } from './VkSessionDialog';
import ClientAvatar from '../../components/ClientAvatar/ClientAvatar';
import { CHANNEL_FILTERS, channelKey, matchesChannel } from '../../utils/channel';
import { parseVkCookies } from '../../utils/vkCookies';
import { setAccountPhotoAutoSend } from '../../api/photoSets';
import { cn } from '@/lib/utils';
import { useRouteBusy } from '@/components/AppLayout/routeBusy';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogError,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import { NativeSelect } from '@/components/ui/native-select';

const STATUS_LABEL = {
  unauthorized: 'нет сессии',
  active: 'активен',
  paused: 'пауза',
  banned: 'бан',
  retired: 'выведен',
};

export function accountStatusLabel(a) {
  if (a.status === 'unauthorized' && a.lost_at) return 'сессия завершена';
  if (a.status === 'banned') return channelKey(a.channel) === 'vk' ? 'бан VK' : 'бан Telegram';
  return STATUS_LABEL[a.status] ?? a.status;
}

function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const TABLE_HELPERS = { Avatar: ClientAvatar, statusLabel: accountStatusLabel, statusClasses: {}, date: fmtTs };

const EMPTY_FORM = {
  channel: 'telegram', phone_e164: '', login: '', cookies: '', user_agent: '',
  persona_id: 'nastya', purpose: 'prod', daily_msg_quota: '', withProxy: false, proxy: EMPTY_PROXY,
};

/**
 * Переключатель-сегменты (радиогруппа): мессенджер в форме добавления и фильтр
 * канала над таблицей. options — [[key, title], …].
 */
function Segmented({ label, value, options, onChange, className }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex h-8 w-fit items-center rounded-lg bg-muted p-[3px] text-muted-foreground', className)}
    >
      {options.map(([key, title, channel]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          data-channel={channel}
          className={cn(
            'inline-flex h-full items-center rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            value === key && 'bg-background text-foreground shadow-sm',
          )}
          onClick={() => onChange(key)}
        >
          {title}
        </button>
      ))}
    </div>
  );
}

export function AddAccountDialog({ personas, onDone, onCancel }) {
  const [f, setF] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((v) => ({ ...v, ...patch }));
  const vk = f.channel === 'vk';
  // VK: токен привязан к выходному IP — без прокси аккаунт не живёт, поэтому прокси обязателен.
  const withProxy = vk || f.withProxy;
  const cookies = vk ? parseVkCookies(f.cookies) : null;
  const valid = f.persona_id.trim()
    && (vk ? f.login.trim().length >= 3 && cookies.ok : /^\+?\d{10,15}$/.test(f.phone_e164.trim()))
    && (!withProxy || proxyValid(f.proxy, f.channel));

  function switchChannel(channel) {
    set({ channel, proxy: channel === 'vk' ? EMPTY_VK_PROXY : EMPTY_PROXY, withProxy: false });
    setError(null);
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    const common = {
      persona_id: f.persona_id.trim(),
      purpose: f.purpose,
      daily_msg_quota: f.daily_msg_quota ? Number(f.daily_msg_quota) : null,
    };
    try {
      if (vk) {
        const r = await addVkAccount({
          ...common,
          login: f.login.trim(),
          cookies: cookies.cookies,
          user_agent: f.user_agent.trim() || undefined,
          proxy_config: proxyPayload(f.proxy),
        });
        if (r?.connect_error) {
          // Аккаунт уже создан: окно закрываем, причину показываем на странице.
          onDone({ warning: `VK-аккаунт ${r.login} добавлен, но не подключился: ${r.connect_error}. Проверьте прокси или обновите куки («Войти»).` });
          return;
        }
      } else {
        await addAccount({
          ...common,
          phone_e164: f.phone_e164.trim(),
          proxy_config: f.withProxy ? proxyPayload(f.proxy) : null,
        });
      }
      onDone();
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent portal={false} showCloseButton={false} className={cn(vk && 'sm:max-w-2xl')}>
        <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Новый аккаунт</DialogTitle>
            <DialogDescription>
              {vk
                ? 'Логин, куки браузера и прокси — аккаунт подключится сразу.'
                : 'Добавьте номер, затем войдите — код придёт в Telegram.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid content-start gap-3 sm:grid-cols-2">
              <div className="col-span-full flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                Мессенджер
                <Segmented
                  label="Мессенджер"
                  value={f.channel}
                  options={[['telegram', 'Telegram', 'telegram'], ['vk', 'ВКонтакте', 'vk']]}
                  onChange={switchChannel}
                />
              </div>
              {vk ? (
                <Field label="Логин VK (номер или почта)">
                  <Input className="font-mono" autoFocus placeholder="+79001234567" value={f.login} onChange={(e) => set({ login: e.target.value })} />
                </Field>
              ) : (
                <Field label="Телефон (E.164)">
                  <Input className="font-mono tabular-nums" autoFocus placeholder="+79001234567" value={f.phone_e164} onChange={(e) => set({ phone_e164: e.target.value })} />
                </Field>
              )}
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
              {vk && (
                <VkCookieFields
                  cookies={f.cookies}
                  userAgent={f.user_agent}
                  parsed={f.cookies.trim() ? cookies : null}
                  onCookies={(text) => set({ cookies: text })}
                  onUserAgent={(text) => set({ user_agent: text })}
                />
              )}
              {vk ? (
                <p className="col-span-full text-xs text-muted-foreground">
                  Прокси обязателен: токен VK привязан к адресу. Нужен HTTP, HTTPS или SOCKS5, лучше липкий (один IP).
                </p>
              ) : (
                <Label className="col-span-full cursor-pointer font-normal">
                  <NativeCheckbox checked={f.withProxy} onChange={(e) => set({ withProxy: e.target.checked })} />
                  Задать прокси сразу
                </Label>
              )}
              {withProxy && <ProxyFields key={f.channel} value={f.proxy} onChange={(proxy) => set({ proxy })} channel={f.channel} />}
          </DialogBody>
          <DialogError>{error}</DialogError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>Отмена</Button>
            <Button type="submit" disabled={busy || !valid}>
              {busy ? (vk ? 'Подключение…' : 'Добавление…') : vk ? 'Добавить и подключить' : 'Добавить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const [channel, setChannel] = useState('all');
  const [vkSession, setVkSession] = useState(null);

  // Полоса загрузки под шапкой — только до первого ответа.
  useRouteBusy(items === null);

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
    if (!await PanelUX.confirm({ title: 'Удалить аккаунт?', message: `Аккаунт ${a.login || a.phone_e164}. Сессия будет стёрта, чаты останутся.`, confirmLabel: 'Удалить', danger: true })) return;
    run(() => deleteAccount(a.id));
  }

  const problem = error || loadError;

  return (
    <>
      <div className="container">
        <PageHeader
          title="Аккаунты"
          description="Образ аккаунта задаёт хед региона на странице «Образы» — по личности аккаунта."
          className="pb-2"
        >
          {items?.length > 0 && (
            <Segmented
              label="Фильтр канала"
              value={channel}
              options={CHANNEL_FILTERS.map(([key, title]) => [
                key,
                `${title} (${items.filter((a) => matchesChannel(a, key)).length})`,
                key === 'all' ? undefined : key,
              ])}
              onChange={setChannel}
            />
          )}
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Добавить аккаунт
          </Button>
        </PageHeader>
        {/* Постоянный слот под ошибку / уведомление: таблица не прыгает, когда они появляются. */}
        <div className="mb-2 flex min-h-4 flex-wrap gap-x-3 text-xs leading-4" aria-live="polite">
          {problem && <p className="text-destructive">{problem}</p>}
          {flash && <p className="text-muted-foreground">{flash}</p>}
        </div>

        {items === null ? (
          <AccountsTableSkeleton />
        ) : (
          <AccountsTable rows={items.filter((a) => matchesChannel(a, channel))} alive={online} onEdit={setEditing}
            onLogin={(row) => (channelKey(row.channel) === 'vk' ? setVkSession(row) : setAuth(row))}
            onPhotoAutoSend={(row, enabled) => run(() => setAccountPhotoAutoSend(row.id, enabled))}
            onProxy={setProxyFor} onStatus={(row, status) => run(() => setAccountStatus(row.id, status, 'operator:web'))}
            onClearFlood={row => run(() => clearAccountFlood(row.id))} onDelete={remove}
            helpers={TABLE_HELPERS} />
        )}
      </div>

      {adding && <AddAccountDialog personas={personas} onDone={(o) => { setAdding(false); if (o?.warning) setError(o.warning); load(); }} onCancel={() => setAdding(false)} />}
      {auth && <AuthWizard account={auth} onClose={() => { setAuth(null); load(); }} />}
      {proxyFor && <ProxyDialog account={proxyFor} onClose={() => { setProxyFor(null); load(); }} />}
      {vkSession && <VkSessionDialog account={vkSession} onClose={() => { setVkSession(null); load(); }} />}
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
    </>
  );
}
