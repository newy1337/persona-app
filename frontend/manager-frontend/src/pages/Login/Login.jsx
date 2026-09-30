import { useState } from 'react';
import { api, ApiError, setTokens } from '../../api/client';
import styles from './Login.module.scss';

export default function Login({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await api.post('/auth/login', { username, password });
      setTokens(data.tokens);
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Неверный логин или пароль'
          : err.detail || err.message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <form className={styles.card} onSubmit={submit}>
        <h1 className={styles.title}>Панель менеджера</h1>
        <input
          className={styles.field}
          placeholder="логин"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          className={styles.field}
          type="password"
          placeholder="пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className={styles.error}>{error}</p>}
        <button
          className={styles.submit}
          type="submit"
          disabled={busy || !username || !password}
        >
          {busy ? 'Вход…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
