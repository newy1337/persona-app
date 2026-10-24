import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  AudioLines,
  Ban,
  ChevronDown,
  ChevronUp,
  Download,
  Eraser,
  EyeOff,
  Images,
  LoaderCircle,
  MicVocal,
  PanelLeft,
  TriangleAlert,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { IconAction } from '@/components/IconAction/IconAction';
import { SearchInput } from '@/components/SearchInput/SearchInput';
import { accountLostLabel, whenLabel } from '../../utils/telegramStatus';
import { searchMessages } from '../../utils/scenario';
import {
  downloadChatHtml,
  getMediaGallery,
  setConversationHidden,
  setDealStage,
} from '../../api/conversations';
import { PanelUX } from '../../ui/PanelUX';

// Единственная строка над лентой, 44px: действия слева, поиск справа, все
// элементы — 32px. На широком экране она стоит вровень со строкой «К дашборду»
// в колонке клиента; на узком (колонка — выдвижная) кнопка «назад» живёт здесь.
// Те же классы собирают скелетон первой загрузки.
const BAR = 'chatToolbar shrink-0 border-b bg-background';
const BAR_ROW = 'flex h-11 items-center gap-1 px-3';
const BANNER = 'mx-4 mt-2 w-auto shrink-0';

const Spinner = (props) => <LoaderCircle {...props} className="animate-spin" />;

/** Первая загрузка: строка поиска и пять действий тех же размеров. */
export function ChatTopBarSkeleton() {
  return (
    <div className={BAR}>
      <div className={BAR_ROW}>
        <Skeleton className="mr-2 h-8 flex-1" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="size-8" />
        ))}
      </div>
    </div>
  );
}

function ChatTopBar({
  id,
  data,
  name,
  pins,
  navigate,
  busy,
  setBusy,
  setError,
  load,
  setSidebarOpen,
  msgQuery,
  setMsgQuery,
  hitPos,
  setHitPos,
  hits,
  scrollToMessage,
  setGallery,
  exporting,
  setExporting,
  exportError,
  setExportError,
  chatIds = [],
}) {
  // Соседние чаты — по списку дашборда, как в рабочей панели.
  const idx = chatIds.indexOf(Number(id));
  const goPrev = () => {
    if (idx > 0) navigate(`/conversation/${chatIds[idx - 1]}`);
  };
  const goNext = () => {
    if (idx !== -1 && idx < chatIds.length - 1) navigate(`/conversation/${chatIds[idx + 1]}`);
  };
  const searching = msgQuery.trim() !== '';
  const stepHit = (delta) => {
    if (!hits.length) return;
    const next = (hitPos + delta + hits.length) % hits.length;
    setHitPos(next);
    scrollToMessage(hits[next]);
  };

  return (
    <>
      <div className={BAR}>
        <div className={BAR_ROW}>
          {/* lg:hidden = display:none на широком экране: там доступна только
              такая же кнопка в колонке клиента. На телефоне остаётся стрелка. */}
          <Button variant="ghost" size="sm" className="backBtn shrink-0 lg:hidden" onClick={() => navigate('/')}>
            <ArrowLeft aria-hidden="true" />
            <span className="max-sm:sr-only">К дашборду</span>
          </Button>
          <IconAction
            icon={PanelLeft}
            label="Карточка клиента"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          />
          <span className="flex shrink-0 items-center" data-testid="chat-nav">
            <IconAction icon={ChevronLeft} label="Предыдущий чат" disabled={idx <= 0} onClick={goPrev} />
            <span className="min-w-[44px] px-1 text-center text-xs tabular-nums text-muted-foreground">
              <span className="text-foreground">{idx >= 0 ? idx + 1 : '—'}</span> / {chatIds.length || '—'}
            </span>
            <IconAction
              icon={ChevronRight}
              label="Следующий чат"
              disabled={idx === -1 || idx >= chatIds.length - 1}
              onClick={goNext}
            />
          </span>
          <span className="shrink-0 px-1 text-xs text-muted-foreground max-sm:hidden" title="Номер чата">
            чат <span className="tabular-nums text-foreground">{data.chat_id}</span>
          </span>
          <IconAction
            icon={Images}
            label="Медиа"
            hint="Все фото и видео переписки"
            data-testid="open-media"
            onClick={() => {
              setGallery({ items: null, loading: true, error: null });
              getMediaGallery(id)
                .then((items) => setGallery({ items, loading: false, error: null }))
                .catch((e) => setGallery({ items: [], loading: false, error: e.message }));
            }}
          />
          <IconAction
            icon={data.archived ? ArchiveRestore : Archive}
            label={data.archived ? 'Из архива' : 'В архив'}
            hint={data.archived
              ? 'Из архива: чат вернётся на дашборд, бот снова поведёт, если вёл до архива'
              : 'В архив: чат уйдёт с дашборда, бот перестанет писать. Напишет клиент — чат вернётся к менеджеру'}
            disabled={busy}
            data-testid="archive-toggle"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                if (data.archived) await setConversationHidden(id, false);
                else {
                  const note = await PanelUX.prompt({ title: 'В архив', message: 'Почему диалог уходит в архив?', value: pins.deal_note || '', confirmLabel: 'В архив' });
                  if (!note) return;
                  await setDealStage(id, 'archive', note);
                }
                load();
              } catch (e) {
                setError(e.detail || e.message);
              } finally {
                setBusy(false);
              }
            }}
          />
          <IconAction
            icon={MicVocal}
            label="Задание войсеру"
            onClick={() => navigate('/voice?' + new URLSearchParams({ compose: '1', chat: id, contact: name, manager: String(data.manager_id || ''), persona: data.persona_id || '', ref: data.client_username ? '@' + data.client_username : '' }))}
          />
          <IconAction
            icon={AudioLines}
            label="Голосовые"
            hint="Голосовые этого чата в библиотеке"
            onClick={() => navigate('/voice?' + new URLSearchParams({ tab: 'library', chat: id, persona: data.persona_id || '' }))}
          />
          {/* Кнопка одна на все три состояния: меняются только значок и подсказка. */}
          <IconAction
            icon={exporting ? Spinner : Download}
            label={exporting ? 'Собираю…' : exportError ? 'Ошибка — ещё раз' : 'Выгрузить HTML'}
            hint={exporting
              ? 'Собираю файл…'
              : exportError
                ? `Не получилось: ${exportError}. Нажмите, чтобы повторить`
                : 'Выгрузить HTML: переписка одним файлом, фото, видео, кружки и голосовые внутри'}
            className={exportError && !exporting ? 'text-destructive hover:text-destructive' : undefined}
            disabled={exporting}
            data-testid="export-html"
            onClick={async () => {
              setExporting(true);
              setExportError(null);
              try {
                await downloadChatHtml(id);
              } catch (e) {
                setExportError(e.message);
              } finally {
                setExporting(false);
              }
            }}
          />
          <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
          <SearchInput
            className="ml-auto w-64 min-w-0 max-sm:flex-1"
            placeholder="Поиск по сообщениям…"
            aria-label="Поиск по сообщениям"
            value={msgQuery}
            onChange={(v) => {
              setMsgQuery(v);
              setHitPos(0);
              const found = searchMessages(data.messages, v);
              if (found.length) scrollToMessage(found[0]);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                stepHit(e.shiftKey ? -1 : 1);
              }
              if (e.key === 'Escape') {
                setMsgQuery('');
                setHitPos(0);
              }
            }}
          />
          {/* Счётчик и стрелки смонтированы всегда: появление запроса не сдвигает панель. */}
          <span className="flex shrink-0 items-center">
            <span className="min-w-[44px] px-1 text-center text-xs tabular-nums text-muted-foreground">
              {searching ? (hits.length ? `${hitPos + 1} / ${hits.length}` : 'нет') : ''}
            </span>
            {/* На телефоне стрелки уступают место полю: по совпадениям ведут Enter / Shift+Enter. */}
            <span className="flex items-center max-sm:hidden">
              <IconAction
                icon={ChevronUp}
                label="Предыдущее совпадение"
                disabled={!searching || hits.length < 2}
                onClick={() => stepHit(-1)}
              />
              <IconAction
                icon={ChevronDown}
                label="Следующее совпадение"
                disabled={!searching || hits.length < 2}
                onClick={() => stepHit(1)}
              />
            </span>
          </span>
        </div>
      </div>

      {data.account_lost && (
        <Alert variant="destructive" className={BANNER} role="alert" data-testid="account-lost">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription className="block">
            {accountLostLabel(data.account_lost)}
            {data.account_lost.username ? ` (@${data.account_lost.username})` : ''}
            {data.account_lost.since ? ` — ${whenLabel(data.account_lost.since)}` : ''}. Сообщения из этого чата не уйдут.
          </AlertDescription>
        </Alert>
      )}
      {!data.account_lost && !data.blocked_by_client_at && data.cleared_by_client_at && (
        <Alert variant="warning" className={BANNER} role="status" data-testid="cleared-banner">
          <Eraser aria-hidden="true" />
          <AlertDescription className="block">
            Собеседник почистил диалог — {whenLabel(data.cleared_by_client_at)} удалил переписку в Telegram. В панели она сохранена (зачёркнута). Отметка снимется, когда он снова напишет.
          </AlertDescription>
        </Alert>
      )}
      {!data.account_lost && !data.blocked_by_client_at && data.likely_blocked_at && (
        <Alert variant="warning" className={BANNER} role="status" data-testid="likely-blocked-banner">
          <EyeOff aria-hidden="true" />
          <AlertDescription className="block">
            Вероятно, собеседник кинул в ЧС: {whenLabel(data.likely_blocked_at)} его статус в Telegram вдруг скрылся. Telegram о блокировке не сообщает, поэтому это не факт — так же бывает, если он скрыл статус приватностью. Отметка снимется, когда он напишет или статус снова станет виден.
          </AlertDescription>
        </Alert>
      )}
      {!data.account_lost && data.blocked_by_client_at && (
        <Alert variant="destructive" className={BANNER} role="alert" data-testid="blocked-banner">
          <Ban aria-hidden="true" />
          <AlertDescription className="block">
            Собеседник заблокировал аккаунт — {whenLabel(data.blocked_by_client_at)} сообщение не дошло. Отметка снимется, когда он снова напишет или сообщение дойдёт.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

export default ChatTopBar;
