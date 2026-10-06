import React from 'react';
import { api } from '../../api/client';
import s from '../../styles/AdminPage.module.scss';
import { getAccounts as loadAccounts } from '../../api/accounts';

const h = React.createElement;
const { useState, useEffect } = React;
const errorText = e => {
  const message = e.detail || e.message || 'Не удалось выполнить действие';
  return Array.isArray(message) ? message.join('; ') : String(message);
};
const button = (text, onClick, props = {}) => h('button', { type: 'button', className: s.btnSm, onClick, ...props }, text);

export function CreateLeadForm({ personas, onDone, onCancel, PersonaSelect }) {
  const [draft, setDraft] = useState({ phone: '', first_name: '', city: '', age: '', site: '', persona_id: '', preferred_account_id: '' });
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError('');
    loadAccounts().then(rows => { if (active) setAccounts(rows); }).catch(e => { if (active) setLoadError(errorText(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload]);
  const change = patch => setDraft(previous => ({ ...previous, ...patch }));
  const valid = draft.phone.replace(/\D/g, '').length >= 10 || /^@?[a-zA-Z][\w]{3,}$|t\.me\//.test(draft.phone.trim());
  const available = accounts.filter(a => a.status === 'active' && personas.some(p => p.slug === a.persona_id) && (!draft.persona_id || a.persona_id === draft.persona_id));
  async function submit(e) {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true); setError('');
    try {
      await api.post('/api/leads', { phone: draft.phone, first_name: draft.first_name || undefined, city: draft.city || undefined, age: draft.age ? Number(draft.age) : undefined, site: draft.site.trim() || undefined, persona_id: draft.persona_id || undefined, preferred_account_id: draft.preferred_account_id ? Number(draft.preferred_account_id) : undefined });
      onDone();
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  }
  const input = (key, title, props = {}) => h('label', { className: s.label }, title, h('input', { className: s.field, value: draft[key], disabled: busy, onChange: e => change({ [key]: e.target.value }), ...props }));
  return h('form', { className: s.form, onSubmit: submit, 'aria-label': 'Добавление лида' },
    input('phone', 'Телефон или @username', { autoFocus: true, placeholder: '+7 900 123-45-67 или @name', maxLength: 64 }),
    input('first_name', 'Имя', { maxLength: 64 }), input('city', 'Город', { maxLength: 64 }),
    input('age', 'Возраст', { inputMode: 'numeric' }), input('site', 'Сайт знакомств', { placeholder: 'beboo', maxLength: 64 }),
    h('label', { className: s.label }, 'С какой личности писать', draft.preferred_account_id ? h('select', { className: s.select, disabled: true, value: draft.persona_id, title: 'Личность выбранного аккаунта' }, h('option', { value: draft.persona_id }, personas.find(p => p.slug === draft.persona_id)?.name || draft.persona_id)) : h(PersonaSelect, { personas, value: draft.persona_id, onChange: value => change({ persona_id: value }) })),
    h('div', { className: `${s.formFull} mr-lead-sender` },
      h('label', { className: s.label }, 'Telegram-аккаунт для первого сообщения',
        h('select', { className: s.select, value: draft.preferred_account_id, disabled: busy || loading, onChange: e => {
          const chosen = accounts.find(a => a.id === Number(e.target.value));
          change({ preferred_account_id: e.target.value, ...(chosen ? { persona_id: chosen.persona_id } : {}) });
        } }, h('option', { value: '' }, loading ? 'Загружаем аккаунты…' : 'Автоматически'), available.map(a => h('option', { key: a.id, value: String(a.id) }, [a.username ? `@${a.username}` : a.first_name || a.phone_e164 || `Аккаунт #${a.id}`, a.username ? a.phone_e164 : null, personas.find(p => p.slug === a.persona_id)?.name].filter(Boolean).join(' · '))))),
      h('p', { className: 'mr-caption' }, draft.preferred_account_id ? 'Напишет только выбранный аккаунт. Если он временно недоступен, лид останется в очереди.' : 'Без выбора аккаунт подбирается автоматически, как раньше.'),
      !loading && !loadError && available.length === 0 && h('p', { className: 'mr-caption' }, 'Нет включённых аккаунтов для этой личности.'),
      loadError && h('div', { role: 'alert' }, h('p', { className: s.error }, `Не удалось загрузить аккаунты: ${loadError}`), button('Повторить', () => setReload(n => n + 1)))),
    error && h('p', { className: `${s.error} ${s.formFull}`, role: 'alert' }, error),
    h('div', { className: `${s.formFull} ${s.actions}` }, button('Отмена', onCancel, { className: s.btn, disabled: busy }), h('button', { type: 'submit', className: s.btnPrimary, disabled: busy || !valid }, busy ? 'Добавляем…' : 'Добавить')));
}
