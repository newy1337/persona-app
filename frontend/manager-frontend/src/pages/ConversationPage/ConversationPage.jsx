import { PanelUX } from '../../ui/PanelUX';
import { Attribution } from '../../ui/ManagerRegion';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { stageColors } from '../../data/stages';
import Header from '../../components/Header/Header';
import ChatNote from './ChatNote';
import styles from './ConversationPage.module.scss';
import { AVATAR_BG } from '../../utils/avatar';
import ClientAvatar, { ACTIVITY_LABEL } from '../../components/ClientAvatar/ClientAvatar';
import { accountLostLabel, presenceLabel, whenLabel } from '../../utils/telegramStatus';
import VoicePlayer from '../../components/VoicePlayer/VoicePlayer';
import MediaGallery from '../../components/MediaGallery/MediaGallery';
import EditableValue from '../../components/EditableValue/EditableValue';
import {
  goalRows,
  goalNow,
  nextActionLabel,
  searchMessages,
  leadSignals,
  groupByDay,
  familyLabel,
  deliveredBy,
  beatComment,
  isMediaEvidence,
  findMessageIndex,
  orderedBeats,
  outOfScopeBeats,
  manuallyClosedBeats,
  MANUAL_CLOSE_LABEL,
  phoneLabel,
  shortTitle,
  stillPending,
} from '../../utils/scenario';
import {
  authorClass,
  fmtChatDate,
  loadReadCursor,
  mediaKind,
  mediaUrl,
  telegramReadMark,
  withToken,
  saveReadCursor,
  liveRows,
} from '../../utils/chat';
import {
  getConversationById,
  setChatNote,
  getConversationRevision,
  answerNow,
  getBeats,
  getConversations,
  getInboundMedia,
  downloadChatHtml,
  getMediaGallery,
  markListened as markListenedApi,
  editMessage,
  sendAlbum,
  setConversationHidden,
  getPauseStatus,
  pinFact,
  setAiMode as setAiModeApi,
  setSlot,
  sendAttachment,
  sendMessage,
  sendReaction,
  uploadFile,
} from '../../api/conversations';
import EmojiPicker from '../../components/composer/EmojiPicker';

function RoundIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}
import composer from '../../components/composer/Composer.module.scss';
import { REACTION_EMOJI } from '../../utils/reactions';
import { pauseReasonDetail, pauseReasonLabel } from '../../utils/pauseReason';
import {
  AgeIcon,
  LocationIcon,
  PhoneIcon,
  FamilyIcon,
  ShortIcon,
  BackIcon,
  SendIcon,
  MicIcon,
  MenuIcon,
  ChevronPrevIcon,
  ChevronNextIcon,
  UserAvatarIcon,
} from '../../assets/icons';

export const TOGGLE_COOLDOWN_MS = 2000;
const JUMP_SHOW_PX = 400;
const MAX_ALBUM = 10;

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

function ConversationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [data, setData] = useState(null);
  const [pauseStatus, setPauseStatus] = useState(null);
  const [beats, setBeats] = useState(null);
  const [inboundMedia, setInboundMedia] = useState([]);

  const [chats, setChats] = useState(null);
  const [liveCount, setLiveCount] = useState(0);
  const [stickyDate, setStickyDate] = useState('');
  const [readUpTo, setReadUpTo] = useState(() => loadReadCursor(id));
  const [draft, setDraft] = useState('');
  const [reply, setReply] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const attach = attachments[0] ?? null;
  const [jump, setJump] = useState({ show: false, unseen: 0 });
  const seenCountRef = useRef(0);
  const [editing, setEditing] = useState(null);
  const [gallery, setGallery] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [reactFor, setReactFor] = useState(null);
  const fileInput = useRef(null);
  const voiceInput = useRef(null);
  const roundInput = useRef(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState([]);

  const outstanding = data ? stillPending(pending, data.messages) : [];
  const messages = [
    ...(data?.messages || []),
    ...outstanding.map((p) => ({
      ts: p.ts,
      role: 'assistant',
      author: 'operator:web',
      content: p.text,
    })),
  ];

  const load = useCallback(() => {
    getConversationById(id)
      .then((detail) => {
        setData(detail);
        if (!detail?.is_paused) {
          setPauseStatus(null);
          return;
        }
        getPauseStatus(id, detail.persona_id)
          .then(setPauseStatus)
          .catch(() => setPauseStatus(null));
      })
      .catch((e) => setError(e.detail || e.message));
    getBeats(id).then(setBeats).catch(() => setBeats(null));
    getInboundMedia(id).then(setInboundMedia).catch(() => setInboundMedia([]));
  }, [id]);

  useEffect(load, [load]);

  useEffect(() => {
    getConversations()
      .then((rows) => {
        setChats(rows);
        setLiveCount(liveRows(rows).length);
      })
      .catch(() => {
        setChats([]);
        setLiveCount(0);
      });
  }, [id]);

  const revision = useRef(null);
  useEffect(() => {
    revision.current = null;
  }, [id]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      getConversationRevision(id)
        .then((r) => {
          if (revision.current === r.revision) return;
          revision.current = r.revision;
          load();
        })
        .catch(() => load());
    };
    const timer = setInterval(tick, 2000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [id, load]);

  const findInboundMedia = useCallback(
    (msg) => {
      if (msg.role !== 'user' || !inboundMedia.length) return null;
      let best = null;
      let bestDiff = Infinity;
      for (const entry of inboundMedia) {
        const diff = Math.abs(entry.ts - msg.ts);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = entry;
        }
      }
      return bestDiff <= 5 ? best : null;
    },
    [inboundMedia],
  );

  const messagesRef = useRef(null);
  const atBottomRef = useRef(true);
  const lastChatRef = useRef(null);

  const rowRefs = useRef([]);
  const [highlight, setHighlight] = useState(-1);
  const [msgQuery, setMsgQuery] = useState('');
  const [hitPos, setHitPos] = useState(0);

  const scrollToMessage = useCallback((index) => {
    const row = rowRefs.current[index];
    if (!row) return;
    atBottomRef.current = false;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlight(index);
  }, []);

  useEffect(() => {
    if (highlight === -1) return undefined;
    const timer = setTimeout(() => setHighlight(-1), 2500);
    return () => clearTimeout(timer);
  }, [highlight]);

  useEffect(() => {
    const total = data?.messages?.length ?? 0;
    const added = total - seenCountRef.current;
    seenCountRef.current = total;
    if (added > 0 && added < total && !atBottomRef.current) {
      setJump((j) => ({ show: true, unseen: j.unseen + added }));
    }
  }, [data?.messages?.length]);

  useEffect(() => {
    seenCountRef.current = 0;
    setJump({ show: false, unseen: 0 });
  }, [id]);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const chatChanged = lastChatRef.current !== id;
    lastChatRef.current = id;
    if (chatChanged || atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [id, data?.messages?.length, pending.length]);

  useEffect(() => {
    if (!data) return;
    setPending((prev) => (prev.length ? stillPending(prev, data.messages) : prev));
  }, [data]);

  useEffect(() => {
    setReadUpTo(loadReadCursor(id));
    setStickyDate('');
  }, [id]);

  const msgListRef = useRef(messages);
  msgListRef.current = messages;

  const markReadUpTo = useCallback((idx) => {
    setReadUpTo((prev) => {
      if (idx <= prev) return prev;
      saveReadCursor(id, idx);
      return idx;
    });
  }, [id]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const idx = Number(e.target.dataset.idx);
          if (!Number.isFinite(idx)) continue;
          markReadUpTo(idx);
        }
      },
      { root: container, rootMargin: '0px 0px -10% 0px' },
    );
    for (const el of rowRefs.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, [messages.length, markReadUpTo]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return undefined;
    let raf = 0;
    const update = () => {
      raf = 0;
      const list = msgListRef.current;
      if (!list.length) {
        setStickyDate('');
        return;
      }
      const top = container.scrollTop + 56;
      let label = '';
      const rows = rowRefs.current;
      for (let i = 0; i < rows.length; i++) {
        const el = rows[i];
        if (!el) continue;
        if (el.offsetTop + el.offsetHeight > top) {
          label = fmtChatDate(list[i].ts);
          break;
        }
      }
      if (!label) label = fmtChatDate(list[0].ts);
      setStickyDate((prev) => (prev === label ? prev : label));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [messages.length, id]);

  const aiActive = data ? !data.is_paused : true;

  const pauseReasonRaw = pauseStatus?.status === 'paused' ? pauseStatus.reason : null;
  const pauseLabel = pauseReasonRaw === null ? null : pauseReasonLabel(pauseReasonRaw);
  const pauseDetail = pauseReasonRaw === null ? null : pauseReasonDetail(pauseReasonRaw);

  const lastToggleRef = useRef(0);

  async function toggleAi() {
    if (!data || busy) return;
    const now = Date.now();
    if (now - lastToggleRef.current < TOGGLE_COOLDOWN_MS) return;
    lastToggleRef.current = now;
    setBusy(true);
    setError(null);
    try {
      await setAiModeApi(id, !aiActive);
      load();
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function pickFiles(fileList) {
    const files = [...(fileList ?? [])].filter(Boolean);
    if (!files.length || busy) return;
    const room = MAX_ALBUM - attachments.length;
    if (room <= 0) {
      setError(`за раз — не больше ${MAX_ALBUM} файлов`);
      return;
    }
    setBusy(true);
    setError(files.length > room ? `за раз — не больше ${MAX_ALBUM} файлов, лишние не добавлены` : null);
    try {
      for (const file of files.slice(0, room)) {
        const up = await PanelUX.run(`upload:${id}`, ['Загружаем файл…', 'Файл загружен'], () => uploadFile(id, file));
        const preview = file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : null;
        setAttachments((prev) => [...prev, { ...up, name: file.name, preview, isVideo: file.type.startsWith('video/') }]);
      }
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendVoiceFile(file) {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const up = await PanelUX.run(`upload:${id}`, ['Загружаем файл…', 'Файл загружен'], () => uploadFile(id, file));
      await sendAttachment(id, { kind: 'voice', source: up.path, caption: '', replyTo: reply?.tg_msg_id ?? null });
      setReply(null);
      setPending((prev) => [...prev, { ts: Math.floor(Date.now() / 1000), text: '[голосовое]' }]);
      load();
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendRoundFile(file) {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    try {
      const up = await PanelUX.run(`upload:${id}`, ['Загружаем файл…', 'Файл загружен'], () => uploadFile(id, file));
      await sendAttachment(id, { kind: 'video_note', source: up.path, caption: '', replyTo: reply?.tg_msg_id ?? null });
      setReply(null);
      setPending((prev) => [...prev, { ts: Math.floor(Date.now() / 1000), text: '[кружок]' }]);
      load();
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendFile() {
    if (!attachments.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const caption = draft.trim();
      const replyTo = reply?.tg_msg_id ?? null;
      const albumable = attachments.length > 1 && attachments.every((a) => a.kind === 'photo' || a.kind === 'video');
      if (albumable) {
        await sendAlbum(id, { sources: attachments.map((a) => a.path), caption, replyTo });
      } else {
        for (const [i, a] of attachments.entries()) {
          await sendAttachment(id, { kind: a.kind, source: a.path, caption: i === 0 ? caption : '', replyTo: i === 0 ? replyTo : null });
        }
      }
      setAttachments([]);
      setDraft('');
      setReply(null);
      load();
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendGifLink() {
    const url = window.prompt('Ссылка на гифку (https://…gif или .mp4):');
    if (!url || !/^https:\/\//i.test(url.trim())) return;
    setBusy(true);
    setError(null);
    try {
      await sendAttachment(id, { kind: 'animation', source: url.trim(), replyTo: reply?.tg_msg_id ?? null });
      setReply(null);
      load();
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing || busy) return;
    const text = editing.text.trim();
    if (!text) return;
    setBusy(true);
    setError(null);
    try {
      await editMessage(id, editing.id, text);
      setEditing(null);
      load();
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  async function react(msg, emoji) {
    setReactFor(null);
    setError(null);
    try {
      await sendReaction(id, msg.tg_msg_id, msg.reaction === emoji ? '' : emoji);
      load();
    } catch (e) {
      setError(e.detail || e.message);
    }
  }

  async function send({ voice }) {
    const text = draft.trim();
    if (attachments.length) return sendFile();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendMessage(id, text, { voice, replyTo: reply?.tg_msg_id ?? null });
      setDraft('');
      setReply(null);
      setPending((prev) => [...prev, { text, ts: Date.now() / 1000 }]);
      load();
    } catch (e) {
      setError(e.detail || e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <div className={styles.page}>
        <Header />
        <div className={styles.container}><p className={styles.loadError}>{error}</p></div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className={styles.page}>
        <Header />
        <div className={styles.container}><p>Загрузка…</p></div>
      </div>
    );
  }

  const pins = data.pinned_facts || {};
  const dbPhone = data.client_phone || null;
  const dbCity = data.client_city || null;
  const signals = leadSignals(pins);
  const scenarioBeats = orderedBeats(beats?.beats);
  const telemetryRows = [
    ...manuallyClosedBeats(beats?.beats).map((b) => ({ beat: b, note: MANUAL_CLOSE_LABEL })),
    ...outOfScopeBeats(beats?.beats).map((b) => ({ beat: b, note: 'не измеряется' })),
  ];
  const goals = data.goals || null;
  const handoff = goalRows(goals);
  const hits = searchMessages(data.messages, msgQuery);
  const now = goalNow(goals);
  const name = pins.name || `Чат ${data.chat_id}`;
  const stage = data.goals?.stage;
  const cfg = stage?.title ? { ...stageColors(stage.index), label: stage.title } : {};

  const chatIds = chats ? chats.map((c) => c.chat_id) : [];
  const idx = chatIds.indexOf(Number(id));
  const goPrev = () => {
    if (idx > 0) navigate(`/conversation/${chatIds[idx - 1]}`);
  };
  const goNext = () => {
    if (idx !== -1 && idx < chatIds.length - 1) navigate(`/conversation/${chatIds[idx + 1]}`);
  };

  return (
    <div className={styles.page}>
      <Header liveCount={liveCount} />

      <div className={styles.subHeader}>
        <div className={styles.container}>
          <button className={styles.backBtn} onClick={() => navigate('/')}>
            <BackIcon />
            К дашборду
          </button>
          <div className={styles.subNav}>
            <button
              className={styles.navBtn}
              onClick={goPrev}
              disabled={idx <= 0}
              aria-label="Предыдущий чат"
              title="Предыдущий чат"
            >
              <ChevronPrevIcon />
            </button>
            <span className={styles.navLabel}>
              <span className={styles.navCurrent}>{idx >= 0 ? idx + 1 : '—'}</span> / {chatIds.length || '—'}
            </span>
            <button
              className={styles.navBtn}
              onClick={goNext}
              disabled={idx === -1 || idx >= chatIds.length - 1}
              aria-label="Следующий чат"
              title="Следующий чат"
            >
              <ChevronNextIcon />
            </button>
          </div>
          <span className={styles.separator}></span>
          <span className={styles.convId}>
            ЧАТ <span className={styles.convNumber}>{data.chat_id}</span>
          </span>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.container}>
          {sidebarOpen && <div className={styles.overlay} onClick={() => setSidebarOpen(false)} />}

          <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
            <div className={styles.agentCard}>
              <div className={styles.inner}>
                <div className={styles.agentAvatarWrap}>
                  <ClientAvatar className={styles.agentAvatar} style={{ '--av-bg': AVATAR_BG.blue }} src={data.client_avatar} name={name} />
                </div>
                <div className={styles.agentMain}>
                  <span className={styles.agentName}>{name}</span>
                  <Attribution value={data} compact />
                  {data.blocked_by_client_at ? (
                    <span className={styles.presenceBlocked} data-testid="client-blocked">заблокировал(а) нас</span>
                  ) : data.cleared_by_client_at ? (
                    <span className={styles.presenceBlocked} data-testid="client-cleared">почистил(а) диалог · {whenLabel(data.cleared_by_client_at)}</span>
                  ) : (
                    presenceLabel(data.client_presence) && (
                      <span
                        className={presenceLabel(data.client_presence).tone === 'online' ? styles.presenceOnline : styles.presence}
                        data-testid="client-presence"
                      >
                        {presenceLabel(data.client_presence).text}
                      </span>
                    )
                  )}
                  {cfg.label && (
                    <span
                      className={styles.agentBadge}
                      style={{ '--badge-color': cfg.color, '--badge-bg': cfg.bg }}
                    >
                      <span className={styles.badgeDot} />
                      {cfg.label}
                    </span>
                  )}
                </div>
                <div className={styles.agentMeta}>
                  <span className={styles.metaRow}>
                    <span className={styles.metaIcon}><AgeIcon />Возраст</span>
                    <EditableValue
                      value={pins.age ? String(pins.age) : ''}
                      onSave={async (v) => { await pinFact(id, 'age', v); load(); }}
                    />
                  </span>
                  <span className={styles.metaRow}>
                    <span className={styles.metaIcon}><LocationIcon />Город</span>
                    <EditableValue
                      value={pins.city || ''}
                      display={pins.city || dbCity || '—'}
                      onSave={async (v) => { await pinFact(id, 'city', v); load(); }}
                    />
                  </span>
                  <span className={styles.metaRow}>
                    <span className={styles.metaIcon}><LocationIcon />Сайт</span>
                    <EditableValue
                      value={pins.site || ''}
                      title="Сайт знакомств лида — подставляется в {site} этого диалога"
                      onSave={async (v) => { await pinFact(id, 'site', v); load(); }}
                    />
                  </span>
                  <span className={styles.metaRow}>
                    <span className={styles.metaIcon}><PhoneIcon />Контакт</span>
                    {phoneLabel(pins, dbPhone) || (data.client_username ? (
                      <a href={`https://t.me/${data.client_username}`} target="_blank" rel="noreferrer" title="Номер скрыт в Telegram — ник собеседника">
                        @{data.client_username}
                      </a>
                    ) : '—')}
                  </span>
                  <span className={styles.metaRow} data-testid="writing-account">
                    <span className={styles.metaIcon}><UserAvatarIcon />Пишет</span>
                    {data.account ? (
                      <span title={`Аккаунт Telegram, с которого ${data.persona_name || data.account.persona_id || 'личность'} ведёт этот чат`}>
                        {data.account.display_name || data.persona_name || data.account.persona_id}
                        {data.account.username ? (
                          <> · <a href={`https://t.me/${data.account.username}`} target="_blank" rel="noreferrer">@{data.account.username}</a></>
                        ) : data.account.phone ? ` · ${data.account.phone}` : ''}
                      </span>
                    ) : '—'}
                  </span>
                  <span className={styles.metaRow}>
                    <span className={styles.metaIcon}><FamilyIcon />Семья</span>
                    <EditableValue
                      value={pins.family || ''}
                      display={familyLabel(pins) || '—'}
                      onSave={async (v) => { await pinFact(id, 'family', v); load(); }}
                    />
                  </span>
                </div>
              </div>
              {signals.length > 0 && (
                <div className={styles.signals}>
                  {signals.map((s) => (
                    <span
                      key={s.key}
                      className={`${styles.signal} ${s.tone === 'warn' ? styles.signalWarn : styles.signalGood}`}
                    >
                      {s.text}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <ChatNote
              note={data.note}
              noteBy={data.note_by}
              noteAt={data.note_at}
              onSave={async (text) => { await setChatNote(id, text); load(); }}
            />

            <div className={styles.summarySection}>
              <div className={styles.summaryHeader}>
                <span className={styles.summaryTitle}>
                  <span className={styles.summaryIcon}><ShortIcon /></span>
                  Цели знакомства{goals?.stage?.title ? ` · ${goals.stage.title}` : ''}
                </span>
                <span className={styles.summaryTag}>
                  {goals ? `${goals.known} / ${goals.total}` : '—'}
                </span>
              </div>
              <div className={styles.cardBody}>
                <div className={`${styles.nextBeat} ${styles['next_' + now.tone]}`}>
                  <span className={styles.nextLabel}>сейчас</span>
                  <p className={styles.nextText}>{now.text}</p>
                  {now.hint && <span className={styles.nextHint}>{now.hint}</span>}
                </div>
                {handoff.map((h) => (
                  <span key={h.key} className={`${styles.checkRow} ${styles['check_' + h.state]}`} title={h.title}>
                    <span className={styles.checkMark}>
                      {h.state === 'ok' ? '✓' : h.state === 'fail' ? '!' : h.state === 'skip' ? '–' : '?'}
                    </span>
                    <span className={styles.checkLabel}>{h.label}</span>
                    <span className={styles.checkNote}>
                      <EditableValue
                        value={h.value || ''}
                        display={h.note}
                        title={`${h.title} — нажмите, чтобы отметить вручную`}
                        onSave={async (v) => { await setSlot(id, h.key, v); load(); }}
                      />
                    </span>
                  </span>
                ))}
              </div>
            </div>

            {beats && (
              <div className={styles.summarySection}>
                <div className={styles.summaryHeader}>
                  <span className={styles.summaryTitle}>
                    <span className={styles.summaryIcon}><ShortIcon /></span>Сценарий
                  </span>
                  <span className={styles.summaryTag}>
                    {beats.delivered} / {beats.total}
                  </span>
                </div>

                <div className={styles.cardBody}>
                  {groupByDay(scenarioBeats).map((g) => {
                    const done = g.items.filter((b) => b.status === 'delivered').length;
                    return (
                      <div key={g.day} className={styles.dayGroup}>
                        <div className={styles.dayProgressRow}>
                          <span className={`${styles.dayLabel} ${styles.dayProgressLabel}`}>
                            {g.day ? `день ${g.day}` : 'без дня'}
                          </span>
                          <span className={styles.dayTrack}>
                            <span
                              className={styles.progressFill}
                              style={{ width: `${g.items.length ? (done / g.items.length) * 100 : 0}%` }}
                            />
                          </span>
                          <span className={styles.dayFraction}>
                            {done} / {g.items.length}
                          </span>
                        </div>
                        <div className={styles.beatRows}>
                          {g.items.map((b) => {
                            const isDone = b.status === 'delivered';
                            const jumpTo = findMessageIndex(data?.messages, b);
                            const jumpable = jumpTo !== -1;
                            const comment = beatComment(b);
                            return (
                              <div key={b.id}>
                                <div
                                  className={`${styles.beatRow} ${jumpable ? styles.beatJumpable : ''}`}
                                  title={jumpable ? 'Показать в переписке' : undefined}
                                  onClick={jumpable ? () => scrollToMessage(jumpTo) : undefined}
                                >
                                  <span className={styles.beatCheck}>{isDone ? '✓' : ''}</span>
                                  <span className={`${styles.beatId} ${isDone ? styles.beatIdDone : ''}`}>{b.id}</span>
                                  <span className={`${styles.beatTitle} ${isDone ? styles.beatTitleDone : ''}`}>
                                    {shortTitle(b.title)}
                                  </span>
                                </div>
                                {b.evidence && isMediaEvidence(b.evidence) && (
                                  <p className={styles.beatEvidence}>
                                    <img
                                      className={styles.beatEvidenceThumb}
                                      src={mediaUrl(id, b.ts)}
                                      alt="Отправленный кадр"
                                      onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                      }}
                                    />
                                    {deliveredBy(b)}: кадр отправлен
                                  </p>
                                )}
                                {b.evidence && !isMediaEvidence(b.evidence) && comment && (
                                  <p className={styles.beatEvidence}>
                                    {comment.kind === 'reason' ? (
                                      <>
                                        {deliveredBy(b)}: {comment.text}
                                        {comment.evidence && (
                                          <>
                                            <br />
                                            <span className={styles.beatEvidenceMeta}>
                                              улика: «{comment.evidence}»
                                            </span>
                                          </>
                                        )}
                                      </>
                                    ) : comment.kind === 'pair' ? (
                                      <>
                                        {deliveredBy(b)}: зачтено по обмену
                                        <br />
                                        <span className={styles.beatEvidenceMeta}>клиент:</span>{' '}
                                        «{comment.client || '—'}»{' '}
                                        <span className={styles.beatEvidenceMeta}>Ира:</span> «
                                        {comment.ira || '—'}»
                                      </>
                                    ) : comment.kind === 'pin' ? (
                                      <>
                                        {deliveredBy(b)}:{' '}
                                        {comment.phrase || (
                                          <span className={styles.beatEvidenceMeta}>
                                            ключ леджера
                                          </span>
                                        )}
                                        {comment.key && (
                                          <>
                                            <br />
                                            <span className={styles.beatEvidenceMeta}>
                                              {comment.key}
                                              {comment.value ? `: ${comment.value}` : ''}
                                            </span>
                                          </>
                                        )}
                                      </>
                                    ) : (
                                      <>{deliveredBy(b)}: «{comment.text}»</>
                                    )}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {telemetryRows.length > 0 && (
                    <div className={styles.telemetryGroup}>
                      <span className={styles.dayLabel}>вне счёта</span>
                      {telemetryRows.map(({ beat: b, note }) => (
                        <div key={b.id} className={styles.telemetryRow}>
                          <span className={styles.telemetryId}>{b.id}</span>
                          <span className={styles.telemetryTitle}>{shortTitle(b.title)}</span>
                          <span className={styles.telemetryNote}>{note}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </aside>

          <div className={styles.chat}>
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
                  await setConversationHidden(id, !data.archived);
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

            {gallery && (
              <MediaGallery
                items={gallery.items}
                loading={gallery.loading}
                error={gallery.error}
                onClose={() => setGallery(null)}
                onShowInChat={(item) => {
                  const index = messages.findIndex((m) => m.id === item.id);
                  if (index >= 0) scrollToMessage(index);
                  else setError('это сообщение старше загруженной части переписки — выгрузите HTML, чтобы увидеть всё');
                }}
              />
            )}

            <div className={styles.inputArea}>
              <div className={styles.inputTop}>
                <div className={styles.aiToggleBlock}>
                  <button
                    className={`${styles.aiToggle} ${aiActive ? styles.aiToggleOn : ''}`}
                    onClick={toggleAi}
                    disabled={busy}
                  >
                    <div className={styles.aiToggleKnob} />
                  </button>
                  <div className={styles.aiToggleText}>
                    <span className={styles.aiToggleLabel}>
                      Бот{' '}
                      <span className={aiActive ? styles.aiActiveTag : styles.aiDisabledTag}>
                        {aiActive ? 'ведёт' : 'молчит'}
                      </span>
                    </span>
                    <span className={styles.aiToggleDesc}>
                      {aiActive
                        ? 'Диалог ведёт бот. Выключи, чтобы забрать чат себе'
                        : 'Чат за тобой. Включи, чтобы вернуть боту'}
                    </span>
                    {nextActionLabel(data.next_bot_action) && (
                      <span
                        className={`${styles.scheduledReply} ${styles['next_' + nextActionLabel(data.next_bot_action).tone]}`}
                        data-testid="next-bot-action"
                      >
                        {nextActionLabel(data.next_bot_action).text}
                        {data.next_bot_action?.kind === 'no_reply' && data.next_bot_action?.why === 'not_scheduled' && (
                          <button
                            type="button"
                            className={styles.answerNowBtn}
                            disabled={busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await answerNow(id);
                                load();
                              } catch (e) {
                                setError(e.detail || e.message);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Ответить сейчас
                          </button>
                        )}
                      </span>
                    )}
                    {pauseLabel && (
                      <span
                        className={styles.pauseReason}
                        data-testid="pause-reason"
                        title={pauseReasonRaw}
                      >
                        Почему молчит: {pauseLabel}
                        {pauseDetail && (
                          <span className={styles.pauseReasonDetail}> — {pauseDetail}</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <span className={aiActive ? styles.aiResponding : styles.manualMode}>
                  {aiActive ? '● БОТ ОТВЕЧАЕТ' : '● РУЧНОЙ РЕЖИМ'}
                </span>
              </div>

              {error && <p className={styles.loadError}>{error}</p>}

              {!aiActive && (
                <div className={styles.inputInner}>
                  {reply && (
                    <div className={composer.replyBar}>
                      <span>Ответ на:</span>
                      <span className={composer.replyText}>{reply.text.slice(0, 120)}</span>
                      <button className={composer.replyDrop} onClick={() => setReply(null)} title="Не отвечать">✕</button>
                    </div>
                  )}
                  {attachments.length === 1 && (
                    <div className={composer.attachBar}>
                      {attach.preview && !attach.isVideo && <img className={composer.attachThumb} src={attach.preview} alt="" />}
                      {attach.preview && attach.isVideo && <video className={composer.attachThumb} src={attach.preview} muted />}
                      <span className={composer.attachName}>{attach.name}</span>
                      <span className={composer.attachSize}>{(attach.bytes / 1024 / 1024).toFixed(1)} МБ</span>
                      {attach.kind === 'voice' && <span className={composer.attachHint}>уйдёт голосовым</span>}
                      <button className={composer.replyDrop} onClick={() => setAttachments([])} title="Убрать файл">✕</button>
                    </div>
                  )}
                  {attachments.length > 1 && (
                    <div className={composer.attachBar} data-testid="album-bar">
                      <div className={composer.albumThumbs}>
                        {attachments.map((a, i) => (
                          <span key={a.path} className={composer.albumThumb} title={a.name}>
                            {a.preview && !a.isVideo && <img src={a.preview} alt="" />}
                            {a.preview && a.isVideo && <video src={a.preview} muted />}
                            {!a.preview && <span className={composer.albumFile}>{a.name.split('.').pop()}</span>}
                            <button
                              type="button"
                              className={composer.albumDrop}
                              onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                              title="Убрать"
                            >
                              ✕
                            </button>
                          </span>
                        ))}
                      </div>
                      <span className={composer.attachHint}>
                        {attachments.every((a) => a.kind === 'photo' || a.kind === 'video')
                          ? `альбом · ${attachments.length} шт.`
                          : `${attachments.length} файла — уйдут по одному`}
                      </span>
                      <button className={composer.replyDrop} onClick={() => setAttachments([])} title="Убрать все">✕</button>
                    </div>
                  )}
                  <div className={styles.inputRow}>
                    <textarea
                      className={styles.inputField}
                      rows={2}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Сообщение… (Enter — отправить, Shift+Enter — перенос строки)"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          send({ voice: false });
                        }
                      }}
                    />
                  </div>
                  <div className={styles.inputActions}>
                    <div className={styles.inputActionsLeft}>
                      <input
                        type="file"
                        ref={fileInput}
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }}
                      />
                      <button
                        type="button"
                        className={composer.toolBtn}
                        title="Прикрепить файлы: фото, видео, гиф, голосовое или документ. Несколько фото и видео уйдут альбомом"
                        disabled={busy}
                        onClick={() => fileInput.current?.click()}
                      >
                        📎
                      </button>
                      <span className={composer.toolWrap}>
                        <button
                          type="button"
                          className={composer.toolBtn}
                          title="Эмодзи"
                          onClick={() => setEmojiOpen((v) => !v)}
                        >
                          🙂
                        </button>
                        {emojiOpen && (
                          <EmojiPicker
                            onPick={(emoji) => setDraft((d) => d + emoji)}
                            onClose={() => setEmojiOpen(false)}
                          />
                        )}
                      </span>
                      <button type="button" className={composer.toolBtn} title="Гифка по ссылке" disabled={busy} onClick={sendGifLink}>
                        GIF
                      </button>
                    </div>
                    <div className={styles.inputActionsRight}>
                      <input
                        type="file"
                        ref={voiceInput}
                        accept="audio/*,.mp3,.m4a,.ogg,.oga,.wav,.opus"
                        style={{ display: 'none' }}
                        onChange={(e) => { sendVoiceFile(e.target.files?.[0]); e.target.value = ''; }}
                      />
                      <button
                        className={styles.sendVoiceBtn}
                        onClick={() => voiceInput.current?.click()}
                        disabled={busy}
                        title="Выбрать аудиофайл — уйдёт голосовым (mp3, m4a, wav, ogg)"
                      >
                        <MicIcon /> Голосовое
                      </button>
                      <input
                        type="file"
                        ref={roundInput}
                        accept="video/*,.mp4,.mov,.webm,.mkv"
                        style={{ display: 'none' }}
                        onChange={(e) => { sendRoundFile(e.target.files?.[0]); e.target.value = ''; }}
                      />
                      <button
                        className={styles.sendVoiceBtn}
                        onClick={() => roundInput.current?.click()}
                        disabled={busy}
                        data-testid="send-round"
                        title="Выбрать видео — уйдёт кружком: сервер обрежет его в квадрат и до минуты"
                      >
                        <RoundIcon /> Кружком
                      </button>
                      <button
                        className={styles.sendBtn}
                        onClick={() => send({ voice: false })}
                        disabled={busy || (!draft.trim() && !attachments.length)}
                      >
                        <SendIcon /> Отправить
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConversationPage;
