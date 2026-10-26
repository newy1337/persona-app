import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';

const PLACEHOLDER = /(\{[\p{L}_][\p{L}\p{N}_]{0,39}\})/u;

/**
 * Поле промпта с подсветкой переменных: под прозрачным textarea лежит слой
 * с тем же текстом, где {переменная} подложена цветом — известная синим,
 * неизвестная красным. Шрифт, отступы и рамка у слоёв одинаковые, прокрутка
 * слоя повторяет прокрутку поля.
 */
export function HighlightTextarea({ value, known, className, ...props }) {
  const backdrop = useRef(null);
  const parts = String(value ?? '').split(PLACEHOLDER);
  return (
    <div className="relative">
      <div
        ref={backdrop}
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent px-2.5 py-1.5 text-sm break-words whitespace-pre-wrap text-transparent [scrollbar-gutter:stable]',
          className,
        )}
      >
        {parts.map((part, i) =>
          i % 2 === 1 ? (
            <mark key={i} className={cn('rounded-sm text-transparent', known.has(part.slice(1, -1)) ? 'bg-primary/25' : 'bg-destructive/30')}>
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
        {/* Хвостовой перенос: без него последняя пустая строка слоя короче поля. */}
        {'\n'}
      </div>
      <Textarea
        {...props}
        value={value}
        className={cn('relative bg-transparent [scrollbar-gutter:stable] dark:bg-transparent', className)}
        onScroll={(e) => {
          if (backdrop.current) backdrop.current.scrollTop = e.currentTarget.scrollTop;
          props.onScroll?.(e);
        }}
      />
    </div>
  );
}

/** Переменные текста, которых нет среди известных. */
export function unknownVariables(text, known) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(new RegExp(PLACEHOLDER.source, 'gu'))) {
    const key = m[1].slice(1, -1);
    if (!known.has(key)) out.add(key);
  }
  return [...out];
}
