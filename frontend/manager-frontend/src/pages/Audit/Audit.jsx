import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRouteBusy } from '@/components/AppLayout/routeBusy';
import { PageHeader } from '@/components/PageHeader/PageHeader';
import { SearchInput } from '@/components/SearchInput/SearchInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getAudit } from '../../api/audit';

// Журнал действий в панели: кто, что, над чем и чем закончилось. Только
// админу. Новые сверху, по 100, «Показать ещё» листает назад. Строка
// раскрывается — видно, с какими данными было действие.

/** Разделы журнала — начало имени действия. */
export const AREAS = [
  ['', 'Все действия'],
  ['conversation', 'Диалоги'],
  ['operator', 'Перехват чатов'],
  ['lead', 'Лиды'],
  ['persona', 'Личности'],
  ['tg_account', 'Аккаунты'],
  ['manager', 'Команда'],
  ['voicer', 'Войсер'],
  ['photo_set', 'Образы'],
  ['buffer', 'Буфер'],
  ['settings', 'Настройки бота'],
  ['quick_replies', 'Шаблоны ответов'],
  ['auth', 'Входы'],
];

const LABELS = {
  'auth.login': 'Вход в панель',
  'conversation.manual_message': 'Написал в чат',
  'conversation.pause': 'Забрал чат у бота',
  'conversation.resume': 'Отдал чат боту',
  'conversation.deal_stage': 'Сменил этап сделки',
  'conversation.hide': 'Убрал диалог в архив',
  'conversation.unhide': 'Вернул диалог из архива',
  'conversation.edit_message': 'Изменил сообщение',
  'conversation.note': 'Заметка к чату',
  'conversation.answer': 'Попросил бота ответить',
  'conversation.reaction': 'Реакция',
  'conversation.attachment': 'Отправил файл',
  'conversation.album': 'Отправил альбом',
  'conversation.export_html': 'Выгрузил переписку',
  'lead.create': 'Добавил лида',
  'lead.import': 'Импорт лидов',
  'lead.update': 'Изменил лида',
  'lead.delete': 'Удалил лида',
  'lead.queue': 'Поставил лидов в очередь',
  'lead.unqueue': 'Снял лидов с очереди',
  'lead.write_from_another': 'Написать с другого аккаунта',
  'persona.section': 'Изменил раздел личности',
  'persona.update': 'Изменил личность',
  'persona.create': 'Создал личность',
  'persona.delete': 'Удалил личность',
  'persona.restore': 'Вернул версию личности',
  'persona.import': 'Загрузил личность из файла',
  'tg_account.add': 'Добавил аккаунт',
  'tg_account.delete': 'Удалил аккаунт',
  'tg_account.set_status': 'Сменил статус аккаунта',
  'tg_account.set_proxy': 'Сменил прокси',
  'tg_account.auth': 'Вход в аккаунт',
  'manager.create': 'Добавил сотрудника',
  'manager.update': 'Изменил сотрудника',
  'manager.delete': 'Удалил сотрудника',
  'manager.assign': 'Назначил менеджера',
  'manager.password_regenerate': 'Новый пароль сотруднику',
  'manager.credentials_view': 'Посмотрел пароль сотрудника',
  'settings.update': 'Изменил настройки бота',
  'quick_replies.update': 'Изменил шаблоны ответов',
  'operator.takeover': 'Перехватил чат',
  'operator.resume': 'Вернул чат боту',
  'operator.emergency_stop_engage': 'Аварийная остановка',
  'operator.emergency_stop_clear': 'Снял аварийную остановку',
};
export const actionLabel = (action) => LABELS[action] ?? action;

const fmt = (ts) =>
  new Date(ts * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function pretty(payload) {
  if (!payload) return null;
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

export default function Audit() {
  const [filters, setFilters] = useState({ userId: '', action: '', failed: false, q: '' });
  const [qInput, setQInput] = useState('');
  const [data, setData] = useState(null);
  const [more, setMore] = useState(false);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const [loadingMore, setLoadingMore] = useState(false);
  const request = useRef(0);
  useRouteBusy(data === null && !error);

  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.q === qInput ? f : { ...f, q: qInput })), 300);
    return () => clearTimeout(t);
  }, [qInput]);

  const load = useCallback((before) => {
    const id = ++request.current;
    return getAudit({ ...filters, before }).then((r) => {
      if (id !== request.current) return;
      setUsers(r.users ?? []);
      setMore(Boolean(r.more));
      setData((cur) => (before ? [...(cur ?? []), ...r.items] : r.items));
      setError(null);
    }).catch((e) => setError(e.detail || e.message));
  }, [filters]);

  useEffect(() => {
    setData(null);
    setOpen(new Set());
    load();
  }, [load]);

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }));
  const toggle = (id) => setOpen((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <div className="container pb-8">
      <PageHeader title="Журнал" description="Кто и что делал в панели: правки личностей, этапы, лиды, аккаунты, входы. Нажмите на строку — увидите подробности." />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <NativeSelect aria-label="Раздел" className="w-auto" value={filters.action} onChange={(e) => set({ action: e.target.value })}>
          {AREAS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Кто" className="w-auto" value={filters.userId} onChange={(e) => set({ userId: e.target.value })}>
          <option value="">Все сотрудники</option>
          {users.map((u) => <option key={u.id} value={u.id}>{`${u.username} · ${u.role}`}</option>)}
        </NativeSelect>
        <Label className="h-8 cursor-pointer gap-1.5 px-1 text-sm font-normal">
          <NativeCheckbox checked={filters.failed} onChange={(e) => set({ failed: e.target.checked })} />
          Только ошибки
        </Label>
        <SearchInput className="ml-auto w-full sm:w-72" aria-label="Поиск в журнале" placeholder="Номер, id чата, имя…" value={qInput} onChange={setQInput} />
      </div>

      {error && <p className="mb-3 text-sm text-destructive" role="alert">{error}</p>}

      <div className="overflow-hidden rounded-lg border bg-card">
        <Table aria-label="Журнал действий">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-8" />
              <TableHead className="w-40">Когда</TableHead>
              <TableHead className="w-44">Кто</TableHead>
              <TableHead>Действие</TableHead>
              <TableHead>Над чем</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data === null && Array.from({ length: 8 }, (_, i) => (
              <TableRow key={i} className="hover:bg-transparent">
                {[8, 28, 24, 40, 32].map((w, k) => <TableCell key={k}><Skeleton className="h-4" style={{ width: w * 4 }} /></TableCell>)}
              </TableRow>
            ))}
            {data?.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">По этим условиям записей нет</TableCell>
              </TableRow>
            )}
            {data?.map((r) => {
              const expanded = open.has(r.id);
              const failed = r.result === 'failure';
              const details = pretty(r.payload);
              return (
                <Fragment key={r.id}>
                  <TableRow
                    data-audit-id={r.id}
                    className={cn('cursor-pointer', failed && 'bg-destructive/10 hover:bg-destructive/15')}
                    onClick={() => toggle(r.id)}
                  >
                    <TableCell className="text-muted-foreground">
                      <ChevronRight aria-hidden="true" className={cn('size-4 transition-transform', expanded && 'rotate-90')} />
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{fmt(r.ts)}</TableCell>
                    <TableCell>{r.username ?? <span className="text-muted-foreground">система</span>}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        {actionLabel(r.action)}
                        {failed && <Badge variant="destructive" className="h-5">ошибка</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[360px] truncate font-mono text-xs text-muted-foreground" title={r.resource ?? undefined}>{r.resource ?? '—'}</TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30" data-testid="audit-details">
                      <TableCell />
                      <TableCell colSpan={4} className="whitespace-normal">
                        <p className="mb-1 font-mono text-xs text-muted-foreground">{r.action}</p>
                        {r.error && <p className="mb-2 text-sm text-destructive">{r.error}</p>}
                        {details ? (
                          <pre className="max-h-64 overflow-auto rounded-md bg-background p-2 text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{details}</pre>
                        ) : (
                          <p className="text-xs text-muted-foreground">Без данных</p>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {more && data && (
        <div className="mt-3 flex justify-center">
          <Button
            variant="outline"
            disabled={loadingMore}
            onClick={async () => {
              setLoadingMore(true);
              await load(data[data.length - 1].id);
              setLoadingMore(false);
            }}
          >
            {loadingMore ? 'Загружаю…' : 'Показать ещё'}
          </Button>
        </div>
      )}
    </div>
  );
}
