import { useCallback, useEffect, useState } from 'react';
import { PanelUX as ux } from '../../ui/PanelUX';
import { createApiKey, getApiKeys, revokeApiKey } from '../../api/apiKeys';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const when = (ts) => (ts ? new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const CODE = 'rounded bg-muted px-1 py-0.5 font-mono text-[12px]';

/** Ключи для внешних систем: создать (значение показывается один раз), отозвать. */
export default function ApiKeys() {
  const [items, setItems] = useState(null);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => getApiKeys().then((r) => setItems(r.items ?? [])).catch((e) => setError(ux.readableError(e))), []);
  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true); setError(''); setCopied(false);
    try {
      const r = await createApiKey(name.trim());
      setFresh(r);
      setName('');
      await load();
    } catch (err) { setError(ux.readableError(err)); }
    finally { setBusy(false); }
  }
  async function revoke(k) {
    if (!await ux.confirm({ title: `Отозвать ключ «${k.name}»?`, message: 'Запросы с этим ключом сразу начнут получать 401. Вернуть ключ нельзя, только создать новый.', confirmLabel: 'Отозвать', danger: true })) return;
    setError('');
    try { setItems((await revokeApiKey(k.id)).items ?? []); }
    catch (err) { setError(ux.readableError(err)); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(fresh.key); setCopied(true); }
    catch { setCopied(false); }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="API-ключи">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">API-ключи</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Для внешних систем, которые присылают лиды в <code className={CODE}>POST /api/post/leads</code> с заголовком{' '}
          <code className={CODE}>X-Api-Key</code>. Значение ключа показывается один раз при создании. Отозванный ключ
          перестаёт работать сразу.
        </p>
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <form className="flex flex-wrap items-center gap-2" onSubmit={create} aria-label="Новый ключ">
        <Input
          className="min-w-[260px] flex-1"
          value={name}
          maxLength={64}
          placeholder="Название, например «Донор Beboo»"
          aria-label="Название ключа"
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" disabled={!name.trim() || busy}>{busy ? 'Создаём…' : 'Создать ключ'}</Button>
      </form>
      {fresh && (
        <div className="flex flex-col gap-2 rounded-lg border border-success-foreground/40 bg-success-foreground/5 p-3" role="status" data-testid="fresh-key">
          <p className="text-xs text-muted-foreground">Ключ «{fresh.item.name}». Скопируйте сейчас — больше он не покажется.</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-md bg-muted px-2 py-1.5 font-mono text-[13px] [overflow-wrap:anywhere]">{fresh.key}</code>
            <Button type="button" variant="outline" size="sm" onClick={copy}>{copied ? 'Скопировано' : 'Копировать'}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setFresh(null)}>Скрыть</Button>
          </div>
        </div>
      )}
      {items === null ? (
        <div role="status" aria-label="Загружаем…" className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ключей пока нет.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table aria-label="Список ключей">
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Ключ</TableHead>
                <TableHead>Создан</TableHead>
                <TableHead>Последний запрос</TableHead>
                <TableHead>Состояние</TableHead>
                <TableHead><span className="sr-only">Действия</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((k) => (
                <TableRow key={k.id} data-key-id={k.id} data-revoked={k.revoked_at ? '1' : '0'}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell><code className={CODE}>{k.prefix}…</code></TableCell>
                  <TableCell className="tabular-nums">{when(k.created_at)}</TableCell>
                  <TableCell className="tabular-nums">{when(k.last_used_at)}</TableCell>
                  <TableCell>
                    {k.revoked_at
                      ? <Badge variant="destructive">отозван {when(k.revoked_at)}</Badge>
                      : <Badge variant="success">действует</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    {!k.revoked_at && (
                      <Button type="button" variant="ghost" size="xs" className="text-destructive hover:text-destructive" onClick={() => revoke(k)} aria-label={`Отозвать ключ ${k.name}`}>
                        Отозвать
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
