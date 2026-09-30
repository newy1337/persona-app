import { useEffect, useRef, useState } from 'react';
import { authFlow } from '../../api/accounts';
import s from '../../styles/AdminPage.module.scss';

const STEPS = [
  { key: 'pending', label: 'связь' },
  { key: 'need_code', label: 'код' },
  { key: 'need_2fa', label: '2FA' },
  { key: 'ok', label: 'готово' },
];
const ORDER = STEPS.map((x) => x.key);

function StepBar({ status }) {
  const idx = Math.max(0, ORDER.indexOf(status === 'failed' ? 'pending' : status));
  return (
    <div className={s.steps}>
      {STEPS.map((st, i) => (
        <span key={st.key} className={i < idx ? s.stepDone : i === idx ? s.stepActive : s.step}>
          {st.label}
        </span>
      ))}
    </div>
  );
}

export default function AuthWizard({ account, onClose }) {
  const [job, setJob] = useState(null);
  const [error, setError] = useState(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const jobRef = useRef(null);

  useEffect(() => {
    let timer;
    let alive = true;
    authFlow
      .start(account.id)
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
  }, [account.id]);

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

  const status = job?.status ?? 'pending';
  const waiting = status === 'pending';
  const done = status === 'ok';

  return (
    <div className={s.overlay} onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
      <form className={s.modal} onSubmit={submit}>
        <h3 className={s.modalTitle}>Вход: {account.phone_e164}</h3>
        <StepBar status={status} />

        {status === 'pending' && <p className={s.modalText}>Подключаемся к Telegram, ждём отправки кода…</p>}
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
          {done || status === 'failed' ? (
            <button type="button" className={s.btnPrimary} onClick={() => close(done)}>Закрыть</button>
          ) : (
            <>
              <button type="button" className={s.btn} onClick={() => close(false)}>Отменить</button>
              <button type="submit" className={s.btnPrimary} disabled={waiting || busy || !value}>
                {busy ? 'Отправка…' : 'Далее'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
