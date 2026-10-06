import { PanelUX } from '../../ui/PanelUX';
import { useCallback, useState } from 'react';
import { getVersions, restoreVersion } from '../../api/personas';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  stickyLastCol,
} from '@/components/ui/table';
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

const HEAD = 'h-10 px-3 text-xs font-medium text-muted-foreground';
const CELL = 'p-3 align-top whitespace-normal [overflow-wrap:anywhere]';

export default function VersionsTable({ versions, loading = false, onRestore }) {
  if (!versions && !loading) return null;
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <Table className={cn(stickyLastCol, 'min-w-[560px]')}>
        <TableHeader>
          <TableRow>
            <TableHead className={HEAD}>Когда</TableHead>
            <TableHead className={HEAD}>Кто</TableHead>
            <TableHead className={HEAD}>Подпись</TableHead>
            <TableHead className={HEAD}>Размер</TableHead>
            <TableHead className={HEAD}></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!versions ? (
            <>
              {[0, 1, 2].map((i) => (
                <TableRow key={i} role="status" aria-label="Загружаю историю версий">
                  <TableCell className={CELL}><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell className={CELL}><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className={CELL}><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell className={CELL}><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell className={CELL}><Skeleton className="h-8 w-20" /></TableCell>
                </TableRow>
              ))}
            </>
          ) : (
            <>
              {versions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className={cn(CELL, 'text-muted-foreground')}>Правок ещё не было</TableCell>
                </TableRow>
              )}
              {versions.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className={cn(CELL, 'font-mono text-xs text-muted-foreground tabular-nums')}>{fmtTs(v.created_at)}</TableCell>
                  <TableCell className={CELL}>{v.saved_by ?? '—'}</TableCell>
                  <TableCell className={cn(CELL, 'text-muted-foreground')}>{v.note ?? ''}</TableCell>
                  <TableCell className={cn(CELL, 'text-muted-foreground tabular-nums')}>{(v.bytes / 1024).toFixed(1)} КБ</TableCell>
                  <TableCell className={CELL}>
                    <Button variant="outline" size="sm" onClick={() => onRestore(v.id)}>Вернуть</Button>
                  </TableCell>
                </TableRow>
              ))}
            </>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
