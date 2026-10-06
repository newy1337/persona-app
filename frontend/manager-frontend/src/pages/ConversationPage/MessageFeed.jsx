import styles from './ConversationPage.module.scss';
import { AVATAR_BG } from '../../utils/avatar';
import ClientAvatar, { ACTIVITY_LABEL } from '../../components/ClientAvatar/ClientAvatar';
import VoicePlayer from '../../components/VoicePlayer/VoicePlayer';
import {
  authorClass,
  mediaKind,
  mediaUrl,
  telegramReadMark,
  withToken,
} from '../../utils/chat';
import { markListened as markListenedApi } from '../../api/conversations';
import EmojiPicker from '../../components/composer/EmojiPicker';
import composer from '../../components/composer/Composer.module.scss';
import { REACTION_EMOJI } from '../../utils/reactions';
import { ShortIcon } from '../../assets/icons';

const JUMP_SHOW_PX = 400;

function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' });
}

const listened = new Set();
function markListened(chatId, msg) {
  if (msg.role !== 'user' || listened.has(msg.id)) return;
  listened.add(msg.id);
  markListenedApi(chatId, msg.id).catch(() => {
    listened.delete(msg.id);
  });
}

function MediaContent({ chatId, msg, inbound = null }) {
  if (msg.media_kind && msg.media_url) {
    const raw = String(msg.content || '');
    const caption = raw.startsWith('[') ? raw.split('\n').slice(1).join('\n').trim() : raw;
    const label = caption ? <p>{caption}</p> : null;
    const src = withToken(msg.media_url);
    if (msg.media_kind === 'photo' || msg.media_kind === 'sticker') {
      return <>
        <a href={src} target="_blank" rel="noreferrer"><img className={styles.mediaItem} src={src} alt={caption || 'Вложение'} loading="lazy" /></a>
        {label}
      </>;
    }
    if (msg.media_kind === 'video_note') {
      return <>
        <video className={`${styles.mediaItem} ${styles.videoNote}`} src={src} controls playsInline preload="metadata" />
        {label}
      </>;
    }
    if (msg.media_kind === 'animation' || msg.media_kind === 'video') {
      const gif = msg.media_kind === 'animation';
      return <>
        <video className={styles.mediaItem} src={src} controls={!gif} autoPlay={gif} loop={gif} muted={gif} playsInline preload="metadata" />
        {label}
      </>;
    }
    if (msg.media_kind === 'voice') {
      return <>
        <VoicePlayer src={withToken(msg.media_url)} onListened={() => markListened(chatId, msg)} />
        {label}
      </>;
    }
    const named = /^\[[^:\]]+:\s*([^\]]+)\]/.exec(raw)?.[1]?.trim();
    return (
      <>
        <a className={styles.fileLink} href={src} target="_blank" rel="noreferrer" download={named || undefined}>
          <span className={styles.fileIcon} aria-hidden="true">📎</span>
          {named || caption || 'Файл'}
        </a>
        {named && caption ? <p>{caption}</p> : label}
      </>
    );
  }
  const kind = mediaKind(msg.content);
  const src = mediaUrl(chatId, msg.ts);
  const text = String(msg.content || '');
  if (!kind && inbound && text.startsWith('[')) {
    const k = inbound.kind;
    const caption = text.split('\n').slice(1).join('\n').trim();
    const label = caption ? <p>{caption}</p> : null;
    let body = null;
    if (k === 'photo') body = <img className={styles.mediaItem} src={src} alt="Фото клиента" />;
    else if (k === 'video_note') body = <video className={`${styles.mediaItem} ${styles.videoNote}`} src={src} controls playsInline preload="metadata" />;
    else if (k === 'video') body = <video className={styles.mediaItem} src={src} controls playsInline preload="metadata" />;
    else if (k === 'animation') body = <video className={styles.mediaItem} src={src} autoPlay loop muted playsInline preload="metadata" />;
    else if (k === 'voice' || k === 'audio' || k === 'audio_note') body = <VoicePlayer src={src} />;
    if (body) return <>{body}{label}</>;
  }
  if (!kind) {
    return text.split('\n\n').map((para, j) => <p key={j}>{para}</p>);
  }
  if (kind === 'photo') {
    return <img className={styles.mediaItem} src={src} alt="Фото" />;
  }
  if (kind === 'video' || kind === 'video_note') {
    return <video className={styles.mediaItem} src={src} controls preload="metadata" />;
  }
  if (kind === 'audio' || kind === 'voice' || kind === 'audio_note') {
    return <VoicePlayer src={src} />;
  }
  return <p>{msg.content}</p>;
}

export function pickerPlacement(rect, viewport = { width: window.innerWidth, height: window.innerHeight }) {
  const PANEL_W = 272;
  const PANEL_H = 300;
  const left = Math.max(8, Math.min(rect.left, viewport.width - PANEL_W - 8));
  return rect.top > PANEL_H + 16
    ? { left, bottom: viewport.height - rect.top + 6 }
    : { left, top: Math.min(rect.bottom + 6, viewport.height - PANEL_H - 8) };
}

export function canEdit(msg, kind) {
  if (!msg?.id || !msg.tg_msg_id || msg.deleted_at || msg.media_kind) return false;
  if (kind === 'client' || msg.role === 'user') return false;
  const text = String(msg.content || '');
  return Boolean(text.trim()) && !/^\[(media:|Реакция|фото|видео|гиф|голосовое|кружок|файл)/i.test(text);
}

function MessageFeed({
  id,
  data,
  name,
  messages,
  messagesRef,
  atBottomRef,
  rowRefs,
  readUpTo,
  highlight,
  hits,
  stickyDate,
  jump,
  setJump,
  editing,
  setEditing,
  saveEdit,
  busy,
  findInboundMedia,
  setReply,
  reactFor,
  setReactFor,
  react,
}) {
  return (
    <div
      className={styles.messages}
      ref={messagesRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottomRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        const far = el.scrollHeight - el.scrollTop - el.clientHeight > JUMP_SHOW_PX;
        setJump((j) => (far === j.show && (far || !j.unseen) ? j : { show: far, unseen: far ? j.unseen : 0 }));
        if (reactFor) setReactFor(null);
      }}
    >
      {stickyDate && (
        <div className={styles.dateSticky} aria-hidden="true">{stickyDate}</div>
      )}
      {messages.map((msg, i) => {
        const kind = authorClass(msg);
        const isRead = i <= readUpTo;
        const tgMark = telegramReadMark(msg, kind);
        return (
          <div
            key={`${msg.ts}-${i}`}
            data-idx={i}
            ref={(el) => { rowRefs.current[i] = el; }}
            className={[
              styles.msgRow,
              kind === 'client' ? styles.msgClient : styles.msgAI,
              kind === 'client' && !isRead ? styles.msgUnread : '',
              highlight === i ? styles.msgHighlight : '',
              hits.includes(i) ? styles.msgHit : '',
              msg.deleted_at ? styles.msgDeleted : '',
            ].filter(Boolean).join(' ')}
          >
            <div className={styles.msgInner}>
              {kind === 'client' && (
                <ClientAvatar className={styles.clientAvatar} style={{ '--av-bg': AVATAR_BG.blue }} src={data.client_avatar} name={name} />
              )}
              <div className={styles.msgContent}>
                {kind !== 'client' && (
                  <div className={styles.msgMeta}>
                    {kind === 'manager' ? (
                      <span className={styles.tagManaged}><ShortIcon /> Менеджер</span>
                    ) : (
                      <span className={styles.tagAI}><ShortIcon /> Бот</span>
                    )}
                  </div>
                )}
                <div
                  className={`${styles.msgBubble} ${kind === 'manager' ? styles.msgBubbleManaged : ''} ${kind === 'bot' ? styles.msgBubbleAI : ''}`}
                >
                  {msg.reply_to && (
                    <span className={composer.quoted}>
                      {(messages.find((x) => x.tg_msg_id === msg.reply_to)?.content ?? 'сообщение').slice(0, 120)}
                    </span>
                  )}
                  {editing && editing.id === msg.id ? (
                    <div className={styles.editBox} data-testid="edit-box">
                      <textarea
                        className={styles.editField}
                        value={editing.text}
                        autoFocus
                        rows={Math.min(8, Math.max(2, editing.text.split('\n').length))}
                        onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            saveEdit();
                          }
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                      <div className={styles.editActions}>
                        <span className={styles.editHint}>Enter — сохранить, Esc — отмена. Изменится и у собеседника.</span>
                        <button type="button" className={composer.rowTool} onClick={() => setEditing(null)}>Отмена</button>
                        <button type="button" className={styles.editSave} disabled={busy || !editing.text.trim()} onClick={saveEdit}>
                          Сохранить
                        </button>
                      </div>
                    </div>
                  ) : (
                    <MediaContent chatId={id} msg={msg} inbound={findInboundMedia(msg)} />
                  )}
                  {msg.reaction && <span className={composer.reactionMark}>{msg.reaction}</span>}
                </div>
                <span className={styles.msgTimeRow}>
                  {tgMark && (
                    <span
                      className={tgMark.read ? styles.tgRead : kind === 'client' ? styles.msgCheckUnread : styles.tgSent}
                      title={tgMark.title}
                      data-testid="tg-read"
                    >
                      {tgMark.icon}
                    </span>
                  )}
                  <span className={styles.msgTime}>{fmtTime(msg.ts)}</span>
                  {msg.deleted_at && (
                    <span className={styles.msgDeletedTag} title="Собеседник удалил сообщение — бот его не читает">
                      удалено
                    </span>
                  )}
                  {msg.edited_at && !msg.deleted_at && (
                    <span className={styles.msgEditedTag} title={`Изменено ${fmtTime(msg.edited_at)}`}>изменено</span>
                  )}
                  {msg.tg_msg_id && (
                    <span className={`${composer.rowTools} ${composer.rowToolsShown}`}>
                      <button
                        type="button"
                        className={composer.rowTool}
                        onClick={() => setReply({ tg_msg_id: msg.tg_msg_id, text: String(msg.content || '') })}
                      >
                        Ответить
                      </button>
                      {canEdit(msg, kind) && (
                        <button
                          type="button"
                          className={composer.rowTool}
                          data-testid="edit-message"
                          onClick={() => setEditing({ id: msg.id, text: String(msg.content || '') })}
                        >
                          Изменить
                        </button>
                      )}
                      {kind === 'client' && (
                        <span className={composer.toolsAnchor}>
                          <button
                            type="button"
                            className={composer.rowTool}
                            onClick={(e) => setReactFor({ id: msg.tg_msg_id, at: pickerPlacement(e.currentTarget.getBoundingClientRect()) })}
                          >
                            {msg.reaction || 'Реакция'}
                          </button>
                          {reactFor?.id === msg.tg_msg_id && (
                            <EmojiPicker
                              only={REACTION_EMOJI}
                              title="Реакция"
                              className={composer.pickerFixed}
                              style={reactFor.at}
                              onPick={(emoji) => react(msg, emoji)}
                              onClose={() => setReactFor(null)}
                            />
                          )}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </div>
            </div>
          </div>
        );
      })}
      {data.client_typing && (
        <div className={`${styles.msgRow} ${styles.msgClient}`} data-testid="client-typing">
          <div className={styles.msgInner}>
            <ClientAvatar className={styles.clientAvatar} style={{ '--av-bg': AVATAR_BG.blue }} src={data.client_avatar} name={name} />
            <div className={styles.msgContent}>
              <div className={`${styles.msgBubble} ${styles.typingBubble}`}>
                <span className={styles.typingText}>{ACTIVITY_LABEL[data.client_typing] ?? 'печатает'}</span>
                <span className={styles.typingDots} aria-hidden="true"><i /><i /><i /></span>
              </div>
            </div>
          </div>
        </div>
      )}
      {jump.show && (
        <div className={styles.jumpWrap}>
          <button
            type="button"
            className={styles.jumpBtn}
            data-testid="jump-down"
            title="К последним сообщениям"
            onClick={() => {
              const el = messagesRef.current;
              if (!el) return;
              atBottomRef.current = true;
              el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
              setJump({ show: false, unseen: 0 });
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
            {jump.unseen > 0 && <span className={styles.jumpCount}>{jump.unseen > 99 ? '99+' : jump.unseen}</span>}
          </button>
        </div>
      )}
    </div>
  );
}

export default MessageFeed;
