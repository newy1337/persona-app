import { AlertCircle, Check, Loader2, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { NativeCheckbox } from '../components/ui/native-checkbox';
import { cn } from '../lib/utils';
import { createActionStore, readableError } from './action-store';
export { createActionStore, readableError, actionLabels } from './action-store';

export function createPanelUX({ React, api }) {
  const h = React.createElement;
  const { useState, useRef, useSyncExternalStore } = React;
  const store = createActionStore(api);
  let confirmation = null;
  const listenerSet = new Set();
  const updateConfirmation = () => { for (const listener of listenerSet) listener(); };
  const subscribeConfirmation = listener => { listenerSet.add(listener); return () => listenerSet.delete(listener); };
  const useActions = () => useSyncExternalStore(store.subscribe, store.getSnapshot);
  function confirm(input) {
    if (confirmation) return Promise.resolve(false);
    const config = typeof input === 'string' ? { message: input } : input;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    confirmation = { ...config, resolve, promise };
    updateConfirmation();
    return promise;
  }
  function answer(value) {
    const current = confirmation;
    confirmation = null;
    updateConfirmation();
    current?.resolve(value);
  }
  // Окно всегда из трёх частей: заголовок, прокручиваемое тело и подвал с
  // действиями (outline «Отмена» + одна главная кнопка). Отступы, шрифты и шаг
  // между частями — от примитива Dialog; линий и заливок между частями нет.
  // described — в children есть DialogDescription (confirm, удаление лида): тогда
  // Radix сам связывает окно с описанием. У окон-форм описания нет, и связь
  // снимаем явно, иначе Radix предупреждает в консоли.
  function Modal({ title, children, footer, onClose, busy = false, wide = false, described = false }) {
    const closeRef = useRef(onClose), busyRef = useRef(busy);
    closeRef.current = onClose; busyRef.current = busy;
    // Кто открыл окно — туда и возвращаем фокус при закрытии. Снимок берём
    // при первом рендере: эффекты FocusScope уже успели бы перевести фокус внутрь.
    const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));
    const blockWhenBusy = event => { if (busyRef.current) event.preventDefault(); };
    return h(Dialog, { open: true, onOpenChange: open => { if (!open) closeRef.current(); } },
      h(DialogContent, {
        portal: false,
        showCloseButton: false,
        className: cn('overflow-hidden', wide && 'sm:max-w-2xl'),
        'aria-busy': busy,
        ...(described ? null : { 'aria-describedby': undefined }),
        onOpenAutoFocus: event => {
          const target = event.currentTarget?.querySelector?.('[data-autofocus]');
          if (target) { event.preventDefault(); target.focus(); }
        },
        onCloseAutoFocus: event => {
          event.preventDefault();
          if (opener?.isConnected && typeof opener.focus === 'function') opener.focus();
        },
        onEscapeKeyDown: blockWhenBusy,
        onPointerDownOutside: blockWhenBusy,
        onInteractOutside: blockWhenBusy,
      },
      h(DialogHeader, null,
        h(DialogTitle, null, title)),
      h(DialogBody, { className: 'text-sm' }, children),
      footer && h(DialogFooter, null, footer)));
  }
  // Уведомление — нейтральная карточка; статус несёт только иконка слева.
  const noticeIcon = status => status === 'pending'
    ? h(Loader2, { className: 'size-4 shrink-0 animate-spin text-muted-foreground', 'aria-hidden': true })
    : status === 'success'
      ? h(Check, { className: 'size-4 shrink-0 text-success-foreground', 'aria-hidden': true })
      : h(AlertCircle, { className: 'size-4 shrink-0 text-destructive', 'aria-hidden': true });
  function FeedbackHost() {
    const state = useActions();
    const question = useSyncExternalStore(subscribeConfirmation, () => confirmation);
    const noticeList = state.notices;
    return h(React.Fragment, null,
      h('div', { className: 'pointer-events-none fixed top-[calc(var(--header-h)+1rem)] right-5 z-[70] grid w-[min(360px,calc(100vw-2.5rem))] gap-2', 'aria-label': 'Результаты действий' },
        noticeList.map(item => h('div', {
          key: item.id,
          role: item.status === 'error' ? 'alert' : 'status',
          'aria-live': item.status === 'error' ? 'assertive' : 'polite',
          className: 'pointer-events-auto flex min-h-11 items-center gap-2.5 rounded-lg border bg-popover py-1.5 pr-2 pl-3 text-sm text-popover-foreground shadow-sm',
        },
        noticeIcon(item.status),
        h('span', { className: 'min-w-0 flex-1 [overflow-wrap:anywhere]' }, item.text),
        item.status === 'pending'
          ? h('span', { className: 'size-7 shrink-0', 'aria-hidden': true })
          : h(Button, { type: 'button', variant: 'ghost', size: 'icon-xs', className: 'text-muted-foreground hover:text-foreground', 'aria-label': 'Закрыть уведомление', onClick: () => store.dismiss(item.id) }, h(X, { 'aria-hidden': true }))))),
      question && h(Modal, { title: question.title || 'Подтвердите действие', described: true, onClose: () => answer(false), footer: h(React.Fragment, null,
        h(Button, { type: 'button', variant: 'outline', 'data-autofocus': true, onClick: () => answer(false) }, 'Отмена'),
        h(Button, { type: 'button', variant: question.danger ? 'destructive' : 'default', onClick: () => answer(true) }, question.confirmLabel || 'Подтвердить')) },
      h(DialogDescription, { className: 'whitespace-pre-line [overflow-wrap:anywhere]' }, question.message)));
  }
  function DeleteLeadModal({ lead, onCancel, onConfirm }) {
    const [telegram, setTelegram] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const lock = useRef(false);
    async function submit() {
      if (lock.current) return;
      lock.current = true; setBusy(true); setError('');
      try { await onConfirm({ telegram }); }
      catch (e) { setError(readableError(e)); }
      finally { lock.current = false; setBusy(false); }
    }
    return h(Modal, { title: `Удалить лид ${lead.phone_e164 || '@' + lead.username}?`, described: true, busy, onClose: onCancel, footer: h(React.Fragment, null,
      h(Button, { type: 'button', variant: 'outline', disabled: busy, 'data-autofocus': true, onClick: onCancel }, 'Отмена'),
      h(Button, { type: 'button', variant: 'destructive', disabled: busy, onClick: submit }, busy ? 'Удаляем…' : telegram ? 'Удалить с перепиской' : 'Удалить')) },
    h(DialogDescription, { className: 'whitespace-pre-line [overflow-wrap:anywhere]' }, lead.telegram_user_id ? 'Удалятся переписка в панели, память бота и карточка. Если добавить этого человека снова, знакомство начнётся заново.' : 'Удалится только запись лида в базе.'),
    lead.telegram_user_id && h('label', { className: 'mt-3 flex cursor-pointer items-start gap-2 text-sm text-foreground' },
      h(NativeCheckbox, { className: 'mt-0.5', checked: telegram, disabled: busy, onChange: event => setTelegram(event.target.checked) }),
      'Удалить переписку в Telegram у обоих участников'),
    lead.telegram_user_id && h('div', { className: 'mt-2 min-h-4 text-xs text-destructive' }, telegram && h('p', null, 'Сообщения исчезнут у обоих. Отменить это нельзя.')),
    h('div', { className: 'mt-2 min-h-4 text-xs text-destructive' }, error && h('p', { role: 'alert' }, error)));
  }
  return { Modal, FeedbackHost, DeleteLeadModal, confirm, useActions, readableError, ...store };
}
