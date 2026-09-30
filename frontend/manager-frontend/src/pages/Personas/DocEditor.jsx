import { useEffect, useMemo, useState } from 'react';
import { ValueEditor, hintFor, label } from './fields';
import s from '../../styles/AdminPage.module.scss';
import p from './Personas.module.scss';

const isPlain = (v) => v === null || typeof v !== 'object';

function countOf(v) {
  if (Array.isArray(v)) return String(v.length);
  if (v && typeof v === 'object') return String(Object.keys(v).filter((k) => !k.startsWith('_')).length);
  return null;
}

export default function DocEditor({ doc, onChange }) {
  const keys = useMemo(() => Object.keys(doc ?? {}).filter((k) => !k.startsWith('_')), [doc]);
  const plainKeys = useMemo(() => keys.filter((k) => isPlain(doc[k])), [keys, doc]);
  const groupKeys = useMemo(() => keys.filter((k) => !isPlain(doc[k])), [keys, doc]);

  const nav = useMemo(
    () => [
      ...(plainKeys.length ? [{ id: '__plain', title: 'Основное', count: String(plainKeys.length) }] : []),
      ...groupKeys.map((k) => ({ id: k, title: label(k), count: countOf(doc[k]) })),
    ],
    [plainKeys, groupKeys, doc],
  );

  const [active, setActive] = useState(nav[0]?.id ?? '');
  useEffect(() => {
    if (!nav.some((n) => n.id === active)) setActive(nav[0]?.id ?? '');
  }, [nav, active]);

  if (!keys.length) return <p className={s.empty}>Документ пуст — добавьте поля в режиме JSON.</p>;

  return (
    <div className={p.docLayout}>
      <nav className={p.docNav} aria-label="Группы документа">
        {nav.map((n) => (
          <button
            key={n.id}
            className={`${p.docNavItem} ${active === n.id ? p.docNavItemActive : ''}`}
            onClick={() => setActive(n.id)}
          >
            <span className={p.docNavTitle}>{n.title}</span>
            {n.count !== null && <span className={p.docNavCount}>{n.count}</span>}
          </button>
        ))}
      </nav>

      <div className={p.docBody}>
        {active === '__plain' ? (
          <div className={p.fields}>
            {plainKeys.map((k) => {
              const hint = hintFor(doc, k);
              return (
                <div key={k} className={p.field}>
                  <div className={p.fieldLabel}>
                    <span className={p.fieldName}>{label(k)}</span>
                    {label(k) !== k && <span className={p.fieldKey}>{k}</span>}
                    {hint && <span className={p.fieldHint}>{hint}</span>}
                  </div>
                  <div className={p.fieldValue}>
                    <ValueEditor value={doc[k]} onChange={(v) => onChange({ ...doc, [k]: v })} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : active && active in doc ? (
          <>
            {hintFor(doc, active) && <p className={p.groupHint}>{hintFor(doc, active)}</p>}
            <ValueEditor value={doc[active]} onChange={(v) => onChange({ ...doc, [active]: v })} />
          </>
        ) : null}
      </div>
    </div>
  );
}
