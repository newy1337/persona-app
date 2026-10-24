import { useCallback, useEffect, useState } from 'react';
import { useMe } from '../../components/AppLayout/me';
import { PanelUX as ux } from '../../ui/PanelUX';
import { declineBuffered, getBuffer, takeBuffered } from '../../api/buffer';
import { httpHref } from '../../utils/safeUrl';
import { useRouteBusy } from '@/components/AppLayout/routeBusy';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const when = (ts) => (ts ? new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');

/** Окно отклонения: причина по желанию, лид удаляется, слепок остаётся в архиве. */
function DeclineModal({ item, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    setBusy(true); setError('');
    try { await onConfirm(reason.trim()); }
    catch (e) { setError(ux.readableError(e)); setBusy(false); }
  }
  return (
    <ux.Modal title={`Отклонить @${item.username}?`} onClose={onCancel} busy={busy} footer={<>
      <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Отмена</Button>
      <Button type="button" variant="destructive" disabled={busy} onClick={confirm}>{busy ? 'Отклоняем…' : 'Отклонить'}</Button>
    </>}>
      <p className="mb-3 text-muted-foreground">Лид удалится из буфера. Данные сохранятся в архиве отклонённых: если этот ник придёт снова, будет видно, что его уже отклоняли.</p>
      <Field label="Причина (необязательно)">
        <Input value={reason} maxLength={500} autoFocus data-autofocus onChange={(e) => setReason(e.target.value)} aria-label="Причина отклонения" />
      </Field>
      {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
    </ux.Modal>
  );
}

export function BufferTable({ items, busy, onTake, onDecline }) {
  if (!items.length) return <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">Буфер пуст.</p>;
  return (
    <div className="rounded-lg border bg-card">
      <Table aria-label="Буфер">
        <TableHeader>
          <TableRow>
            <TableHead>Ник и собеседник</TableHead>
            <TableHead>Откуда</TableHead>
            <TableHead>Получен</TableHead>
            <TableHead>История</TableHead>
            <TableHead className="w-40"><span className="sr-only">Действия</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((x) => (
            <TableRow key={x.id} data-buffer-id={x.id} className="align-top">
              <TableCell className="align-top whitespace-normal">
                <a className="font-medium text-primary hover:underline" href={`https://t.me/${x.username}`} target="_blank" rel="noreferrer"><strong>@{x.username}</strong></a>
                <div className="text-xs text-muted-foreground">{[x.first_name, x.age ? `${x.age} лет` : null, x.city].filter(Boolean).join(' · ') || '—'}</div>
                {httpHref(x.profile_url) && <div className="text-xs"><a className="text-primary hover:underline" href={httpHref(x.profile_url)} target="_blank" rel="noreferrer">профиль</a></div>}
                {x.declined_before && (
                  <div className="mt-1 text-xs text-destructive" data-testid="declined-before">
                    Уже отклоняли{x.declined_before.count > 1 ? ` ${x.declined_before.count} раза` : ''}: {when(x.declined_before.last_at)}{x.declined_before.last_reason ? ` · ${x.declined_before.last_reason}` : ''}
                  </div>
                )}
              </TableCell>
              <TableCell className="align-top text-xs whitespace-normal text-muted-foreground">
                <div>Регион {x.region_code ?? '—'} · донор {x.donor ?? '—'}</div>
                <div>{[`источник ${x.source}`, x.person ? `личность ${x.person}` : null].filter(Boolean).join(' · ')}</div>
                {(x.account || x.external_id) && <div>{[x.account ? `аккаунт ${x.account}` : null, x.external_id ? `ID ${x.external_id}` : null].filter(Boolean).join(' · ')}</div>}
                {x.reassigned && <div className="mt-1"><Badge variant="outline">перезабив</Badge></div>}
              </TableCell>
              <TableCell className="align-top text-xs tabular-nums">{when(x.buffered_at)}</TableCell>
              <TableCell className="align-top text-xs whitespace-normal">
                {x.last_messages ? (
                  <details>
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">история</summary>
                    <p className="mt-1 max-w-[360px] whitespace-pre-wrap">{x.last_messages}</p>
                  </details>
                ) : <span className="text-muted-foreground">—</span>}
              </TableCell>
              <TableCell className="align-top">
                <div className="flex flex-col items-stretch gap-1.5">
                  <Button type="button" size="sm" disabled={busy === x.id} onClick={() => onTake(x)}>Взять в работу</Button>
                  <Button type="button" variant="ghost" size="sm" className="text-destructive" disabled={busy === x.id} onClick={() => onDecline(x)}>Отклонить</Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function Buffer() {
  const [data, setData] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [declining, setDeclining] = useState(null);
  const [region, setRegion] = useState('');
  const me = useMe();

  useRouteBusy(loading);

  const load = useCallback(() => getBuffer(region).then(setData).catch((e) => setError(ux.readableError(e))).finally(() => setLoading(false)), [region]);
  useEffect(() => { load(); }, [load]);

  async function take(item) {
    setBusy(item.id); setError('');
    try { setData(await takeBuffered(item.id)); ux.toast?.(`@${item.username} — в ваших лидах`); }
    catch (e) { setError(ux.readableError(e)); }
    finally { setBusy(null); }
  }

  return (
    <div className="container">
      <PageHeader
        title="Буфер"
        description={loading ? 'загружаем…' : `в буфере: ${data.total}`}
      >
        {me?.role === 'admin' && (
          <Input className="w-48" placeholder="Регион, например 001" value={region} maxLength={4} inputMode="numeric"
            onChange={(e) => setRegion(e.target.value.replace(/\D/g, ''))} aria-label="Регион" />
        )}
      </PageHeader>
      <p className="-mt-2 mb-3 text-sm text-muted-foreground">Входящие лиды только с ником, без телефона. Возьмите в работу — лид появится у вас в «Лидах», или отклоните.</p>
      {error && <p className="mb-3 text-sm text-destructive" role="alert">{error}</p>}
      {loading ? (
        <div className="grid gap-2" role="status" aria-busy="true">
          <span className="sr-only">Загружаем буфер…</span>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      ) : <BufferTable items={data.items} busy={busy} onTake={take} onDecline={setDeclining} />}
      {declining && (
        <DeclineModal item={declining} onCancel={() => setDeclining(null)}
          onConfirm={async (reason) => { setData(await declineBuffered(declining.id, reason)); setDeclining(null); }} />
      )}
    </div>
  );
}
