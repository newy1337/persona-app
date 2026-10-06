import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { IconAction } from '@/components/IconAction/IconAction';
import { useRouteBusy } from '@/components/AppLayout/routeBusy';
import { PanelUX } from '../../ui/PanelUX';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { stageColors } from '../../data/stages';
import MediaGallery from '../../components/MediaGallery/MediaGallery';
import Sidebar, { SIDEBAR, SECTION } from './Sidebar';
import ChatTopBar, { ChatTopBarSkeleton } from './ChatTopBar';
import MessageFeed from './MessageFeed';
import InputArea, { InputAreaSkeleton } from './InputArea';
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

export { canEdit, pickerPlacement } from './MessageFeed';

export const TOGGLE_COOLDOWN_MS = 2000;
const MAX_ALBUM = 10;

// Каркас страницы. Те же классы собирают и готовую страницу, и скелетон первой
// загрузки — поэтому высоты полос совпадают по построению.
/* Каркас (AppLayout) держит экранную высоту; страница занимает всё под шапкой. */
const PAGE = 'flex min-h-0 flex-1 flex-col bg-background';
const SUB_HEADER = 'shrink-0 border-b bg-background';
const SUB_ROW = 'container flex h-12 items-center gap-1';
const BODY = 'flex min-h-0 flex-1';
const BODY_ROW = 'container flex min-h-0';
const CHAT = 'flex min-w-0 flex-1 flex-col';
// Карточка клиента и переписка — один блок в общей рамке с одной линией между ними.
const CHAT_FRAME = 'flex min-h-0 flex-1 flex-col border-r bg-background max-lg:border-l';

const SKELETON_BUBBLES = [
  ['items-start', 'h-14 w-3/5'],
  ['items-end', 'h-20 w-1/2'],
  ['items-start', 'h-10 w-2/5'],
  ['items-end', 'h-14 w-3/5'],
  ['items-start', 'h-10 w-1/3'],
];

const SKELETON_META = ['w-24', 'w-32', 'w-10', 'w-20', 'w-28', 'w-36', 'w-16'];

/** Первая загрузка: колонка карточки, лента и блок ввода из тех же классов, что у готовой страницы. */
function PageSkeleton() {
  return (
    <>
      <div className={SUB_HEADER}>
        <div className={SUB_ROW}>
          <Skeleton className="mr-auto h-8 w-32" />
          <Skeleton className="h-8 w-[136px]" />
        </div>
      </div>
      <div className={BODY} role="status" aria-busy="true">
        <div className={BODY_ROW}>
          <span className="sr-only">Загрузка…</span>
          <div className={`hidden lg:flex ${SIDEBAR}`}>
            <div className={SECTION}>
              <div className="flex items-center gap-3">
                <Skeleton className="size-12 rounded-full" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <div className="flex flex-col">
                {SKELETON_META.map((w, i) => (
                  <div key={i} className="grid min-h-7 grid-cols-[88px_minmax(0,1fr)] items-center gap-3">
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className={`h-3.5 ${w}`} />
                  </div>
                ))}
              </div>
            </div>
            <div className={SECTION}>
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-16 w-full" />
            </div>
            <div className={SECTION}>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-28 w-full" />
            </div>
          </div>
          <div className={CHAT}>
            <div className={CHAT_FRAME}>
              <ChatTopBarSkeleton />
              <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden px-4 pt-12 pb-4 md:px-6">
                {SKELETON_BUBBLES.map(([side, size], i) => (
                  <div key={i} className={`flex flex-col gap-1 ${side}`}>
                    <Skeleton className={`rounded-xl ${size}`} />
                    <Skeleton className="my-2 h-3 w-12" />
                  </div>
                ))}
              </div>
              <InputAreaSkeleton />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ConversationPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [data, setData] = useState(null);
  const [pauseStatus, setPauseStatus] = useState(null);
  const [beats, setBeats] = useState(null);
  // Чат, для которого сценарий так и не загрузился: вместо вечного скелетона
  // сайдбар покажет «не удалось загрузить» и кнопку повтора.
  const [beatsFailedFor, setBeatsFailedFor] = useState(null);
  const [inboundMedia, setInboundMedia] = useState([]);

  const [chats, setChats] = useState(null);
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

  const beatsFor = useRef(null);
  const mediaFor = useRef(null);

  // Сбой повторного запроса не стирает уже показанное: иначе сценарий и медиа
  // в ленте мигали бы при каждой сетевой ошибке. Данные другого чата при
  // сбое всё же убираем.
  const loadBeats = useCallback(
    () =>
      getBeats(id)
        .then((b) => {
          beatsFor.current = id;
          setBeats(b);
          setBeatsFailedFor(null);
        })
        .catch(() => {
          if (beatsFor.current !== id) {
            setBeats(null);
            setBeatsFailedFor(id);
          }
        }),
    [id],
  );

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
    loadBeats();
    getInboundMedia(id)
      .then((m) => {
        mediaFor.current = id;
        setInboundMedia(m);
      })
      .catch(() => {
        if (mediaFor.current !== id) setInboundMedia([]);
      });
  }, [id, loadBeats]);

  useRouteBusy(!data && !error);

  // Узкий экран: выдвинутую карточку клиента закрывает и Escape.
  useEffect(() => {
    if (!sidebarOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sidebarOpen]);

  useEffect(load, [load]);

  useEffect(() => {
    getConversations()
      .then((rows) => {
        setChats(rows);
      })
      .catch(() => {
        setChats([]);
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
      <div className={PAGE}>
        <div className="container">
          <Alert variant="destructive" role="alert" className="my-6">
            <AlertDescription className="block">
              <p>{error}</p>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className={PAGE}>
        <PageSkeleton />
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
    <div className={PAGE}>
      <div className={`subHeader ${SUB_HEADER}`}>
        <div className={SUB_ROW}>
          <Button variant="ghost" size="sm" className="backBtn mr-auto -ml-2.5" onClick={() => navigate('/')}>
            <ArrowLeft aria-hidden="true" />
            К дашборду
          </Button>
          <div className="subNav flex items-center">
            <IconAction
              icon={ChevronLeft}
              label="Предыдущий чат"
              onClick={goPrev}
              disabled={idx <= 0}
            />
            <span className="min-w-[56px] px-1 text-center text-xs tabular-nums text-muted-foreground">
              <span className="navCurrent font-medium text-foreground">{idx >= 0 ? idx + 1 : '—'}</span> / {chatIds.length || '—'}
            </span>
            <IconAction
              icon={ChevronRight}
              label="Следующий чат"
              onClick={goNext}
              disabled={idx === -1 || idx >= chatIds.length - 1}
            />
          </div>
          <span className="ml-2 text-xs whitespace-nowrap text-muted-foreground max-sm:hidden">
            Чат <span className="font-mono tabular-nums">{data.chat_id}</span>
          </span>
        </div>
      </div>

      <div className={BODY}>
        <div className={BODY_ROW}>
          {/* Затемнение z-40, выдвижная карточка (Sidebar) — z-50: она всегда поверх. */}
          {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" aria-hidden="true" onClick={() => setSidebarOpen(false)} />}

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
            scenarioFailed={!beats && beatsFailedFor === id}
            onRetryScenario={loadBeats}
            busy={busy}
            setBusy={setBusy}
            load={load}
            scrollToMessage={scrollToMessage}
            sidebarOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
          />

          <div className={CHAT}>
            <div className={CHAT_FRAME}>
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
    </div>
  );
}

export default ConversationPage;
