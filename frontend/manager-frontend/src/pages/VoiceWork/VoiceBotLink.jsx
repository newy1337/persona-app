import { useState } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import { api } from '../../api/client';
import { PanelUX } from '../../ui/PanelUX';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function VoiceBotLink({ userId, linked = false, onChange }) {
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
  return <>
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={create}>{busy ? 'Готовим ссылку…' : linked ? 'Переподключить Telegram' : 'Подключить Telegram'}</Button>
    {error && <span className="text-sm text-destructive" role="alert">{error}</span>}
    {link && <PanelUX.Modal title="Подключение войсера" onClose={() => setLink(null)} busy={busy} footer={<Button type="button" variant="outline" disabled={busy} onClick={() => setLink(null)}>Закрыть</Button>}>
      <div className="flex flex-col gap-3 text-sm">
        <p>Передайте эту одноразовую ссылку войсеру. Он должен открыть её в своём Telegram и нажать «Запустить». Ссылка действует 15 минут.</p>
        <Button asChild className="self-start"><a href={link.url} target="_blank" rel="noreferrer"><ExternalLink />Открыть бота</a></Button>
        <Input className="font-mono" aria-label="Ссылка для войсера" value={link.url} readOnly onFocus={e => e.target.select()} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => PanelUX.run('voicer:copy', ['Копируем…', 'Ссылка скопирована'], () => navigator.clipboard.writeText(link.url)).catch(e => setError(PanelUX.readableError(e)))}><Copy />Копировать ссылку</Button>
          {linked && <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={disconnect}>Отключить текущий Telegram</Button>}
        </div>
      </div>
    </PanelUX.Modal>}
  </>;
}
