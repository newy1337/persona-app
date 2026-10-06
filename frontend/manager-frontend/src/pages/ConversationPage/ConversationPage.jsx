import { PanelUX } from '../../ui/PanelUX';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { stageColors } from '../../data/stages';
import Header from '../../components/Header/Header';
import styles from './ConversationPage.module.scss';
import MediaGallery from '../../components/MediaGallery/MediaGallery';
import Sidebar from './Sidebar';
import ChatTopBar from './ChatTopBar';
import MessageFeed from './MessageFeed';
import InputArea from './InputArea';
import {
  goalRows,
  goalNow,
  searchMessages,
  leadSignals,
  orderedBeats,
  outOfScopeBeats,
  manuallyClosedBeats,
  MANUAL_CLOSE_LABEL,
  stillPending,
} from '../../utils/scenario';
import {
  fmtChatDate,
  loadReadCursor,
  saveReadCursor,
  liveRows,
} from '../../utils/chat';
import {
  getConversationById,
  getConversationRevision,
  getBeats,
  getConversations,
  getInboundMedia,
  editMessage,
  sendAlbum,
  getPauseStatus,
  setAiMode as setAiModeApi,
  sendAttachment,
  sendMessage,
  sendReaction,
  uploadFile,
} from '../../api/conversations';
import { pauseReasonDetail, pauseReasonLabel } from '../../utils/pauseReason';
import { BackIcon, ChevronPrevIcon, ChevronNextIcon } from '../../assets/icons';

export { canEdit, pickerPlacement } from './MessageFeed';

export const TOGGLE_COOLDOWN_MS = 2000;
const MAX_ALBUM = 10;

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
    } catch {
      // причину уже показала всплывашка action-store; дублировать строкой не нужно
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

          <Sidebar
            id={id}
            data={data}
            name={name}
            cfg={cfg}
            pins={pins}
            dbPhone={dbPhone}
            dbCity={dbCity}
            signals={signals}
            goals={goals}
            handoff={handoff}
            now={now}
            beats={beats}
            scenarioBeats={scenarioBeats}
            telemetryRows={telemetryRows}
            busy={busy}
            setBusy={setBusy}
            load={load}
            scrollToMessage={scrollToMessage}
            sidebarOpen={sidebarOpen}
          />

          <div className={styles.chat}>
            <ChatTopBar
              id={id}
              data={data}
              name={name}
              pins={pins}
              navigate={navigate}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              load={load}
              setSidebarOpen={setSidebarOpen}
              msgQuery={msgQuery}
              setMsgQuery={setMsgQuery}
              hitPos={hitPos}
              setHitPos={setHitPos}
              hits={hits}
              scrollToMessage={scrollToMessage}
              setGallery={setGallery}
              exporting={exporting}
              setExporting={setExporting}
              exportError={exportError}
              setExportError={setExportError}
            />

            <MessageFeed
              id={id}
              data={data}
              name={name}
              messages={messages}
              messagesRef={messagesRef}
              atBottomRef={atBottomRef}
              rowRefs={rowRefs}
              readUpTo={readUpTo}
              highlight={highlight}
              hits={hits}
              stickyDate={stickyDate}
              jump={jump}
              setJump={setJump}
              editing={editing}
              setEditing={setEditing}
              saveEdit={saveEdit}
              busy={busy}
              findInboundMedia={findInboundMedia}
              setReply={setReply}
              reactFor={reactFor}
              setReactFor={setReactFor}
              react={react}
            />

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

            <InputArea
              id={id}
              data={data}
              aiActive={aiActive}
              toggleAi={toggleAi}
              busy={busy}
              setBusy={setBusy}
              error={error}
              setError={setError}
              load={load}
              pauseReasonRaw={pauseReasonRaw}
              pauseLabel={pauseLabel}
              pauseDetail={pauseDetail}
              reply={reply}
              setReply={setReply}
              attachments={attachments}
              setAttachments={setAttachments}
              draft={draft}
              setDraft={setDraft}
              emojiOpen={emojiOpen}
              setEmojiOpen={setEmojiOpen}
              fileInput={fileInput}
              voiceInput={voiceInput}
              roundInput={roundInput}
              send={send}
              sendGifLink={sendGifLink}
              pickFiles={pickFiles}
              sendVoiceFile={sendVoiceFile}
              sendRoundFile={sendRoundFile}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ConversationPage;
