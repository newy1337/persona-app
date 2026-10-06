import { Archive, ArchiveRestore, AudioLines, Download, Images, Menu, MicVocal } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { accountLostLabel, whenLabel } from '../../utils/telegramStatus';
import { searchMessages } from '../../utils/scenario';
import {
  downloadChatHtml,
  getMediaGallery,
  setConversationHidden,
  setDealStage,
} from '../../api/conversations';

// Подпись кнопки: в узкой панели (уже ~900px) остаётся только иконка, а текст
// уходит в sr-only — имя кнопки для скринридера и тестов не пропадает.
const LABEL = '@max-[900px]:sr-only';
const BANNER = 'mx-4 mt-2 w-auto shrink-0';

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
}) {
  const searching = msgQuery.trim() !== '';
  const stepHit = (delta) => {
    if (!hits.length) return;
    const next = (hitPos + delta + hits.length) % hits.length;
    setHitPos(next);
    scrollToMessage(hits[next]);
  };

  return (
    <>
      <div className="@container shrink-0 border-b bg-background">
        <div className="flex items-center gap-2 px-4 py-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8 lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu />
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Input
              className="h-8 min-w-0 flex-1"
              type="text"
              placeholder="Поиск по сообщениям…"
              aria-label="Поиск по сообщениям"
              value={msgQuery}
              onChange={(e) => {
                const v = e.target.value;
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
            <span className="flex shrink-0 items-center gap-1">
              <span className="min-w-[38px] text-center font-mono text-xs tabular-nums text-muted-foreground">
                {searching ? (hits.length ? `${hitPos + 1} / ${hits.length}` : 'нет') : ''}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                disabled={!searching || hits.length < 2}
                aria-label="Предыдущее совпадение"
                onClick={() => stepHit(-1)}
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                disabled={!searching || hits.length < 2}
                aria-label="Следующее совпадение"
                onClick={() => stepHit(1)}
              >
                ↓
              </Button>
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Все фото и видео переписки"
            data-testid="open-media"
            onClick={() => {
              setGallery({ items: null, loading: true, error: null });
              getMediaGallery(id)
                .then((items) => setGallery({ items, loading: false, error: null }))
                .catch((e) => setGallery({ items: [], loading: false, error: e.message }));
            }}
          >
            <Images aria-hidden="true" />
            <span className={LABEL}>Медиа</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="@min-[900px]:min-w-[112px]"
            disabled={busy}
            data-testid="archive-toggle"
            title={data.archived
              ? 'Вернуть из архива: чат вернётся на дашборд, бот снова поведёт, если вёл до архива'
              : 'В архив: чат уйдёт с дашборда, бот перестанет писать. Напишет клиент — чат вернётся к менеджеру'}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                if (data.archived) await setConversationHidden(id, false);
                else {
                  const note = window.prompt('Почему в архив?', pins.deal_note || '');
                  if (note == null || !note.trim()) return;
                  await setDealStage(id, 'archive', note.trim());
                }
                load();
              } catch (e) {
                setError(e.detail || e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {data.archived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
            <span className={LABEL}>{data.archived ? 'Из архива' : 'В архив'}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate('/voice?' + new URLSearchParams({ compose: '1', chat: id, contact: name, manager: String(data.manager_id || ''), persona: data.persona_id || '', ref: data.client_username ? '@' + data.client_username : '' }))}
          >
            <MicVocal aria-hidden="true" />
            <span className={LABEL}>Задание войсеру</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate('/voice?' + new URLSearchParams({ tab: 'library', chat: id, persona: data.persona_id || '' }))}
          >
            <AudioLines aria-hidden="true" />
            <span className={LABEL}>Голосовые</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="@min-[900px]:min-w-[132px]"
            disabled={exporting}
            title={exportError ? `Не получилось: ${exportError}` : 'Скачать переписку одним HTML-файлом: фото, видео, кружки и голосовые внутри'}
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
          >
            <Download aria-hidden="true" />
            <span className={LABEL}>{exporting ? 'Собираю…' : exportError ? 'Ошибка — ещё раз' : 'Выгрузить HTML'}</span>
          </Button>
        </div>
      </div>

      {data.account_lost && (
        <Alert variant="destructive" className={BANNER} role="alert" data-testid="account-lost">
          <AlertDescription className="block">
            {accountLostLabel(data.account_lost)}
            {data.account_lost.username ? ` (@${data.account_lost.username})` : ''}
            {data.account_lost.since ? ` — ${whenLabel(data.account_lost.since)}` : ''}. Сообщения из этого чата не уйдут.
          </AlertDescription>
        </Alert>
      )}
      {!data.account_lost && !data.blocked_by_client_at && data.cleared_by_client_at && (
        <Alert variant="destructive" className={BANNER} role="status" data-testid="cleared-banner">
          <AlertDescription className="block">
            Собеседник почистил диалог — {whenLabel(data.cleared_by_client_at)} удалил переписку в Telegram. В панели она сохранена (зачёркнута). Отметка снимется, когда он снова напишет.
          </AlertDescription>
        </Alert>
      )}
      {!data.account_lost && data.blocked_by_client_at && (
        <Alert variant="destructive" className={BANNER} role="alert" data-testid="blocked-banner">
          <AlertDescription className="block">
            Собеседник заблокировал аккаунт — {whenLabel(data.blocked_by_client_at)} сообщение не дошло. Отметка снимется, когда он снова напишет или сообщение дойдёт.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

export default ChatTopBar;
