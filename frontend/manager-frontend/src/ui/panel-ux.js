import { createActionStore, readableError } from './action-store';
export { createActionStore, readableError, actionLabels } from './action-store';

export function createPanelUX({ React, api, styles: s }) {
  const h = React.createElement;
  const { useState, useEffect, useRef, useId, useSyncExternalStore } = React;
  const actions = createActionStore(api);
  let confirmation = null;
  const confirmationListeners = new Set(), modalStack = [];
  let savedOverflow;
  const updateConfirmation = () => { for (const listener of confirmationListeners) listener(); };
  const subscribeConfirmation = listener => { confirmationListeners.add(listener); return () => confirmationListeners.delete(listener); };
  const useActions = () => useSyncExternalStore(actions.subscribe, actions.getSnapshot);
  function confirm(options) {
    if (confirmation) return Promise.resolve(false);
    const config = typeof options === 'string' ? { message: options } : options;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    confirmation = { ...config, resolve, promise };
    updateConfirmation();
    return promise;
  }
  function answer(value) {
    const previous = confirmation;
    confirmation = null;
    updateConfirmation();
    previous?.resolve(value);
  }
  function Modal({ title, children, footer, onClose, busy = false, wide = false }) {
    const ref = useRef(null), closeRef = useRef(onClose), busyRef = useRef(busy), titleId = useId();
    closeRef.current = onClose; busyRef.current = busy;
    useEffect(() => {
      const previous = document.activeElement, node = ref.current;
      if (!modalStack.length) { savedOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
      modalStack.push(node);
      const focusable = () => [...node.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(item => item.getClientRects().length);
      (node.querySelector('[data-autofocus]') || focusable()[0] || node).focus();
      function keydown(event) {
        if (modalStack.at(-1) !== node) return;
        if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
        if (event.key !== 'Tab') return;
        const fields = focusable(), first = fields[0], last = fields.at(-1);
        if (!first) { event.preventDefault(); node.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
      document.addEventListener('keydown', keydown, true);
      return () => {
        document.removeEventListener('keydown', keydown, true);
        modalStack.splice(modalStack.indexOf(node), 1);
        if (!modalStack.length) document.body.style.overflow = savedOverflow;
        if (previous?.isConnected) previous.focus();
      };
    }, []);
    return h('div', { className: 'ux-overlay', onMouseDown: event => { if (event.target === event.currentTarget && !busy) onClose(); } },
      h('section', { ref, className: `ux-modal ${wide ? 'ux-modal-wide' : ''}`, role: 'dialog', 'aria-modal': true, 'aria-labelledby': titleId, tabIndex: -1, 'aria-busy': busy },
        h('header', { className: 'ux-modal-head' }, h('h3', { id: titleId }, title)),
        h('div', { className: 'ux-modal-body' }, children),
        footer && h('footer', { className: 'ux-modal-footer' }, footer)));
  }
  function FeedbackHost() {
    const state = useActions();
    const question = useSyncExternalStore(subscribeConfirmation, () => confirmation);
    return h(React.Fragment, null,
      h('div', { className: 'ux-notices', 'aria-label': 'Результаты действий' }, state.notices.map(item => h('div', { key: item.id, className: `ux-notice ux-notice-${item.status}`, role: item.status === 'error' ? 'alert' : 'status', 'aria-live': item.status === 'error' ? 'assertive' : 'polite' },
        h('span', { className: 'ux-notice-icon', 'aria-hidden': true }, item.status === 'pending' ? '◌' : item.status === 'success' ? '✓' : '!'),
        h('span', null, item.text),
        item.status !== 'pending' && h('button', { type: 'button', 'aria-label': 'Закрыть уведомление', onClick: () => actions.dismiss(item.id) }, '×')))),
      question && h(Modal, { title: question.title || 'Подтвердите действие', onClose: () => answer(false), footer: h(React.Fragment, null,
        h('button', { type: 'button', className: s.btn, 'data-autofocus': true, onClick: () => answer(false) }, 'Отмена'),
        h('button', { type: 'button', className: question.danger ? s.btnDanger : s.btnPrimary, onClick: () => answer(true) }, question.confirmLabel || 'Подтвердить')) }, h('p', { className: 'ux-confirm-text' }, question.message)));
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
      h('button', { type: 'button', className: s.btn, disabled: busy, 'data-autofocus': true, onClick: onCancel }, 'Отмена'),
      h('button', { type: 'button', className: s.btnDanger, disabled: busy, onClick: submit }, busy ? 'Удаляем…' : telegram ? 'Удалить с перепиской' : 'Удалить')) },
      h('p', { className: 'ux-confirm-text' }, lead.telegram_user_id ? 'Удалятся переписка в панели, память бота и карточка. Если добавить этого человека снова, знакомство начнётся заново.' : 'Удалится только запись лида в базе.'),
      lead.telegram_user_id && h('label', { className: 'ux-check' }, h('input', { type: 'checkbox', checked: telegram, disabled: busy, onChange: event => setTelegram(event.target.checked) }), 'Удалить переписку в Telegram у обоих участников'),
      telegram && h('p', { className: 'ux-inline-error' }, 'Сообщения исчезнут у обоих. Отменить это нельзя.'),
      error && h('p', { className: 'ux-inline-error', role: 'alert' }, error));
  }
  return { Modal, FeedbackHost, DeleteLeadModal, confirm, useActions, readableError, ...actions };
}
