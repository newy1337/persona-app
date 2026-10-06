import { useEffect, useRef, useState } from 'react';
import { authFlow } from '../../api/accounts';
import s from '../../styles/AdminPage.module.scss';

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
    <div className={s.steps}>
      {steps.map((st, i) => (
        <span key={st.key} className={i < idx ? s.stepDone : i === idx ? s.stepActive : s.step}>
          {st.label}
        </span>
      ))}
    </div>
  );
}

// Картинку рисует сервер: токен входа — это ключ, через чужой генератор его
// пропускать нельзя, а панель обходится без лишней зависимости.
function QrCode({ svg }) {
  if (!svg) return <p className={s.modalText}>Готовим код…</p>;
  return (
    <div
      className={s.qr}
      data-testid="login-qr"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function MethodPicker({ value, onChange, disabled }) {
  return (
    <div className={s.actions} role="group" aria-label="Способ входа">
      {[
        ['phone', 'По коду из Telegram'],
        ['qr', 'По QR-коду'],
      ].map(([key, label]) => (
        <button
          key={key}
          type="button"
          className={`${s.btnSm} ${value === key ? s.btnSelected : ''}`}
          disabled={disabled}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
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

  useEffect(() => {
    let timer;
    let alive = true;
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
    if (next === method || busy) return;
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
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <form className={s.modal} onSubmit={submit}>
        <h3 className={s.modalTitle}>Вход: {account.phone_e164}</h3>
        {!over && <MethodPicker value={method} onChange={switchMethod} disabled={busy} />}
        <StepBar method={method} status={status} />

        {status === 'pending' && (
          <p className={s.modalText}>
            {method === 'qr'
              ? 'Подключаемся к Telegram, запрашиваем код…'
              : 'Подключаемся к Telegram, ждём отправки кода…'}
          </p>
        )}
        {status === 'need_qr' && (
          <>
            <QrCode svg={job?.qr_svg} />
            <p className={s.modalText}>
              В Telegram на телефоне этого аккаунта: Настройки → Устройства → Подключить
              устройство, и наведите камеру на код. Код сам обновляется, пока его не
              отсканировали.
            </p>
          </>
        )}
        {status === 'need_code' && (
          <label className={s.label}>
            Код из Telegram / SMS
            <input className={s.field} autoFocus inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
        )}
        {status === 'need_2fa' && (
          <label className={s.label}>
            Облачный пароль (2FA)
            <input className={s.field} autoFocus type="password" value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
        )}
        {done && (
          <p className={`${s.modalText} ${s.ok}`}>
            Сессия сохранена{job.username ? `, @${job.username}` : ''}. Аккаунт переведён в active.
          </p>
        )}
        {status === 'failed' && <p className={s.error}>Не удалось: {job.error}</p>}
        {error && <p className={s.error}>{error}</p>}

        <div className={s.modalActions}>
          {over ? (
            <button type="button" className={s.btnPrimary} onClick={() => close(done)}>Закрыть</button>
          ) : (
            <>
              <button type="button" className={s.btn} onClick={() => close(false)}>Отменить</button>
              {needsInput && (
                <button type="submit" className={s.btnPrimary} disabled={busy || !value}>
                  {busy ? 'Отправка…' : 'Далее'}
                </button>
              )}
            </>
          )}
        </div>
      </form>
    </div>
  );
}
