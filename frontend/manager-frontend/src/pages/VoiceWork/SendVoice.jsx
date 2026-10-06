import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import { TaskChatSelect } from './TaskChat';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function DeliveryStatus({ delivery }) {
  if (!delivery) return null;
  const labels = { pending: 'В очереди на отправку', claimed: 'Отправляется…', sent: 'Голосовое отправлено', failed: 'Не отправлено', needs_review: 'Доставку нужно проверить', resolved: 'Доставку проверили вручную' };
  return <div className={cn('min-h-5 text-sm', ['failed', 'needs_review'].includes(delivery.status) ? 'text-warning-foreground' : 'text-muted-foreground')} role="status">
    {labels[delivery.status] || delivery.status} · диалог <span className="font-mono tabular-nums">{delivery.chat_id}</span>
    {delivery.error && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{delivery.error}</p>}
  </div>;
}

export function SendVoice({ item, initialChat, onClose, onChange }) {
  const [chat, setChat] = useState(initialChat), [delivery, setDelivery] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const locked = useRef(false), requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    if (!delivery || !['pending', 'claimed'].includes(delivery.status)) return;
    let active = true, pending = false;
    const timer = setInterval(async () => {
      if (pending || document.visibilityState !== 'visible') return;
      pending = true;
      try { const value = await api.get(`/api/voicer/deliveries/${delivery.id}`); if (active) { setDelivery(value); if (!['pending', 'claimed'].includes(value.status)) onChange(); } }
      catch (e) { if (active) setError(PanelUX.readableError(e)); }
      finally { pending = false; }
    }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [delivery?.id, delivery?.status, onChange]); // eslint-disable-line react-hooks/exhaustive-deps
  async function send(retry = false) {
    if (locked.current || !chat) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const result = await api.post(retry ? `/api/voicer/deliveries/${delivery.id}/retry` : `/api/voicer/recordings/${item.id}/send`, retry ? {} : { chat_id: chat, request_id: requestId.current });
      setDelivery(result); onChange();
    } catch (e) { setError(PanelUX.readableError(e)); }
    finally { locked.current = false; setBusy(false); }
  }
  return <PanelUX.Modal title="Отправить голосовое" busy={busy} onClose={onClose} footer={<>
    <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Закрыть</Button>
    {!delivery && <Button type="button" disabled={busy || !chat} onClick={() => send()}>{busy && <LoaderCircle className="animate-spin" />}{busy ? 'Добавляем в очередь…' : 'Отправить выбранному собеседнику'}</Button>}
    {delivery?.status === 'failed' && <Button type="button" disabled={busy} onClick={() => send(true)}>Повторить отправку</Button>}
  </>}>
    <div className="flex min-h-[200px] flex-col gap-3 text-sm"><p className="[overflow-wrap:anywhere]"><strong className="font-medium">{item.title}</strong><br />Голос: {item.task.personaName}</p>
      {!delivery && <TaskChatSelect sendTarget required value={chat} disabled={busy} onChange={value => { setChat(value); requestId.current = crypto.randomUUID(); }} />}
      <DeliveryStatus delivery={delivery} />
      {delivery?.status === 'sent' && <p>Запись остаётся в библиотеке. Её можно отправить в другой диалог.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  </PanelUX.Modal>;
}
