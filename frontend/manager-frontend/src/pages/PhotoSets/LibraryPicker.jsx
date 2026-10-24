import { useEffect, useMemo, useState } from 'react';
import { getChatLibrary, photoUrl, sendLibraryPhoto } from '../../api/photoSets';
import PhotoCard, { fmtDate } from './PhotoCard';
import { TagFilter } from './PhotoSets';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogError,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeCheckbox } from '@/components/ui/native-checkbox';
import { Textarea } from '@/components/ui/textarea';

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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent portal={false} showCloseButton={false} className="sm:max-w-4xl" aria-label="Фото из образа" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Фото из образа{lib?.set ? ` · ${lib.set.name}` : ''}</DialogTitle>
        </DialogHeader>
        <DialogBody className="grid content-start gap-3">
          {!lib && !error && <p className="text-sm text-muted-foreground" role="status">Загружаем…</p>}
          {lib && !lib.set && <p className="text-sm text-muted-foreground">Образ не назначен</p>}
          {lib?.set && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Input className="min-w-[220px] flex-1" autoFocus placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по снимкам" />
                <Label className="cursor-pointer font-normal">
                  <NativeCheckbox checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} />
                  Только неотправленные
                </Label>
              </div>
              <TagFilter tags={lib.tags} value={tag} onChange={setTag} />
              {shown.length
                ? <div className="grid max-h-[52vh] grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 overflow-y-auto pr-1">{shown.map((ph) => <PhotoCard key={ph.id} photo={ph} withSent picked={picked?.id === ph.id} onOpen={setPicked} />)}</div>
                : <p className="text-sm text-muted-foreground">Ничего не нашлось.</p>}
            </>
          )}
          {picked && (
            <div className="grid grid-cols-[96px_1fr] items-start gap-3">
              <img className="w-full rounded-md bg-muted" src={photoUrl(picked.id, true)} alt="" />
              <Field label={<span className="flex flex-wrap items-center gap-2">Подпись {picked.sent_at && <Badge variant="warning">уже отправляли {fmtDate(picked.sent_at)}</Badge>}</span>}>
                <Textarea value={caption} maxLength={1024} onChange={(e) => setCaption(e.target.value)} placeholder={picked.taken_label} />
              </Field>
            </div>
          )}
        </DialogBody>
        <DialogError role={error ? 'alert' : undefined}>{error}</DialogError>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Отмена</Button>
          <Button type="button" disabled={!picked || busy} onClick={send}>{busy ? 'Отправляем…' : 'Отправить'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
