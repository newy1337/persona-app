import { useEffect, useRef, useState } from 'react';
import { authFlow } from '../../api/accounts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const STEPS = {
  phone: [
    { key: 'pending', label: 'связь' },
    { key: 'need_code', label: 'код' },
    { key: 'need_2fa', label: '2FA' },
    { key: 'ok', label: 'готово' },
  ],
  qr: [
    { key: 'pending', label: 'связь' },
    { key: 'need_qr', label: 'сканирование' },
    { key: 'need_2fa', label: '2FA' },
    { key: 'ok', label: 'готово' },
  ],
};

function StepBar({ method, status }) {
  const steps = STEPS[method];
  const order = steps.map((x) => x.key);
  const idx = Math.max(0, order.indexOf(status === 'failed' ? 'pending' : status));
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Шаги входа">
      {steps.map((st, i) => (
        <Badge
          key={st.key}
          variant={i < idx ? 'success' : i === idx ? 'default' : 'outline'}
          className="h-5 rounded-full px-2"
        >
          {st.label}
        </Badge>
      ))}
    </div>
  );
}

// Картинку рисует сервер: токен входа — это ключ, через чужой генератор его
// пропускать нельзя, а панель обходится без лишней зависимости.
// Белое поле обязательно — камера не читает код на тёмном. Размер фиксирован,
// чтобы окно не прыгало, когда код приходит или обновляется.
function QrCode({ svg }) {
  return (
    <div
      data-testid="login-qr"
      className="mx-auto flex h-[240px] w-[220px] shrink-0 items-center justify-center rounded-lg bg-white p-2.5"
    >
      {svg ? (
        <div
          className="w-full leading-none [&_svg]:block [&_svg]:h-auto [&_svg]:w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <>
          <Skeleton className="size-[200px] rounded-md" />
          <span className="sr-only">Готовим код…</span>
        </>
      )}
    </div>
  );
}

export default function AuthWizard({ account, onClose }) {
  const [method, setMethod] = useState('phone');
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const jobRef = useRef(null);
  // Переключение способа: Radix Tabs зовёт onValueChange по mousedown, а
  // onClick нужен для клавиатуры/синтетических кликов — ref не даёт
  // отменить одно и то же задание дважды.
  const switchingRef = useRef(null);

  useEffect(() => {
    let timer;
    let alive = true;
    switchingRef.current = null;
    setJob(null);
    setError(null);
    setValue('');
    authFlow
      .start(account.id, method)
      .then((j) => {
        if (!alive) return;
        jobRef.current = j.job_id;
        setJob(j);
        timer = setInterval(async () => {
          try {
            const st = await authFlow.status(j.job_id);
            if (alive) setJob(st);
            if (st.status === 'ok' || st.status === 'failed') clearInterval(timer);
          } catch (e) {
            if (alive) setError(e.detail || e.message);
            clearInterval(timer);
          }
        }, 1000);
      })
      .catch((e) => alive && setError(e.detail || e.message));
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [account.id, method]);

  async function submit(e) {
    e.preventDefault();
    if (!job || busy || !value) return;
    setBusy(true);
    setError(null);
    try {
      if (job.status === 'need_code') await authFlow.code(job.job_id, value.trim());
      else if (job.status === 'need_2fa') await authFlow.password(job.job_id, value);
      setValue('');
      setJob((j) => ({ ...j, status: 'pending' }));
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  async function close(done) {
    const id = jobRef.current;
    if (id && !done && job?.status !== 'failed') await authFlow.cancel(id).catch(() => {});
    onClose(done);
  }

  // Переключение способа бросает начатое задание и начинает новое.
  async function switchMethod(next) {
    if (next === method || busy || switchingRef.current === next) return;
    switchingRef.current = next;
    const id = jobRef.current;
    if (id && job?.status !== 'ok' && job?.status !== 'failed') {
      await authFlow.cancel(id).catch(() => {});
    }
    jobRef.current = null;
    setMethod(next);
  }

  const status = job?.status ?? 'pending';
  const done = status === 'ok';
  const over = done || status === 'failed';
  // На шагах без поля ввода кнопка «Далее» не нужна: ждём Telegram.
  const needsInput = status === 'need_code' || status === 'need_2fa';

  return (
    <Dialog open onOpenChange={(open) => !open && close(done)}>
      <DialogContent
        portal={false}
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[400px]"
      >
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <DialogHeader className="px-6 pt-6 pb-4">
            <DialogTitle className="text-base">Вход: {account.phone_e164}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 [scrollbar-gutter:stable]">
            <Tabs value={method} onValueChange={switchMethod} activationMode="manual">
              <TabsList className="grid w-full grid-cols-2" aria-label="Способ входа">
                <TabsTrigger value="phone" disabled={busy || over} onClick={() => switchMethod('phone')}>
                  По коду из Telegram
                </TabsTrigger>
                <TabsTrigger value="qr" disabled={busy || over} onClick={() => switchMethod('qr')}>
                  По QR-коду
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <StepBar method={method} status={status} />

            <div className="flex min-h-[112px] flex-col gap-3">
              {status === 'pending' && (
                <p className="text-sm text-muted-foreground">
                  {method === 'qr'
                    ? 'Подключаемся к Telegram, запрашиваем код…'
                    : 'Подключаемся к Telegram, ждём отправки кода…'}
                </p>
              )}
              {status === 'need_qr' && (
                <>
                  <QrCode svg={job?.qr_svg} />
                  <p className="text-sm text-muted-foreground">
                    В Telegram на телефоне этого аккаунта: Настройки → Устройства → Подключить
                    устройство, и наведите камеру на код. Код сам обновляется, пока его не
                    отсканировали.
                  </p>
                </>
              )}
              {status === 'need_code' && (
                <Field label="Код из Telegram / SMS">
                  <Input
                    autoFocus
                    type="password"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    className="font-mono tracking-widest"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </Field>
              )}
              {status === 'need_2fa' && (
                <Field label="Облачный пароль (2FA)">
                  <Input
                    autoFocus
                    type="password"
                    autoComplete="one-time-code"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </Field>
              )}
              {done && (
                <p className="text-sm text-success-foreground">
                  Сессия сохранена{job.username ? `, @${job.username}` : ''}. Аккаунт переведён в active.
                </p>
              )}
              {status === 'failed' && <p className="text-sm text-destructive">Не удалось: {job.error}</p>}
            </div>
            <p className="min-h-4 text-xs text-destructive">{error}</p>
          </div>

          <DialogFooter className="px-6 pt-4 pb-6">
            {over ? (
              <Button type="button" onClick={() => close(done)}>Закрыть</Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => close(false)}>Отменить</Button>
                {needsInput && (
                  <Button type="submit" disabled={busy || !value}>
                    {busy ? 'Отправка…' : 'Далее'}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
