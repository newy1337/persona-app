import { useState } from 'react';
import { setVkSession } from '../../api/accounts';
import { parseVkCookies } from '../../utils/vkCookies';
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
import { Textarea } from '@/components/ui/textarea';

/**
 * Куки VK: войдите в аккаунт в браузере (через тот же прокси), выгрузите куки vk.ru
 * расширением Cookie-Editor («Export → JSON») или скопируйте заголовок Cookie из DevTools.
 * Рендерится фрагментом внутри сетки вызывающей стороны: длинные поля — на всю ширину.
 */
export function VkCookieFields({ cookies, userAgent, parsed, onCookies, onUserAgent }) {
  async function fromFile(file) {
    if (file) onCookies(await file.text());
  }
  const error = parsed && !parsed.ok ? parsed.error : undefined;
  const hint = parsed?.ok ? `Кук VK: ${parsed.cookies.length}, сессия есть.` : undefined;
  return (
    <>
      <Field
        label="Куки vk.ru — выгрузка Cookie-Editor (JSON) или строка Cookie из DevTools"
        className="col-span-full"
        reserve
        error={error}
        hint={hint}
      >
        <Textarea
          className="min-h-24 font-mono text-xs"
          rows={4}
          value={cookies}
          onChange={(e) => onCookies(e.target.value)}
          placeholder={'[{"name":"remixsid","value":"…","domain":".vk.ru"}, …]  или  remixsid=…; remixlang=0'}
        />
      </Field>
      <Field label="Или файлом">
        <Input type="file" accept=".json,.txt,application/json,text/plain" onChange={(e) => fromFile(e.target.files?.[0])} />
      </Field>
      <Field label="User-Agent браузера входа (необязательно)">
        <Input value={userAgent} onChange={(e) => onUserAgent(e.target.value)} placeholder="Mozilla/5.0 … Chrome/151 …" />
      </Field>
    </>
  );
}

/** «Войти» у VK-аккаунта: новые куки вместо мастера Telegram. */
export default function VkSessionDialog({ account, onClose }) {
  const [cookies, setCookies] = useState('');
  const [userAgent, setUserAgent] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const parsed = cookies.trim() ? parseVkCookies(cookies) : null;

  async function submit(e) {
    e.preventDefault();
    if (busy || !parsed?.ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await setVkSession(account.id, parsed.cookies, userAgent.trim());
      if (r?.connect_error) {
        setError(`Куки сохранены, но аккаунт не подключился: ${r.connect_error}`);
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
      <DialogContent portal={false} showCloseButton={false} className="sm:max-w-2xl">
        <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Вход VK: <span className="font-mono">{account.login || account.phone_e164}</span></DialogTitle>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3">
            <DialogDescription>
              Войдите в этот аккаунт в браузере через прокси аккаунта и вставьте куки vk.ru — пароль не нужен.
              После сохранения аккаунт переподключится.
            </DialogDescription>
            <div className="grid gap-3 sm:grid-cols-2">
              <VkCookieFields cookies={cookies} userAgent={userAgent} parsed={parsed} onCookies={setCookies} onUserAgent={setUserAgent} />
            </div>
          </DialogBody>
          <DialogError>{error}</DialogError>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onClose(false)}>Отмена</Button>
            <Button type="submit" disabled={busy || !parsed?.ok}>
              {busy ? 'Подключение…' : 'Сохранить и подключить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
