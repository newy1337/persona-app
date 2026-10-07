import { useState } from 'react';
import { api, ApiError, setTokens } from '../../api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

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
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm gap-5">
        <CardHeader>
          <h1 className="text-lg leading-none font-semibold tracking-tight">Панель менеджера</h1>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <Field label="Логин">
              <Input
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
            <Field label="Пароль">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {/* Строка ошибки занята всегда: карточка не меняет высоту. */}
            <p className="min-h-4 text-xs leading-4 text-destructive" role="alert">{error}</p>
            <Button type="submit" className="w-full" disabled={busy || !username || !password}>
              {busy ? 'Вход…' : 'Войти'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
