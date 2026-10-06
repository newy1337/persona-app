import styles from './ConversationPage.module.scss';
import { accountLostLabel, whenLabel } from '../../utils/telegramStatus';
import { searchMessages } from '../../utils/scenario';
import {
  downloadChatHtml,
  getMediaGallery,
  setConversationHidden,
  setDealStage,
} from '../../api/conversations';
import { MenuIcon } from '../../assets/icons';

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
  return (
    <>
      <div className={styles.chatTopBar}>
        <button className={styles.sidebarToggle} onClick={() => setSidebarOpen(true)}>
          <MenuIcon />
        </button>
        <div className={styles.msgSearch}>
          <input
            className={styles.msgSearchInput}
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
          />
          {msgQuery.trim() !== '' && (
            <span className={styles.msgSearchNav}>
              <span className={styles.msgSearchCount}>
                {hits.length ? `${hitPos + 1} / ${hits.length}` : 'нет'}
              </span>
              <button
                className={styles.msgSearchBtn}
                disabled={hits.length < 2}
                aria-label="Предыдущее совпадение"
                onClick={() => {
                  const next = (hitPos - 1 + hits.length) % hits.length;
                  setHitPos(next);
                  scrollToMessage(hits[next]);
                }}
              >
                ↑
              </button>
              <button
                className={styles.msgSearchBtn}
                disabled={hits.length < 2}
                aria-label="Следующее совпадение"
                onClick={() => {
                  const next = (hitPos + 1) % hits.length;
                  setHitPos(next);
                  scrollToMessage(hits[next]);
                }}
              >
                ↓
              </button>
            </span>
          )}
        </div>
      <button
        type="button"
        className={styles.exportBtn}
        title="Все фото и видео переписки"
        data-testid="open-media"
        onClick={() => {
          setGallery({ items: null, loading: true, error: null });
          getMediaGallery(id)
            .then((items) => setGallery({ items, loading: false, error: null }))
            .catch((e) => setGallery({ items: [], loading: false, error: e.message }));
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" />
        </svg>
        <span className={styles.exportLabel}>Медиа</span>
      </button>
      <button
        type="button"
        className={styles.exportBtn}
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
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" />
        </svg>
        <span className={styles.exportLabel}>{data.archived ? 'Из архива' : 'В архив'}</span>
      </button>
      <button type="button" className={styles.exportBtn} onClick={() => navigate('/voice?' + new URLSearchParams({ compose: '1', chat: id, contact: name, manager: String(data.manager_id || ''), persona: data.persona_id || '', ref: data.client_username ? '@' + data.client_username : '' }))}>Задание войсеру</button>
      <button type="button" className={styles.exportBtn} onClick={() => navigate('/voice?' + new URLSearchParams({ tab: 'library', chat: id, persona: data.persona_id || '' }))}>Голосовые</button>
      <button
        type="button"
        className={styles.exportBtn}
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
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
        </svg>
        <span className={styles.exportLabel}>{exporting ? 'Собираю…' : exportError ? 'Ошибка — ещё раз' : 'Выгрузить HTML'}</span>
      </button>
      </div>

      {data.account_lost && (
        <div className={styles.lostBanner} role="alert" data-testid="account-lost">
          {accountLostLabel(data.account_lost)}
          {data.account_lost.username ? ` (@${data.account_lost.username})` : ''}
          {data.account_lost.since ? ` — ${whenLabel(data.account_lost.since)}` : ''}. Сообщения из этого чата не уйдут.
        </div>
      )}
      {!data.account_lost && !data.blocked_by_client_at && data.cleared_by_client_at && (
        <div className={styles.lostBanner} role="status" data-testid="cleared-banner">
          Собеседник почистил диалог — {whenLabel(data.cleared_by_client_at)} удалил переписку в Telegram. В панели она сохранена (зачёркнута). Отметка снимется, когда он снова напишет.
        </div>
      )}
      {!data.account_lost && data.blocked_by_client_at && (
        <div className={styles.lostBanner} role="alert" data-testid="blocked-banner">
          Собеседник заблокировал аккаунт — {whenLabel(data.blocked_by_client_at)} сообщение не дошло. Отметка снимется, когда он снова напишет или сообщение дойдёт.
        </div>
      )}
    </>
  );
}

export default ChatTopBar;
