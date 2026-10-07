import { useState } from 'react';
import { Copy, ExternalLink, Send } from 'lucide-react';
import { api } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import { IconAction } from '@/components/IconAction/IconAction';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Подключение Telegram войсера: кнопка готовит одноразовую ссылку и открывает окно с ней.
 * compact — кнопка-иконка для строки таблицы; ошибку подготовки ссылки тогда
 * показывает общее уведомление панели (в строке для текста нет места).
 */
export function VoiceBotLink({ userId, linked = false, onChange, compact = false, disabled = false }) {
  const [link, setLink] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function create() {
    setBusy(true); setError('');
    try { setLink(await api.post(`/api/voicer/users/${userId}/link`, {})); }
    catch (e) { setError(PanelUX.readableError(e)); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    if (!await PanelUX.confirm({ title: 'Отключить Telegram?', message: 'Новые задания останутся в очереди до повторного подключения.', confirmLabel: 'Отключить' })) return;
    setBusy(true);
    try { await api.post(`/api/voicer/users/${userId}/disconnect`, {}); setLink(null); onChange?.(); }
    catch (e) { setError(PanelUX.readableError(e)); }
    finally { setBusy(false); }
  }
  const copy = () => PanelUX.run('voicer:copy', ['Копируем…', 'Ссылка скопирована'], () => navigator.clipboard.writeText(link.url)).catch(e => setError(PanelUX.readableError(e)));
  const label = linked ? 'Переподключить Telegram' : 'Подключить Telegram';
  return <>
    {compact
      ? <IconAction icon={Send} label={label} disabled={busy || disabled} onClick={create} />
      : <Button type="button" variant="outline" disabled={busy || disabled} onClick={create}>{busy ? 'Готовим ссылку…' : label}</Button>}
    {error && !link && !compact && <span className="text-xs text-destructive" role="alert">{error}</span>}
    {link && <PanelUX.Modal title="Подключение войсера" onClose={() => setLink(null)} busy={busy} footer={<>
      {linked && <Button type="button" variant="ghost" className="me-auto text-destructive hover:text-destructive" disabled={busy} onClick={disconnect}>Отключить текущий Telegram</Button>}
      <Button type="button" variant="outline" disabled={busy} onClick={() => setLink(null)}>Закрыть</Button>
      <Button asChild><a href={link.url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />Открыть бота</a></Button>
    </>}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">Передайте эту одноразовую ссылку войсеру. Он должен открыть её в своём Telegram и нажать «Запустить». Ссылка действует 15 минут.</p>
        <div className="flex items-center gap-1.5">
          <Input className="font-mono" aria-label="Ссылка для войсера" value={link.url} readOnly onFocus={e => e.target.select()} />
          <IconAction icon={Copy} label="Копировать ссылку" size="icon" variant="outline" onClick={copy} />
        </div>
        <div className="min-h-4 text-xs text-destructive">{error && <p role="alert">{error}</p>}</div>
      </div>
    </PanelUX.Modal>}
  </>;
}
