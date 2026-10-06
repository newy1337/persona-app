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
      <Card className="w-[360px] max-w-full gap-4 py-6">
        <CardHeader className="px-6">
          <h1 className="text-lg leading-none font-semibold">Панель менеджера</h1>
        </CardHeader>
        <CardContent className="px-6">
          <form className="flex flex-col gap-2" onSubmit={submit}>
            <Field label="Логин">
              <Input
                placeholder="логин"
                autoFocus
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field>
            <Field label="Пароль">
              <Input
                type="password"
                placeholder="пароль"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <p className="min-h-5 text-sm text-destructive" role="alert">{error}</p>
            <Button type="submit" size="lg" className="w-full" disabled={busy || !username || !password}>
              {busy ? 'Вход…' : 'Войти'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
