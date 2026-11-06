import { useEffect, useState } from 'react';
import { getModelOptions } from '../../api/personas';
import { setChatModels } from '../../api/conversations';
import { PanelUX } from '../../ui/PanelUX';
import { ShortIcon } from '../../assets/icons';
import styles from './ConversationPage.module.scss';

const FIELDS = [
  { key: 'generator_model', label: 'Модель ответов', list: 'generator' },
  { key: 'judge_model', label: 'Модель судей', list: 'judge' },
  { key: 'generator_effort', label: 'Рассуждение ответов', list: 'effort' },
  { key: 'judge_effort', label: 'Рассуждение судей', list: 'effort' },
];

/**
 * Модели для этого диалога (только админ): перекрывают выбор личности.
 * «Как у личности» — поле не трогаем.
 */
export default function ChatModels({ chatId, value }) {
  const [options, setOptions] = useState(null);
  const [chosen, setChosen] = useState(value ?? {});
  const [busy, setBusy] = useState(false);

  useEffect(() => { getModelOptions().then(setOptions).catch(() => setOptions(null)); }, []);
  useEffect(() => { setChosen(value ?? {}); }, [chatId, value]);

  if (!options) return null;
  const own = FIELDS.filter((f) => chosen[f.key]).length;

  async function save(key, next) {
    setBusy(true);
    try { setChosen(await setChatModels(chatId, { [key]: next || null })); }
    catch (e) { PanelUX.error?.(e.detail || e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className={styles.summarySection} data-testid="chat-models">
      <div className={styles.summaryHeader}>
        <span className={styles.summaryTitle}>
          <span className={styles.summaryIcon}><ShortIcon /></span>
          Модели диалога
        </span>
        <span className={styles.summaryTag} title="Сколько настроек выбрано для этого диалога">
          {own ? `своих: ${own}` : 'как у личности'}
        </span>
      </div>
      <div className={styles.cardBody}>
        {FIELDS.map((f) => (
          <label key={f.key} className={styles.modelRow}>
            <span className={styles.checkLabel}>{f.label}</span>
            <select
              className={styles.modelSelect}
              aria-label={f.label}
              disabled={busy}
              value={chosen[f.key] ?? ''}
              onChange={(e) => save(f.key, e.target.value)}
            >
              <option value="">как у личности</option>
              {(options[f.list] ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
