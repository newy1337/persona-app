import { useState } from 'react';
import { setAccountProxy } from '../../api/accounts';
import { parseProxyLine } from '../../utils/proxyLine';
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

  // Сообщение под строкой всегда в одну строку (целиком — в title): длинный
  // разбор не меняет высоту окна.
  const oneLine = (text) => text && <span className="block truncate" title={text}>{text}</span>;

  return (
    <>
      <Field label="Одной строкой" className="col-span-full" reserve error={oneLine(lineError)} hint={oneLine(lineHint)}>
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
      <DialogContent portal={false} showCloseButton={false}>
        <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Прокси: <span className="font-mono">{account.phone_e164}</span></DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            {/* Порядок абзацев как в исходном окне: сначала текущий прокси, затем пояснение.
                account — снимок на время жизни окна, так что условный абзац не прыгает. */}
            {account.proxy_label && (
              <p className="text-sm text-muted-foreground">
                Сейчас: <span className="font-mono text-foreground">{account.proxy_label}</span> — новый заменит его.
              </p>
            )}
            <DialogDescription>
              После сохранения аккаунт переподключится через этот прокси. Не подключится — будет видно по статусу «онлайн».
            </DialogDescription>
            <div className="grid gap-3 sm:grid-cols-2">
              <ProxyFields value={proxy} onChange={setProxy} autoFocus />
            </div>
          </DialogBody>
          <DialogError>{error}</DialogError>
          <DialogFooter>
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
