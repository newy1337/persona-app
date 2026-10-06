import { PanelUX } from '../../ui/PanelUX';
import { useEffect, useRef, useState } from 'react';
import { getAccountPrivacy, setAccountPrivacy, updateAccount, updateAccountProfile, uploadAccountAvatar } from '../../api/accounts';
import ClientAvatar from '../../components/ClientAvatar/ClientAvatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

export function splitName(displayName) {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') };
}

export default function EditAccountDialog({ account, personas, onClose }) {
  const initialName = splitName(account.display_name);
  const [profile, setProfile] = useState({ first: initialName.first, last: initialName.last, username: account.username || '' });
  const [avatarUrl, setAvatarUrl] = useState(account.avatar_url);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photoInput = useRef(null);
  const profileChanged =
    profile.first.trim() !== initialName.first ||
    profile.last.trim() !== initialName.last ||
    profile.username.trim().replace(/^@+/, '') !== (account.username || '');
  const [lastSeen, setLastSeen] = useState({ hidden: null, busy: false, error: null });
  useEffect(() => {
    if (!account.online) return;
    getAccountPrivacy(account.id)
      .then((r) => setLastSeen({ hidden: r.hide_last_seen, busy: false, error: null }))
      .catch((e) => setLastSeen({ hidden: null, busy: false, error: e.detail || e.message }));
  }, [account.id, account.online]);
  const toggleLastSeen = async (hide) => {
    setLastSeen((v) => ({ ...v, busy: true, error: null }));
    try {
      const r = await setAccountPrivacy(account.id, hide);
      setLastSeen({ hidden: r.hide_last_seen, busy: false, error: null });
    } catch (e) {
      setLastSeen((v) => ({ ...v, busy: false, error: e.detail || e.message }));
    }
  };
  const [f, setF] = useState({
    persona_id: account.persona_id,
    purpose: account.purpose || 'prod',
    daily_msg_quota: account.daily_msg_quota ?? '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((v) => ({ ...v, ...patch }));
  const personaChanged = f.persona_id !== account.persona_id;
  const quota = String(f.daily_msg_quota).trim();
  const quotaValid = quota === '' || (/^\d+$/.test(quota) && Number(quota) >= 1 && Number(quota) <= 1000);
  const cancel = () => onClose(avatarUrl !== account.avatar_url);

  async function submit(e) {
    e.preventDefault();
    if (busy || !quotaValid) return;
    setBusy(true);
    setError(null);
    try {
      if (profileChanged) {
        if (!profile.first.trim()) throw new Error('имя в Telegram не может быть пустым');
        await updateAccountProfile(account.id, {
          first_name: profile.first.trim(),
          last_name: profile.last.trim(),
          username: profile.username.trim(),
        });
      }
      const r = await updateAccount(account.id, {
        persona_id: f.persona_id,
        purpose: f.purpose,
        daily_msg_quota: quota === '' ? null : Number(quota),
      });
      onClose(true, r);
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  const lastSeenSuffix = lastSeen.busy
    ? ' — сохраняю…'
    : lastSeen.hidden === null && account.online && !lastSeen.error
      ? ' — загрузка…'
      : '';

  return (
    <Dialog open onOpenChange={(open) => !open && cancel()}>
      <DialogContent
        portal={false}
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[400px]"
      >
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="text-base">
              Аккаунт {account.username ? `@${account.username}` : account.phone_e164}
            </DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-6 [scrollbar-gutter:stable]">
            <fieldset
              className="mb-3 flex min-w-0 flex-col gap-1 rounded-lg border p-4 pt-2 disabled:opacity-60"
              disabled={!account.online || busy}
            >
              <legend className="px-1.5 text-xs text-muted-foreground">
                Профиль в Telegram{account.online ? '' : ' — аккаунт не в сети'}
              </legend>
              <div className="mb-3 flex items-center gap-3">
                <ClientAvatar
                  className="flex size-14 shrink-0 items-center justify-center rounded-full border bg-muted text-base font-bold text-muted-foreground"
                  src={avatarUrl}
                  name={account.display_name || account.username || '?'}
                />
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setPhotoBusy(true);
                    setError(null);
                    try {
                      const r = await PanelUX.run(`avatar:${account.id}`, ['Загружаем фото…', 'Фото обновлено'], () => uploadAccountAvatar(account.id, file));
                      setAvatarUrl(r.avatar_url);
                    } catch (err) {
                      setError(err.detail || err.message);
                    } finally {
                      setPhotoBusy(false);
                    }
                  }}
                />
                <Button type="button" variant="outline" size="sm" disabled={photoBusy} onClick={() => photoInput.current?.click()}>
                  {photoBusy ? 'Загрузка…' : 'Сменить фото'}
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-x-3">
                <Field label="Имя">
                  <Input maxLength={64} value={profile.first} onChange={(e) => setProfile((v) => ({ ...v, first: e.target.value }))} />
                </Field>
                <Field label="Фамилия">
                  <Input maxLength={64} placeholder="необязательно" value={profile.last} onChange={(e) => setProfile((v) => ({ ...v, last: e.target.value }))} />
                </Field>
              </div>
              <Field label="Юзернейм">
                <Input
                  maxLength={33}
                  placeholder="без ника"
                  value={profile.username}
                  onChange={(e) => setProfile((v) => ({ ...v, username: e.target.value }))}
                />
              </Field>
              <div
                className="flex items-center gap-2"
                title="Настройка приватности Telegram: собеседники не видят, когда аккаунт был в сети"
              >
                <Checkbox
                  id="hide-last-seen"
                  data-testid="hide-last-seen"
                  checked={Boolean(lastSeen.hidden)}
                  disabled={lastSeen.hidden === null || lastSeen.busy}
                  onCheckedChange={(checked) => toggleLastSeen(checked === true)}
                />
                <Label htmlFor="hide-last-seen" className="font-normal">
                  Скрывать «был в сети»{lastSeenSuffix}
                </Label>
              </div>
              <p className="min-h-4 text-xs text-destructive">{lastSeen.error}</p>
            </fieldset>
            <Field label="Личность">
              <NativeSelect value={f.persona_id} onChange={(e) => set({ persona_id: e.target.value })}>
                {!personas.some((p) => p.slug === account.persona_id) && (
                  <option value={account.persona_id}>{account.persona_id} — нет такой личности</option>
                )}
                {personas.map((p) => (
                  <option key={p.slug} value={p.slug} disabled={!p.enabled}>
                    {p.name} ({p.slug}){p.enabled ? '' : ' — выключена'}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {personaChanged && (
              <p className="mb-2 text-xs text-destructive">
                {account.chats > 0
                  ? `У аккаунта ${account.chats} диалог(ов) — со следующего сообщения их все поведёт новая личность, с её именем и биографией. `
                  : 'Диалогов у аккаунта пока нет. '}
                Лиды, которых он взял под другую личность и ещё не написал, перейдут аккаунтам нужной личности.
              </p>
            )}
            <Field label="Назначение">
              <NativeSelect value={f.purpose} onChange={(e) => set({ purpose: e.target.value })}>
                <option value="prod">prod</option>
                <option value="test">test</option>
              </NativeSelect>
            </Field>
            <Field label="Лимит сообщений/день" error={quotaValid ? undefined : 'Лимит — число от 1 до 1000 или пусто'}>
              <Input
                className="tabular-nums"
                inputMode="numeric"
                placeholder="без лимита"
                value={f.daily_msg_quota}
                onChange={(e) => set({ daily_msg_quota: e.target.value })}
              />
            </Field>
            <p className="min-h-4 text-xs text-destructive">{error}</p>
          </div>
          <DialogFooter className="px-6 pt-4 pb-6">
            <Button type="button" variant="outline" onClick={cancel}>Отмена</Button>
            <Button type="submit" disabled={busy || !quotaValid}>{busy ? 'Сохранение…' : 'Сохранить'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
