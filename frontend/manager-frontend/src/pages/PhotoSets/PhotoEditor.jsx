import { useState } from 'react';
import { photoUrl, updateSetPhoto } from '../../api/photoSets';
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

export function tagsText(tags) {
  return (tags ?? []).join(', ');
}

export function parseTagsText(text) {
  return [...new Set(String(text).split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))];
}

export const TAKEN_HINT = 'ГГГГ, ГГГГ-ММ или ГГГГ-ММ-ДД';

/** Карточка снимка: что на нём, где и когда снято, что важно не перепутать. */
export default function PhotoEditor({ photo, canEdit, onClose, onSaved, onDelete, onCover }) {
  const [f, setF] = useState({
    description: photo.description ?? '',
    place: photo.place ?? '',
    taken_on: photo.taken_on ?? '',
    details: photo.details ?? '',
    tags: tagsText(photo.tags),
    auto_send: photo.auto_send,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setF((v) => ({ ...v, ...patch }));

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await updateSetPhoto(photo.id, {
        description: f.description,
        place: f.place.trim() || null,
        taken_on: f.taken_on.trim() || null,
        details: f.details,
        tags: parseTagsText(f.tags),
        auto_send: f.auto_send,
      });
      onSaved(saved);
    } catch (err) {
      setError(err.detail || err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent portal={false} showCloseButton={false} className="sm:max-w-2xl" aria-describedby={undefined}>
        <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={save} aria-label="Карточка снимка">
          <DialogHeader>
            <DialogTitle>Фото #{photo.id}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid content-start items-start gap-4 sm:grid-cols-[200px_1fr]">
            <img className="w-full rounded-md bg-muted" src={photoUrl(photo.id, true)} alt="" />
            <div className="grid gap-3">
              <Field label="Что изображено">
                <Textarea disabled={!canEdit} value={f.description} maxLength={1000} onChange={(e) => set({ description: e.target.value })} />
              </Field>
              <Field label="Где снято">
                <Input disabled={!canEdit} value={f.place} maxLength={200} onChange={(e) => set({ place: e.target.value })} placeholder="Неизвестно" />
              </Field>
              <Field label="Когда снято">
                <Input disabled={!canEdit} value={f.taken_on} maxLength={10} onChange={(e) => set({ taken_on: e.target.value })} placeholder="Дата неизвестна" title={TAKEN_HINT} />
              </Field>
              <Field label="Важные детали">
                <Textarea disabled={!canEdit} value={f.details} maxLength={1000} onChange={(e) => set({ details: e.target.value })} />
              </Field>
              <Field label="Теги через запятую">
                <Input disabled={!canEdit} value={f.tags} onChange={(e) => set({ tags: e.target.value })} />
              </Field>
              <Label className="cursor-pointer font-normal">
                <NativeCheckbox disabled={!canEdit} checked={f.auto_send} onChange={(e) => set({ auto_send: e.target.checked })} />
                Бот может отправлять сам
              </Label>
            </div>
          </DialogBody>
          <DialogError role={error ? 'alert' : undefined}>{error}</DialogError>
          <DialogFooter>
            {canEdit && onDelete && <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => onDelete(photo)}>Убрать из образа</Button>}
            {canEdit && onCover && <Button type="button" variant="outline" disabled={busy} onClick={() => onCover(photo)}>Сделать обложкой</Button>}
            <span className="flex-1" />
            <Button type="button" variant="outline" onClick={onClose}>{canEdit ? 'Отмена' : 'Закрыть'}</Button>
            {canEdit && <Button type="submit" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить'}</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
