import { CirclePlay, Mic, Paperclip, Send, Smile } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { nextActionLabel } from '../../utils/scenario';
import { answerNow } from '../../api/conversations';
import EmojiPicker from '../../components/composer/EmojiPicker';

const NEXT_TONE = {
  ok: 'text-primary',
  wait: 'text-muted-foreground',
  warn: 'text-warning-foreground',
};
const DROP = 'size-7 shrink-0 text-muted-foreground hover:text-destructive';
const TOOL = 'size-8';

function InputArea({
  id,
  data,
  aiActive,
  toggleAi,
  busy,
  setBusy,
  error,
  setError,
  load,
  pauseReasonRaw,
  pauseLabel,
  pauseDetail,
  reply,
  setReply,
  attachments,
  setAttachments,
  draft,
  setDraft,
  emojiOpen,
  setEmojiOpen,
  fileInput,
  voiceInput,
  roundInput,
  send,
  sendGifLink,
  pickFiles,
  sendVoiceFile,
  sendRoundFile,
}) {
  const attach = attachments[0] ?? null;
  const nextAction = nextActionLabel(data.next_bot_action);
  return (
    <div className="relative shrink-0 border-t bg-background">
      {/* Ошибка всплывает над блоком ввода и не меняет его высоту — лента не прыгает. */}
      {error && (
        <Alert variant="destructive" className="absolute inset-x-4 bottom-full z-10 mb-2 w-auto shadow-md">
          <AlertDescription className="block">
            <p>{error}</p>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-3 px-4 py-3 max-sm:flex-col max-sm:items-start max-sm:gap-2">
        <div className="flex min-w-0 items-center gap-4">
          <Switch
            className="aiToggle"
            checked={aiActive}
            onClick={toggleAi}
            disabled={busy}
          />
          <div className="flex min-h-[2.75rem] min-w-0 flex-col gap-0.5">
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              Бот{' '}
              <span className="font-normal text-muted-foreground">
                {aiActive ? 'ведёт' : 'молчит'}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {aiActive
                ? 'Диалог ведёт бот. Выключи, чтобы забрать чат себе'
                : 'Чат за тобой. Включи, чтобы вернуть боту'}
            </span>
            {/* Две строки зарезервированы всегда: появление «что дальше» и причины
                паузы не меняет высоту блока. */}
            <span className="block min-h-4 text-xs leading-4">
              {nextAction && (
                <span className={NEXT_TONE[nextAction.tone]} data-testid="next-bot-action">
                  {nextAction.text}
                  {data.next_bot_action?.kind === 'no_reply' && data.next_bot_action?.why === 'not_scheduled' && (
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      className="ml-2 h-4 px-0 align-baseline"
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
                    </Button>
                  )}
                </span>
              )}
            </span>
            <span className="block min-h-4 text-xs leading-4">
              {pauseLabel && (
                <span data-testid="pause-reason" title={pauseReasonRaw}>
                  Почему молчит: {pauseLabel}
                  {pauseDetail && (
                    <span className="font-mono text-muted-foreground"> — {pauseDetail}</span>
                  )}
                </span>
              )}
            </span>
          </div>
        </div>
        <Badge
          variant={aiActive ? 'success' : 'warning'}
          className="min-w-[136px] rounded-full px-3 py-1 font-mono tracking-wide"
        >
          {aiActive ? '● БОТ ОТВЕЧАЕТ' : '● РУЧНОЙ РЕЖИМ'}
        </Badge>
      </div>

      {!aiActive && (
        <Card className="mx-4 mb-4 gap-0 rounded-lg py-0 shadow-none">
          {/* Высота фиксирована: плашки ответа и вложений отнимают место у поля
              ввода, а не у ленты. */}
          <div className="flex h-32 flex-col overflow-hidden rounded-t-lg">
            {reply && (
              <div className="flex h-9 shrink-0 items-center gap-2.5 border-b border-l-2 border-l-primary bg-primary/10 px-3 text-xs text-muted-foreground">
                <span className="shrink-0">Ответ на:</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{reply.text.slice(0, 120)}</span>
                <Button type="button" variant="ghost" size="icon" className={DROP} onClick={() => setReply(null)} title="Не отвечать">✕</Button>
              </div>
            )}
            {attachments.length === 1 && (
              <div className="flex h-14 shrink-0 items-center gap-2.5 border-b px-3 text-xs">
                {attach.preview && !attach.isVideo && <img className="size-10 shrink-0 rounded-md bg-muted object-cover" src={attach.preview} alt="" />}
                {attach.preview && attach.isVideo && <video className="size-10 shrink-0 rounded-md bg-muted object-cover" src={attach.preview} muted />}
                <span className="min-w-0 flex-1 truncate">{attach.name}</span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">{(attach.bytes / 1024 / 1024).toFixed(1)} МБ</span>
                {attach.kind === 'voice' && <span className="shrink-0 whitespace-nowrap text-primary">уйдёт голосовым</span>}
                <Button type="button" variant="ghost" size="icon" className={DROP} onClick={() => setAttachments([])} title="Убрать файл">✕</Button>
              </div>
            )}
            {attachments.length > 1 && (
              <div className="flex h-14 shrink-0 items-center gap-2.5 border-b px-3 text-xs" data-testid="album-bar">
                <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
                  {attachments.map((a, i) => (
                    <span key={a.path} className="relative size-10 flex-none overflow-hidden rounded-md bg-muted" title={a.name}>
                      {a.preview && !a.isVideo && <img className="block size-full object-cover" src={a.preview} alt="" />}
                      {a.preview && a.isVideo && <video className="block size-full object-cover" src={a.preview} muted />}
                      {!a.preview && <span className="flex h-full items-center justify-center text-[10px] text-muted-foreground uppercase">{a.name.split('.').pop()}</span>}
                      <button
                        type="button"
                        className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-background/80 text-[9px] leading-none text-foreground outline-none hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                        title="Убрать"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
                <span className="shrink-0 whitespace-nowrap text-primary">
                  {attachments.every((a) => a.kind === 'photo' || a.kind === 'video')
                    ? `альбом · ${attachments.length} шт.`
                    : `${attachments.length} файла — уйдут по одному`}
                </span>
                <Button type="button" variant="ghost" size="icon" className={DROP} onClick={() => setAttachments([])} title="Убрать все">✕</Button>
              </div>
            )}
            <div className="flex min-h-0 flex-1">
              <Textarea
                className="h-full min-h-0 resize-none rounded-none border-0 bg-transparent shadow-none field-sizing-fixed [field-sizing:fixed] focus-visible:ring-0 dark:bg-transparent"
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
          </div>
          <div className="flex items-center justify-between gap-2 border-t p-2">
            <div className="flex items-center gap-0.5">
              <input
                type="file"
                ref={fileInput}
                multiple
                style={{ display: 'none' }}
                onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={TOOL}
                title="Прикрепить файлы: фото, видео, гиф, голосовое или документ. Несколько фото и видео уйдут альбомом"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <Paperclip aria-hidden="true" />
              </Button>
              <span className="relative inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={TOOL}
                  title="Эмодзи"
                  onClick={() => setEmojiOpen((v) => !v)}
                >
                  <Smile aria-hidden="true" />
                </Button>
                {emojiOpen && (
                  <EmojiPicker
                    onPick={(emoji) => setDraft((d) => d + emoji)}
                    onClose={() => setEmojiOpen(false)}
                  />
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="px-2 text-xs font-semibold"
                title="Гифка по ссылке"
                disabled={busy}
                onClick={sendGifLink}
              >
                GIF
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="file"
                ref={voiceInput}
                accept="audio/*,.mp3,.m4a,.ogg,.oga,.wav,.opus"
                style={{ display: 'none' }}
                onChange={(e) => { sendVoiceFile(e.target.files?.[0]); e.target.value = ''; }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => voiceInput.current?.click()}
                disabled={busy}
                title="Выбрать аудиофайл — уйдёт голосовым (mp3, m4a, wav, ogg)"
              >
                <Mic aria-hidden="true" /> Голосовое
              </Button>
              <input
                type="file"
                ref={roundInput}
                accept="video/*,.mp4,.mov,.webm,.mkv"
                style={{ display: 'none' }}
                onChange={(e) => { sendRoundFile(e.target.files?.[0]); e.target.value = ''; }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => roundInput.current?.click()}
                disabled={busy}
                data-testid="send-round"
                title="Выбрать видео — уйдёт кружком: сервер обрежет его в квадрат и до минуты"
              >
                <CirclePlay aria-hidden="true" /> Кружком
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => send({ voice: false })}
                disabled={busy || (!draft.trim() && !attachments.length)}
              >
                <Send aria-hidden="true" /> Отправить
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

export default InputArea;
