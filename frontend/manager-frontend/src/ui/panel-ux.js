import { AlertCircle, Check, Loader2, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog';
import { NativeCheckbox } from '../components/ui/native-checkbox';
import { cn } from '../lib/utils';
import { createActionStore, readableError } from './action-store';
export { createActionStore, readableError, actionLabels } from './action-store';

/* Компенсация ширины полосы прокрутки от react-remove-scroll (внутри Radix
   Dialog) не нужна: html уже держит место под неё через scrollbar-gutter: stable,
   и лишний margin-right сдвигал бы страницу на 15px при открытии окна. */
const SCROLL_LOCK_FIX = 'html body[data-scroll-locked]{margin-right:0!important}';

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
  function Modal({ title, children, footer, onClose, busy = false, wide = false }) {
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
        className: cn('flex max-h-[calc(100dvh-3rem)] flex-col gap-0 overflow-hidden p-0', wide && 'sm:max-w-2xl'),
        'aria-busy': busy,
        'aria-describedby': undefined,
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
      h('div', { className: 'shrink-0 border-b px-5 py-4' },
        h(DialogTitle, { className: 'text-base leading-snug font-semibold [overflow-wrap:anywhere]' }, title)),
      h('div', { className: 'min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 text-sm leading-relaxed [scrollbar-gutter:stable]' }, children),
      footer && h('div', { className: 'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-muted/30 px-5 py-4' }, footer)));
  }
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
      h('style', null, SCROLL_LOCK_FIX),
      h('div', { className: 'pointer-events-none fixed top-[calc(var(--header-h)+1rem)] right-5 z-[70] grid w-[min(380px,calc(100vw-2.5rem))] gap-2', 'aria-label': 'Результаты действий' },
        noticeList.map(item => h('div', {
          key: item.id,
          role: item.status === 'error' ? 'alert' : 'status',
          'aria-live': item.status === 'error' ? 'assertive' : 'polite',
          className: cn('pointer-events-auto flex min-h-11 items-center gap-2.5 rounded-lg border bg-popover px-3.5 py-2 text-sm text-popover-foreground shadow-lg',
            item.status === 'success' && 'border-success-foreground/40',
            item.status === 'error' && 'border-destructive/50'),
        },
        noticeIcon(item.status),
        h('span', { className: 'min-w-0 flex-1 [overflow-wrap:anywhere]' }, item.text),
        item.status === 'pending'
          ? h('span', { className: 'size-7 shrink-0', 'aria-hidden': true })
          : h(Button, { type: 'button', variant: 'ghost', size: 'icon', className: 'size-7', 'aria-label': 'Закрыть уведомление', onClick: () => store.dismiss(item.id) }, h(X, { className: 'size-4' }))))),
      question && h(Modal, { title: question.title || 'Подтвердите действие', onClose: () => answer(false), footer: h(React.Fragment, null,
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
    return h(Modal, { title: `Удалить лид ${lead.phone_e164 || '@' + lead.username}?`, busy, onClose: onCancel, footer: h(React.Fragment, null,
      h(Button, { type: 'button', variant: 'outline', disabled: busy, 'data-autofocus': true, onClick: onCancel }, 'Отмена'),
      h(Button, { type: 'button', variant: 'destructive', disabled: busy, onClick: submit }, busy ? 'Удаляем…' : telegram ? 'Удалить с перепиской' : 'Удалить')) },
    h(DialogDescription, { className: 'whitespace-pre-line [overflow-wrap:anywhere]' }, lead.telegram_user_id ? 'Удалятся переписка в панели, память бота и карточка. Если добавить этого человека снова, знакомство начнётся заново.' : 'Удалится только запись лида в базе.'),
    lead.telegram_user_id && h('label', { className: 'mt-4 flex cursor-pointer items-start gap-2.5 text-sm text-foreground' },
      h(NativeCheckbox, { className: 'mt-0.5', checked: telegram, disabled: busy, onChange: event => setTelegram(event.target.checked) }),
      'Удалить переписку в Telegram у обоих участников'),
    lead.telegram_user_id && h('div', { className: 'mt-3 min-h-5 text-xs text-destructive' }, telegram && h('p', null, 'Сообщения исчезнут у обоих. Отменить это нельзя.')),
    h('div', { className: 'mt-3 min-h-5 text-xs text-destructive' }, error && h('p', { role: 'alert' }, error)));
  }
  return { Modal, FeedbackHost, DeleteLeadModal, confirm, useActions, readableError, ...store };
}
