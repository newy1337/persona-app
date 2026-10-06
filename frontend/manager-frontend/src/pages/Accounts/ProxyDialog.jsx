import { useState } from 'react';
import { setAccountProxy } from '../../api/accounts';
import { parseProxyLine } from '../../utils/proxyLine';
import { Button } from '@/components/ui/button';
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
import { NativeSelect } from '@/components/ui/native-select';

export const EMPTY_PROXY = { type: 'socks5', host: '', port: '', username: '', password: '', secret: '' };

export function proxyPayload(p) {
  return {
    type: p.type,
    host: p.host.trim(),
    port: Number(p.port),
    username: p.username || null,
    password: p.password || null,
    secret: p.type === 'mtproto' ? p.secret || null : null,
  };
}

/**
 * Поля прокси: строка «одной строкой» плюс разобранные поля. Рендерится
 * фрагментом внутри сетки вызывающей стороны (форма добавления или диалог),
 * поэтому первое поле занимает всю ширину через col-span-full.
 * autoFocus — только внутри ProxyDialog; в форме добавления фокус держит телефон.
 */
export function ProxyFields({ value, onChange, autoFocus = false }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const [line, setLine] = useState('');
  const [parsed, setParsed] = useState(null);

  const applyLine = (text) => {
    setLine(text);
    if (!text.trim()) {
      setParsed(null);
      return;
    }
    const r = parseProxyLine(text);
    setParsed(r);
    if (r.ok) onChange({ ...EMPTY_PROXY, ...r.proxy });
  };

  const lineError = parsed && !parsed.ok ? `Не разобрал: ${parsed.error}` : undefined;
  const lineHint = parsed?.ok
    ? `Распознано: ${parsed.proxy.type.toUpperCase()} ${parsed.proxy.host}:${parsed.proxy.port}${parsed.proxy.username ? ` · логин ${parsed.proxy.username}` : ''} — проверьте поля ниже`
    : undefined;

  return (
    <>
      <Field label="Одной строкой" className="col-span-full" error={lineError} hint={lineHint}>
        <Input
          className="font-mono"
          value={line}
          onChange={(e) => applyLine(e.target.value)}
          placeholder="1.2.3.4:1080:логин:пароль или socks5://логин:пароль@хост:порт"
          autoFocus={autoFocus}
        />
      </Field>
      <Field label="Тип">
        <NativeSelect value={value.type} onChange={(e) => set({ type: e.target.value })}>
          <option value="socks5">SOCKS5</option>
          <option value="mtproto">MTProto</option>
          <option value="socks4">SOCKS4</option>
        </NativeSelect>
      </Field>
      <Field label="Хост">
        <Input value={value.host} onChange={(e) => set({ host: e.target.value })} placeholder="1.2.3.4" />
      </Field>
      <Field label="Порт">
        <Input className="tabular-nums" inputMode="numeric" value={value.port} onChange={(e) => set({ port: e.target.value })} placeholder="1080" />
      </Field>
      {value.type === 'mtproto' ? (
        <Field label="Secret">
          <Input className="font-mono" value={value.secret} onChange={(e) => set({ secret: e.target.value })} />
        </Field>
      ) : (
        <>
          <Field label="Логин">
            <Input value={value.username} onChange={(e) => set({ username: e.target.value })} />
          </Field>
          <Field label="Пароль">
            <Input type="password" value={value.password} onChange={(e) => set({ password: e.target.value })} />
          </Field>
        </>
      )}
    </>
  );
}

export function proxyValid(p) {
  const port = Number(p.port);
  return (
    ['socks5', 'socks4', 'mtproto'].includes(p.type)
    && p.host.trim()
    && Number.isInteger(port) && port > 0 && port < 65536
    && (p.type !== 'mtproto' || p.secret)
  );
}

export default function ProxyDialog({ account, onClose }) {
  const [proxy, setProxy] = useState(EMPTY_PROXY);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy || !proxyValid(proxy)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await setAccountProxy(account.id, proxyPayload(proxy));
      if (r?.reconnect_error) {
        setError(`Прокси сохранён, но аккаунт через него не подключился: ${r.reconnect_error}`);
        return;
      }
      onClose(true);
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent portal={false} showCloseButton={false} className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[400px]">
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="text-base">Прокси: {account.phone_e164}</DialogTitle>
            <DialogDescription>
              После сохранения аккаунт переподключится через этот прокси. Не подключится — будет видно по статусу «онлайн».
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 [scrollbar-gutter:stable]">
            <p className="min-h-4 text-xs text-muted-foreground">
              {account.proxy_label && (
                <>Сейчас: <span className="font-mono text-foreground">{account.proxy_label}</span> — новый заменит его.</>
              )}
            </p>
            <div className="grid grid-cols-2 gap-x-3">
              <ProxyFields value={proxy} onChange={setProxy} autoFocus />
            </div>
            <p className="min-h-4 text-xs text-destructive">{error}</p>
          </div>
          <DialogFooter className="px-6 pt-4 pb-6">
            <Button type="button" variant="outline" onClick={() => onClose(false)}>Отмена</Button>
            <Button type="submit" disabled={busy || !proxyValid(proxy)}>
              {busy ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
