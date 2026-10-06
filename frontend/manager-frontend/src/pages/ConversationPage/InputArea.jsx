import styles from './ConversationPage.module.scss';
import { nextActionLabel } from '../../utils/scenario';
import { answerNow } from '../../api/conversations';
import EmojiPicker from '../../components/composer/EmojiPicker';
import composer from '../../components/composer/Composer.module.scss';
import { SendIcon, MicIcon } from '../../assets/icons';

function RoundIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M10 9.5v5l4.5-2.5z" fill="currentColor" stroke="none" />
    </svg>
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
  return (
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
  );
}

export default InputArea;
