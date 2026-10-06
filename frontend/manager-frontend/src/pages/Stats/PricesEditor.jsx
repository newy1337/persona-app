import { PanelUX } from '../../ui/PanelUX';
import { useEffect, useState } from 'react';
import { getPrices, putPrices, resetPrices } from '../../api/usage';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { TD, TH } from './StatsUi';

const FIELDS = [
  ['input', 'вход'],
  ['output', 'выход'],
  ['cache_write', 'запись кеша'],
  ['cache_read', 'чтение кеша'],
];

const CELL = cn(TD, 'py-1.5 align-middle');
const PRICE = 'h-8 w-24';
const SKELETON_ROWS = 4;

// Содержимое окна живёт только пока окно открыто: цены запрашиваются при каждом
// открытии. Таблица одна и на загрузку, и на данные — меняются только строки.
function PricesForm({ onChanged, onClose }) {
  const [table, setTable] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const take = (t) => {
    setTable(t);
    setDraft(JSON.parse(JSON.stringify(t.models)));
  };
  const fail = (e) => setError(e.detail || e.message);

  useEffect(() => {
    getPrices().then(take).catch(fail);
  }, []);

  const ready = Boolean(table && draft);
  const dirty = ready && JSON.stringify(draft) !== JSON.stringify(table.models);
  const set = (model, field, value) =>
    setDraft((v) => ({ ...v, [model]: { ...v[model], [field]: value } }));

  async function save(e) {
    e.preventDefault();
    if (busy || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      take(await putPrices({ models: draft, families: table.families, note: table.note }));
      onChanged();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!await PanelUX.confirm('Вернуть цены по умолчанию?')) return;
    setBusy(true);
    setError(null);
    try {
      take(await resetPrices());
      onChanged();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex min-h-0 flex-col" aria-busy={!ready || undefined}>
      <DialogHeader className="border-b px-6 py-4">
        <DialogTitle>Цены моделей</DialogTitle>
        <DialogDescription className="min-h-5">
          USD за 1 млн токенов.
          {ready && (table.is_default ? ' Сейчас работают умолчания — сверьте с актуальным прайс-листом.' : ' Своя таблица.')}
          {ready && table.note && <> {table.note}</>}
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-[220px] overflow-y-auto [scrollbar-gutter:stable]">
        <Table className="[&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6">
          <TableHeader>
            <TableRow>
              <TableHead className={TH}>Модель</TableHead>
              {FIELDS.map(([, label]) => <TableHead key={label} className={TH}>{label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {!ready &&
              Array.from({ length: SKELETON_ROWS }, (_, r) => (
                <TableRow key={r} className="hover:bg-transparent">
                  <TableCell className={CELL}><Skeleton className="h-5 w-40 max-w-full" /></TableCell>
                  {FIELDS.map(([field]) => (
                    <TableCell key={field} className={CELL}><Skeleton className={PRICE} /></TableCell>
                  ))}
                </TableRow>
              ))}
            {ready &&
              Object.entries(draft).map(([model, price]) => (
                <TableRow key={model} className="hover:bg-transparent">
                  <TableCell className={cn(CELL, 'font-mono text-xs')}>{model}</TableCell>
                  {FIELDS.map(([field, label]) => (
                    <TableCell key={field} className={CELL}>
                      <Input
                        className={cn(PRICE, 'tabular-nums')}
                        inputMode="decimal"
                        aria-label={`${model}: ${label}`}
                        value={price[field]}
                        onChange={(e) => set(model, field, e.target.value)}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <DialogFooter className="items-center border-t px-6 py-4">
        <p className="min-h-4 min-w-0 flex-1 text-xs text-destructive" role="status">{error || ''}</p>
        <Button type="button" variant="ghost" disabled={busy || !ready || table.is_default} onClick={reset}>
          Вернуть умолчания
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
        <Button type="submit" disabled={busy || !dirty} className="min-w-[148px]">
          {busy ? 'Сохранение…' : 'Сохранить цены'}
        </Button>
      </DialogFooter>
    </form>
  );
}

export default function PricesEditor({ open, onOpenChange, onChanged }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent portal={false} showCloseButton={false} className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <PricesForm onChanged={onChanged} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
