import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldRow, ValueEditor, hintFor, label } from './fields';

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

  if (!keys.length) {
    return <p className="text-sm text-muted-foreground">Документ пуст — добавьте поля в режиме JSON.</p>;
  }

  return (
    <div className="grid items-start gap-4 md:grid-cols-[190px_minmax(0,1fr)]">
      <nav
        className="flex gap-0.5 pr-1 max-md:overflow-x-auto md:max-h-[62vh] md:flex-col md:overflow-y-auto md:[scrollbar-gutter:stable]"
        aria-label="Группы документа"
      >
        {nav.map((n) => {
          const current = active === n.id;
          return (
            <Button
              key={n.id}
              variant="ghost"
              aria-current={current ? 'true' : undefined}
              data-active={current || undefined}
              className="w-auto shrink-0 justify-start gap-2 px-2.5 font-normal text-muted-foreground data-[active]:bg-accent data-[active]:font-medium data-[active]:text-foreground md:w-full"
              onClick={() => setActive(n.id)}
            >
              <span className="truncate">{n.title}</span>
              {n.count !== null && (
                <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">{n.count}</span>
              )}
            </Button>
          );
        })}
      </nav>

      <div className="min-w-0 max-h-[62vh] overflow-y-auto pr-1.5 [scrollbar-gutter:stable]">
        {active === '__plain' ? (
          <div className="flex flex-col gap-3.5">
            {plainKeys.map((k) => (
              <FieldRow key={k} parent={doc} k={k}>
                <ValueEditor value={doc[k]} onChange={(v) => onChange({ ...doc, [k]: v })} />
              </FieldRow>
            ))}
          </div>
        ) : active && active in doc ? (
          <>
            {hintFor(doc, active) && (
              <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{hintFor(doc, active)}</p>
            )}
            <ValueEditor value={doc[active]} onChange={(v) => onChange({ ...doc, [active]: v })} />
          </>
        ) : null}
      </div>
    </div>
  );
}
