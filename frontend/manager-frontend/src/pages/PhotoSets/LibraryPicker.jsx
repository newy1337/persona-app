import { useEffect, useMemo, useState } from 'react';
import { getChatLibrary, photoUrl, sendLibraryPhoto } from '../../api/photoSets';
import PhotoCard, { fmtDate } from './PhotoCard';
import { TagFilter } from './PhotoSets';
import s from '../../styles/AdminPage.module.scss';
import p from './PhotoSets.module.scss';

/** «Фото из образа»: библиотека аккаунта этого чата с отметками о показах собеседнику. */
export default function LibraryPicker({ chatId, replyTo, onClose, onSent }) {
  const [lib, setLib] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [onlyNew, setOnlyNew] = useState(false);
  const [picked, setPicked] = useState(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getChatLibrary(chatId).then(setLib).catch((e) => setError(e.detail || e.message));
  }, [chatId]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (lib?.items ?? []).filter((ph) => (!tag || ph.tags.includes(tag)) && (!onlyNew || !ph.sent_at) &&
      (!needle || [ph.description, ph.place ?? '', ph.details, ph.tags.join(' ')].join(' ').toLowerCase().includes(needle)));
  }, [lib, q, tag, onlyNew]);

  async function send() {
    if (!picked || busy) return;
    setBusy(true);
    setError('');
    try {
      await sendLibraryPhoto(chatId, { photoId: picked.id, caption: caption.trim(), replyTo });
      onSent?.();
      onClose();
    } catch (e) {
      setError(e.detail || e.message);
      setBusy(false);
    }
  }

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={`${s.modal} ${p.picker}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Фото из образа">
        <h3 className={s.modalTitle}>Фото из образа{lib?.set ? ` · ${lib.set.name}` : ''}</h3>
        {!lib && !error && <p className={s.modalText} role="status">Загружаем…</p>}
        {lib && !lib.set && <p className={s.modalText}>Аккаунту этого диалога не назначен образ. Назначить его можно во вкладке «Аккаунты».</p>}
        {lib?.set && (
          <>
            <p className={s.modalText}>
              Собеседник уже видел {lib.sent_total} фото.
              {!lib.set.auto_send || !lib.account_auto_send ? ' Бот сам фото не отправляет — только вручную.' : ''}
            </p>
            <div className={p.toolbar}>
              <input className={`${s.field} ${p.search}`} autoFocus placeholder="Кот, кафе, море…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по снимкам" />
              <label className={s.check} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
                Только неотправленные
              </label>
            </div>
            <TagFilter tags={lib.tags} value={tag} onChange={setTag} />
            {shown.length
              ? <div className={p.pickerGrid}>{shown.map((ph) => <PhotoCard key={ph.id} photo={ph} withSent picked={picked?.id === ph.id} onOpen={setPicked} />)}</div>
              : <p className={s.empty}>Ничего не нашлось.</p>}
          </>
        )}
        {picked && (
          <div className={p.editorBody} style={{ gridTemplateColumns: '96px 1fr' }}>
            <img className={p.preview} src={photoUrl(picked.id, true)} alt="" />
            <label className={s.label}>
              Подпись {picked.sent_at && <span className={p.flagWarn}>уже отправляли {fmtDate(picked.sent_at)}</span>}
              <textarea className={`${s.field} ${p.textarea}`} value={caption} maxLength={1024} onChange={(e) => setCaption(e.target.value)} placeholder={picked.taken_on ? `Снято: ${picked.taken_label}` : 'Дата съёмки неизвестна — не пишите «только что»'} />
            </label>
          </div>
        )}
        {error && <p className={s.error} role="alert">{error}</p>}
        <div className={s.modalActions}>
          <button type="button" className={s.btn} onClick={onClose}>Отмена</button>
          <button type="button" className={s.btnPrimary} disabled={!picked || busy} onClick={send}>{busy ? 'Отправляем…' : 'Отправить'}</button>
        </div>
      </div>
    </div>
  );
}
