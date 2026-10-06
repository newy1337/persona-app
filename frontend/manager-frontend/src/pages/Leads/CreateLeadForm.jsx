import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../api/client';
import { getAccounts as loadAccounts } from '../../api/accounts';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

const errorText = e => {
  const message = e.detail || e.message || 'Не удалось выполнить действие';
  return Array.isArray(message) ? message.join('; ') : String(message);
};
const EMPTY_DRAFT = { phone: '', first_name: '', city: '', age: '', site: '', persona_id: '', preferred_account_id: '' };

export function CreateLeadForm({ personas, onDone, onCancel, PersonaSelect }) {
  const [draft, setDraft] = useState(EMPTY_DRAFT);
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
  const personaName = slug => personas.find(p => p.slug === slug)?.name;
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
  const input = (key, title, props = {}) => (
    <Field label={title}>
      <Input value={draft[key]} disabled={busy} onChange={e => change({ [key]: e.target.value })} {...props} />
    </Field>
  );
  const accountLabel = a => [a.username ? `@${a.username}` : a.first_name || a.phone_e164 || `Аккаунт #${a.id}`, a.username ? a.phone_e164 : null, personaName(a.persona_id)].filter(Boolean).join(' · ');
  return (
    <Card className="mb-6 gap-0 py-4">
      <CardContent className="px-4">
        <form className="grid gap-x-3 gap-y-1 sm:grid-cols-2 lg:grid-cols-3" onSubmit={submit} aria-label="Добавление лида">
          {input('phone', 'Телефон или @username', { autoFocus: true, placeholder: '+7 900 123-45-67 или @name', maxLength: 64 })}
          {input('first_name', 'Имя', { maxLength: 64 })}
          {input('city', 'Город', { maxLength: 64 })}
          {input('age', 'Возраст', { inputMode: 'numeric' })}
          {input('site', 'Сайт знакомств', { placeholder: 'beboo', maxLength: 64 })}
          <Field label="С какой личности писать">
            {draft.preferred_account_id ? (
              <NativeSelect disabled value={draft.persona_id} title="Личность выбранного аккаунта">
                <option value={draft.persona_id}>{personaName(draft.persona_id) || draft.persona_id}</option>
              </NativeSelect>
            ) : (
              <PersonaSelect personas={personas} value={draft.persona_id} onChange={value => change({ persona_id: value })} />
            )}
          </Field>
          <div className="mr-lead-sender col-span-full min-w-0" data-testid="lead-sender">
            <Field
              label="Telegram-аккаунт для первого сообщения"
              hint={draft.preferred_account_id ? 'Напишет только выбранный аккаунт. Если он временно недоступен, лид останется в очереди.' : 'Без выбора аккаунт подбирается автоматически, как раньше.'}
            >
              <NativeSelect
                value={draft.preferred_account_id}
                disabled={busy || loading}
                onChange={e => {
                  const chosen = accounts.find(a => a.id === Number(e.target.value));
                  change({ preferred_account_id: e.target.value, ...(chosen ? { persona_id: chosen.persona_id } : {}) });
                }}
              >
                <option value="">{loading ? 'Загружаем аккаунты…' : 'Автоматически'}</option>
                {available.map(a => <option key={a.id} value={String(a.id)}>{accountLabel(a)}</option>)}
              </NativeSelect>
            </Field>
            <p className="min-h-4 text-xs text-muted-foreground">
              {!loading && !loadError && available.length === 0 ? 'Нет включённых аккаунтов для этой личности.' : null}
            </p>
            {loadError && (
              <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-destructive">
                <p>{`Не удалось загрузить аккаунты: ${loadError}`}</p>
                <Button type="button" size="sm" variant="outline" onClick={() => setReload(n => n + 1)}>Повторить</Button>
              </div>
            )}
          </div>
          <p className="col-span-full min-h-4 text-xs text-destructive" role="alert">{error}</p>
          <div className="col-span-full flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Отмена</Button>
            <Button type="submit" disabled={busy || !valid}>
              {busy && <Loader2 className="animate-spin" />}
              {busy ? 'Добавляем…' : 'Добавить'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
