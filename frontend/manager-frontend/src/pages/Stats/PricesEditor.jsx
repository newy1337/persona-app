import { PanelUX } from '../../ui/PanelUX';
import { useEffect, useState } from 'react';
import { getPrices, putPrices, resetPrices } from '../../api/usage';
import { Button } from '@/components/ui/button';
import { CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { EDGE, Section, TD, TH } from './StatsUi';

const FIELDS = [
  ['input', 'вход'],
  ['output', 'выход'],
  ['cache_write', 'запись кеша'],
  ['cache_read', 'чтение кеша'],
];

const TITLE = 'Цены моделей';

export default function PricesEditor({ onChanged, onError }) {
  const [table, setTable] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    getPrices()
      .then((t) => {
        setTable(t);
        setDraft(JSON.parse(JSON.stringify(t.models)));
      })
      .catch((e) => onError(e.detail || e.message));

  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!table || !draft) {
    return (
      <Section title={TITLE} className="min-h-[200px]">
        <p className="text-sm text-muted-foreground" aria-busy="true">Загружаю цены…</p>
      </Section>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(table.models);
  const set = (model, field, value) =>
    setDraft((v) => ({ ...v, [model]: { ...v[model], [field]: value } }));

  async function save() {
    setBusy(true);
    try {
      const t = await putPrices({ models: draft, families: table.families, note: table.note });
      setTable(t);
      setDraft(JSON.parse(JSON.stringify(t.models)));
      onChanged();
    } catch (e) {
      onError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!await PanelUX.confirm('Вернуть цены по умолчанию?')) return;
    setBusy(true);
    try {
      const t = await resetPrices();
      setTable(t);
      setDraft(JSON.parse(JSON.stringify(t.models)));
      onChanged();
    } catch (e) {
      onError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title={TITLE}
      className="min-h-[200px]"
      flush
      description={
        <CardDescription className="text-xs">
          USD за 1 млн токенов. {table.is_default ? 'Сейчас работают умолчания — сверьте с актуальным прайс-листом.' : 'Своя таблица.'}
          {table.note && <> {table.note}</>}
        </CardDescription>
      }
    >
      <Table className={EDGE}>
        <TableHeader>
          <TableRow>
            <TableHead className={TH}>Модель</TableHead>
            {FIELDS.map(([, label]) => <TableHead key={label} className={TH}>{label}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Object.entries(draft).map(([model, price]) => (
            <TableRow key={model}>
              <TableCell className={cn(TD, 'py-2 align-middle font-mono text-xs')}>{model}</TableCell>
              {FIELDS.map(([field]) => (
                <TableCell key={field} className={cn(TD, 'py-2 align-middle')}>
                  <Input
                    className="h-8 w-24 font-mono text-xs tabular-nums md:text-xs"
                    inputMode="decimal"
                    aria-label={`${model}: ${FIELDS.find(([f]) => f === field)[1]}`}
                    value={price[field]}
                    onChange={(e) => set(model, field, e.target.value)}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-end gap-2 border-t p-4">
        <Button variant="outline" disabled={busy || table.is_default} onClick={reset}>Вернуть умолчания</Button>
        <Button disabled={busy || !dirty} onClick={save} className="min-w-[148px]">
          {busy ? 'Сохранение…' : 'Сохранить цены'}
        </Button>
      </div>
    </Section>
  );
}
