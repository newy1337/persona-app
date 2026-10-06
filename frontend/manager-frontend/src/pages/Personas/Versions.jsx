import { PanelUX } from '../../ui/PanelUX';
import { useCallback, useState } from 'react';
import { getVersions, restoreVersion } from '../../api/personas';
import { RotateCcw } from 'lucide-react';
import { IconAction } from '@/components/IconAction/IconAction';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function ago(ms) {
  const sec = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (sec < 60) return `${sec} с назад`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} мин назад`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} ч назад` : `${Math.round(h / 24)} дн назад`;
}

export function useVersions(personaId, section, { onRestored, onError }) {
  const [versions, setVersions] = useState(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (loading) return;
    if (versions) {
      setVersions(null);
      return;
    }
    setLoading(true);
    try {
      setVersions((await getVersions(personaId, section)).items);
    } catch (e) {
      onError(e.detail || e.message);
    } finally {
      setLoading(false);
    }
  }, [versions, loading, personaId, section, onError]);

  const restore = useCallback(
    async (versionId) => {
      if (!await PanelUX.confirm('Вернуть эту версию? Текущий документ тоже уйдёт в историю.')) return;
      try {
        await restoreVersion(personaId, section, versionId);
        setVersions(null);
        onRestored();
      } catch (e) {
        onError(e.detail || e.message);
      }
    },
    [personaId, section, onRestored, onError],
  );

  const hide = useCallback(() => {
    setVersions(null);
    setLoading(false);
  }, []);
  return { versions, loading, open: versions !== null || loading, toggle, restore, hide };
}

// Список версий — строки с разделителями на приглушённой подложке внутри блока
// личности (рамка в рамке не нужна). Заглушка собрана из той же строки.
const ROW = 'flex h-11 items-center gap-3 px-3 text-sm';
const WHEN = 'w-24 shrink-0 text-xs text-muted-foreground tabular-nums';
const WHO = 'w-28 shrink-0 truncate';
const NOTE = 'min-w-0 flex-1 truncate text-muted-foreground';
const SIZE = 'w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums';

export default function VersionsTable({ versions, loading = false, onRestore }) {
  if (!versions && !loading) return null;
  return (
    <ul className="divide-y rounded-md bg-muted/40" aria-label="История версий">
      {!versions ? (
        [0, 1, 2].map((i) => (
          <li key={i} className={ROW} role="status" aria-label="Загружаю историю версий">
            <span className={WHEN}><Skeleton className="h-4 w-20" /></span>
            <span className={WHO}><Skeleton className="h-4 w-20" /></span>
            <span className={NOTE}><Skeleton className="h-4 w-40 max-w-full" /></span>
            <span className={SIZE}><Skeleton className="ml-auto h-4 w-12" /></span>
            <Skeleton className="size-8 shrink-0" />
          </li>
        ))
      ) : (
        <>
          {versions.length === 0 && <li className={cn(ROW, 'text-muted-foreground')}>Правок ещё не было</li>}
          {versions.map((v) => (
            <li key={v.id} className={ROW}>
              <span className={WHEN}>{fmtTs(v.created_at)}</span>
              <span className={WHO} title={v.saved_by ?? undefined}>{v.saved_by ?? '—'}</span>
              <span className={NOTE} title={v.note ?? undefined}>{v.note ?? ''}</span>
              <span className={SIZE}>{(v.bytes / 1024).toFixed(1)} КБ</span>
              <IconAction icon={RotateCcw} label="Вернуть" hint="Вернуть эту версию" onClick={() => onRestore(v.id)} />
            </li>
          ))}
        </>
      )}
    </ul>
  );
}
