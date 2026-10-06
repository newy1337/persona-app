import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff } from 'lucide-react';
import { api } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
const labels = { microphone: 'Подключаем микрофон…', connecting: 'Соединяем с Telegram…', ringing: 'Вызываем собеседника…', connected: 'Разговор идёт', ending: 'Завершаем соединение с Telegram…', ended: 'Звонок завершён', missed: 'Нет ответа', busy: 'Занято', failed: 'Не удалось позвонить', interrupted: 'Соединение прервано' };
export function CallPanel({ task, onActive }) {
  const [state, setState] = useState(''), [reason, setReason] = useState(''), [active, setActive] = useState(false), [muted, setMuted] = useState(false), [seconds, setSeconds] = useState(0);
  const resources = useRef(null), alive = useRef(true), startAt = useRef(0);
  function release() {
    const r = resources.current; resources.current = null;
    if (!r) return;
    r.stopped = true; r.stream?.getTracks().forEach(t => t.stop()); r.node?.disconnect();
    void r.context?.close().catch(() => {});
    if (r.socket?.readyState === WebSocket.OPEN) r.socket.send(JSON.stringify({ action: 'hangup' }));
    if (r.socket && r.socket.readyState < WebSocket.CLOSING) r.socket.close();
    onActive?.(false); if (alive.current) setActive(false);
  }
  useEffect(() => {
    alive.current = true;
    api.get(`/api/voicer/tasks/${task.id}/call`).then(row => { if (alive.current && !resources.current && row) { setState(row.status); setReason(row.reason); } }).catch(() => {});
    const timer = setInterval(() => { if (startAt.current) setSeconds(Math.max(0, Math.floor(Date.now() / 1000 - startAt.current))); }, 1000);
    return () => { alive.current = false; clearInterval(timer); release(); };
  }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function start() {
    if (resources.current) return;
    const r = { stopped: false }; resources.current = r;
    setActive(true); onActive?.(true); setMuted(false); setReason(''); setState('microphone'); setSeconds(0); startAt.current = 0;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw Error('Для микрофона откройте сайт по HTTPS в обычном браузере');
      r.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (r.stopped) { r.stream.getTracks().forEach(t => t.stop()); return; }
      r.context = new AudioContext({ sampleRate: 48000 }); await r.context.resume();
      if (r.context.sampleRate !== 48000) throw Error('Браузер не поддерживает звук 48 кГц. Попробуйте актуальный Chrome или Firefox');
      await r.context.audioWorklet.addModule('/audio/voicer-call-processor.js'); if (r.stopped) return;
      r.node = new AudioWorkletNode(r.context, 'voicer-audio', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      r.context.createMediaStreamSource(r.stream).connect(r.node); r.node.connect(r.context.destination);
      const { ticket } = await api.post(`/api/voicer/tasks/${task.id}/call/ticket`, {}); if (r.stopped) return;
      setState('connecting');
      const endpoint = new URL('/api/voicer/call/ws', window.location.href); endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
      r.socket = new WebSocket(endpoint); r.socket.binaryType = 'arraybuffer';
      r.socket.onopen = () => { if (!r.stopped) r.socket.send(JSON.stringify({ ticket })); };
      r.socket.onmessage = ({ data }) => {
        if (r.stopped) return;
        if (data instanceof ArrayBuffer) { r.node.port.postMessage(data, [data]); return; }
        const status = JSON.parse(data); setState(status.status); setReason(status.reason || '');
        if (status.connected_at) startAt.current = status.connected_at;
        if (status.ended || status.status === 'failed') { startAt.current = 0; release(); }
      };
      r.node.port.onmessage = ({ data }) => {
        if (!r.stopped && r.socket.readyState === WebSocket.OPEN) {
          if (r.socket.bufferedAmount > 96000) { setState('failed'); setReason('Соединение слишком медленное для звонка'); release(); return; }
          r.socket.send(data);
        }
      };
      r.socket.onerror = () => { if (!r.stopped) { setState('failed'); setReason('Не удалось подключиться к звонку. Обновите страницу и повторите'); release(); } };
      r.socket.onclose = () => { if (!r.stopped) { setState('ended'); setReason('Соединение закрыто'); release(); } };
    } catch (e) {
      if (!r.stopped && alive.current) { setState('failed'); setReason(e.name === 'NotAllowedError' ? 'Разрешите доступ к микрофону в настройках браузера' : e.name === 'NotFoundError' ? 'Микрофон не найден' : PanelUX.readableError(e)); release(); }
    }
  }
  function mute() { const enabled = muted; resources.current?.stream?.getAudioTracks().forEach(t => { t.enabled = enabled; }); setMuted(!muted); }
  if (!active && task.status === 'completed') return null;
  // Идущий разговор отмечает зелёная точка у статуса, а не цветная рамка блока.
  return <section className="sticky top-0 z-10 flex flex-col gap-2 rounded-lg border bg-card p-4 text-sm text-card-foreground" aria-label="Звонок с сайта">
    <strong className="font-medium">Звонок с аккаунта диалога</strong>
    {!active && <p className="text-xs text-muted-foreground">После звонка бот включится сам, если менеджер не поставит новую паузу. Итог сохраняется автоматически.</p>}
    {!task.chatId && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 shrink-0 rounded-full bg-warning-foreground" aria-hidden="true" />Менеджеру нужно привязать диалог к заданию.</p>}
    <p role="status" className="flex min-h-5 items-center gap-1.5 tabular-nums">{state && <>{state === 'connected' && <span className="size-1.5 shrink-0 rounded-full bg-success-foreground" aria-hidden="true" />}{labels[state] || state}{state === 'connected' && ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</>}</p>
    <p className={cn('min-h-4 text-xs tabular-nums', state === 'failed' ? 'text-destructive' : 'text-muted-foreground')}>{reason}</p>
    <div className="flex flex-wrap gap-2">
      {!active && <Button type="button" variant="outline" size="sm" disabled={task.status !== 'in_progress' || !task.chatId} onClick={start}><Phone aria-hidden="true" />Позвонить с сайта</Button>}
      {active && <><Button type="button" variant="outline" size="sm" onClick={mute} disabled={!resources.current?.stream}>{muted ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}{muted ? 'Включить микрофон' : 'Выключить микрофон'}</Button>
        <Button type="button" variant="destructive" size="sm" onClick={() => { setState('ended'); setReason('Вы завершили звонок'); startAt.current = 0; release(); }}><PhoneOff aria-hidden="true" />Завершить вызов</Button></>}
    </div>
  </section>;
}
