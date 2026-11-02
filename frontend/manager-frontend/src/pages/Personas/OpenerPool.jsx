import s from '../../styles/AdminPage.module.scss';
import p from './Personas.module.scss';

/** Разделитель вариантов в тексте промпта — так пул хранится и выгружается в файл. */
export const OPENER_SEP = '\n---\n';

/** Варианты пула; пустые строки остаются, чтобы новый вариант не пропадал из формы. */
export function splitOpeners(text) {
  return String(text ?? '').split(/\n[ \t]*---[ \t]*\n/);
}

export const joinOpeners = (variants) => variants.join(OPENER_SEP);

export const variantsWord = (n) =>
  n % 10 === 1 && n % 100 !== 11
    ? 'вариант'
    : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)
      ? 'варианта'
      : 'вариантов';

/** Пул первых сообщений: каждому лиду бэкенд берёт случайный непустой вариант. */
export default function OpenerPool({ value, onChange }) {
  const variants = splitOpeners(value);
  const filled = variants.filter((v) => v.trim()).length;
  const change = (next) => onChange(joinOpeners(next));

  return (
    <div className={p.openerPool}>
      {variants.map((text, i) => (
        <div key={i} className={p.openerRow}>
          <span className={p.openerNum}>{i + 1}</span>
          <textarea
            className={`${s.field} ${p.promptText}`}
            rows={2}
            spellCheck={false}
            aria-label={`Первое сообщение, вариант ${i + 1}`}
            placeholder="Привет, это {name} с {site}"
            value={text}
            onChange={(e) => change(variants.map((v, j) => (j === i ? e.target.value : v)))}
          />
          {variants.length > 1 && (
            <button
              type="button"
              className={s.btnSm}
              aria-label={`Удалить вариант ${i + 1}`}
              title="Удалить вариант"
              onClick={() => change(variants.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <div className={p.openerFoot}>
        <button type="button" className={s.btnSm} onClick={() => change([...variants, ''])}>
          + Добавить вариант
        </button>
        <span className={s.muted}>
          {filled > 1 ? `${filled} ${variantsWord(filled)} в пуле — каждому лиду уходит случайный` : 'Один вариант — уходит всем лидам'}
        </span>
      </div>
    </div>
  );
}
