import { CirclePlay, Mic, Paperclip, Send, Smile, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { IconAction } from '@/components/IconAction/IconAction';
import { nextActionLabel } from '../../utils/scenario';
import { answerNow } from '../../api/conversations';
import EmojiPicker from '../../components/composer/EmojiPicker';

/* «Что дальше» — нейтральный текст; тон показывает только точка перед ним. */
const NEXT_DOT = {
  ok: 'bg-success-foreground',
  wait: 'bg-muted-foreground/50',
  warn: 'bg-warning-foreground',
};

// Полоса режима: строка 32px (тумблер, подпись, подсказка или ошибка) и две
// зарезервированные строки по 16px — «что дальше» и причина паузы. Те же классы
// собирают скелетон первой загрузки — высоты совпадают по построению.
const STRIP = 'flex flex-col gap-0.5 px-4 py-2';
const STRIP_ROW = 'flex h-8 min-w-0 items-center gap-3';
const STRIP_LINE = 'flex h-4 min-w-0 items-center gap-x-3 text-xs leading-4';
const DOT = 'size-1.5 shrink-0 rounded-full';

/** Первая загрузка: полоса режима тех же размеров, что у готовой страницы. */
export function InputAreaSkeleton() {
  return (
    <div className="shrink-0 border-t bg-background">
      <div className={STRIP}>
        <div className={STRIP_ROW}>
          <Skeleton className="h-[1.15rem] w-8 rounded-full" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-56 max-w-full max-sm:hidden" />
        </div>
        <div className={STRIP_LINE}>
          <Skeleton className="h-3 w-40" />
        </div>
        <div className={STRIP_LINE} />
      </div>
    </div>
  );
}

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
    <div className="shrink-0 border-t bg-background">
      <div className={STRIP}>
        <div className={STRIP_ROW}>
          <Switch
            className="aiToggle"
            checked={aiActive}
            onClick={toggleAi}
            disabled={busy}
            aria-label="Бот отвечает"
          />
          {/* Текст подписи проверяют тесты (заглавными); на экране — строчными. */}
          <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium lowercase">
            <span className={cn(DOT, aiActive ? 'bg-success-foreground' : 'bg-warning-foreground')} aria-hidden="true" />
            {aiActive ? 'БОТ ОТВЕЧАЕТ' : 'РУЧНОЙ РЕЖИМ'}
          </span>
          {/* Ошибка отправки занимает место подсказки: высота полосы не меняется,
              лента не прыгает и последние сообщения ничем не закрыты. */}
          {error ? (
            <span className="flex min-w-0 flex-1 items-center justify-end gap-1" data-testid="input-error">
              <span role="alert" title={error} className="line-clamp-2 min-w-0 text-xs leading-4 text-destructive [overflow-wrap:anywhere]">
                {error}
              </span>
              <IconAction icon={X} label="Скрыть ошибку" size="icon-xs" onClick={() => setError(null)} />
            </span>
          ) : (
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {aiActive
                ? 'Диалог ведёт бот. Выключи, чтобы забрать чат себе'
                : 'Чат за тобой. Включи, чтобы вернуть боту'}
            </span>
          )}
        </div>
        {/* Обе строки зарезервированы всегда: появление «что дальше» и причины
            паузы не меняет высоту блока. Текст, который не влез, обрезается. */}
        <div className={STRIP_LINE}>
          {nextAction && (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={cn(DOT, NEXT_DOT[nextAction.tone] || NEXT_DOT.wait)} aria-hidden="true" />
              <span className="min-w-0 truncate text-muted-foreground" title={nextAction.text} data-testid="next-bot-action">
                {nextAction.text}
              </span>
              {data.next_bot_action?.kind === 'no_reply' && data.next_bot_action?.why === 'not_scheduled' && (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-4 shrink-0 px-0"
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
        </div>
        <div className={STRIP_LINE}>
          {pauseLabel && (
            <span className="min-w-0 truncate" data-testid="pause-reason" title={pauseReasonRaw}>
              Почему молчит: {pauseLabel}
              {pauseDetail && (
                <span className="text-muted-foreground"> — {pauseDetail}</span>
              )}
            </span>
          )}
        </div>
      </div>

      {!aiActive && (
        <div className="mx-4 mb-4 rounded-lg border bg-card transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          {/* Высота фиксирована: плашки ответа и вложений отнимают место у поля
              ввода, а не у ленты. */}
          <div className="flex h-32 flex-col overflow-hidden rounded-t-lg">
            {reply && (
              <div className="flex h-9 shrink-0 items-center gap-2.5 border-b bg-muted/40 pr-1 pl-3 text-xs text-muted-foreground">
                <span className="shrink-0">Ответ на:</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{reply.text.slice(0, 120)}</span>
                <IconAction icon={X} label="Не отвечать" size="icon-xs" onClick={() => setReply(null)} />
              </div>
            )}
            {attachments.length === 1 && (
              <div className="flex h-14 shrink-0 items-center gap-2.5 border-b pr-1 pl-3 text-xs">
                {attach.preview && !attach.isVideo && <img className="size-10 shrink-0 rounded-md bg-muted object-cover" src={attach.preview} alt="" />}
                {attach.preview && attach.isVideo && <video className="size-10 shrink-0 rounded-md bg-muted object-cover" src={attach.preview} muted />}
                <span className="min-w-0 flex-1 truncate">{attach.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{(attach.bytes / 1024 / 1024).toFixed(1)} МБ</span>
                {attach.kind === 'voice' && <span className="shrink-0 whitespace-nowrap text-muted-foreground">уйдёт голосовым</span>}
                <IconAction icon={X} label="Убрать файл" size="icon-xs" onClick={() => setAttachments([])} />
              </div>
            )}
            {attachments.length > 1 && (
              <div className="flex h-14 shrink-0 items-center gap-2.5 border-b pr-1 pl-3 text-xs" data-testid="album-bar">
                <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none]">
                  {attachments.map((a, i) => (
                    <span key={a.path} className="relative size-10 flex-none overflow-hidden rounded-md bg-muted" title={a.name}>
                      {a.preview && !a.isVideo && <img className="block size-full object-cover" src={a.preview} alt="" />}
                      {a.preview && a.isVideo && <video className="block size-full object-cover" src={a.preview} muted />}
                      {!a.preview && <span className="flex h-full items-center justify-center text-[10px] text-muted-foreground">{a.name.split('.').pop().toUpperCase()}</span>}
                      <button
                        type="button"
                        className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-background/80 text-foreground outline-none hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                        aria-label={`Убрать ${a.name}`}
                        title="Убрать"
                      >
                        <X className="size-2.5" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
                <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                  {attachments.every((a) => a.kind === 'photo' || a.kind === 'video')
                    ? `альбом · ${attachments.length} шт.`
                    : `${attachments.length} файла — уйдут по одному`}
                </span>
                <IconAction icon={X} label="Убрать все" size="icon-xs" onClick={() => setAttachments([])} />
              </div>
            )}
            <div className="flex min-h-0 flex-1">
              {/* Своего кольца у поля нет: фокус показывает рамка всего блока (focus-within). */}
              <Textarea
                className="h-full min-h-0 resize-none rounded-none border-0 bg-transparent shadow-none field-sizing-fixed [field-sizing:fixed] focus-visible:ring-0 dark:bg-transparent"
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Сообщение… (Enter — отправить, Shift+Enter — перенос строки)"
                aria-label="Сообщение"
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
              <IconAction
                icon={Paperclip}
                label="Прикрепить файлы"
                hint="Прикрепить файлы: фото, видео, гиф, голосовое или документ. Несколько фото и видео уйдут альбомом"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              />
              <span className="relative inline-flex">
                <IconAction
                  icon={Smile}
                  label="Эмодзи"
                  aria-expanded={emojiOpen}
                  onClick={() => setEmojiOpen((v) => !v)}
                />
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
                className="px-2 text-xs text-muted-foreground hover:text-foreground"
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
        </div>
      )}
    </div>
  );
}

export default InputArea;
