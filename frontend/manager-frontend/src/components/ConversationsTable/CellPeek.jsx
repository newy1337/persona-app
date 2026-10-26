import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

// Ячейки таблицы узкие, текст в них обрезается многоточием. Щелчок по
// обрезанному тексту раскрывает ячейку: поверх неё встаёт плашка той же
// ширины (и шире, до PEEK_MAX) с полным текстом в несколько строк. Щелчок по
// тексту, который и так виден целиком, работает как раньше — открывает чат.
// Плашка — в портале с fixed-позицией: обёртка таблицы прокручивается и
// обрезала бы её у края. Закрывают её повторный щелчок, щелчок мимо, Escape,
// прокрутка и изменение размера окна.
const PEEK_MAX = 360;
const INTERACTIVE = 'a, button, select, input, textarea, [role="combobox"]';

const isClipped = (el) =>
  Boolean(el) && [el, ...el.querySelectorAll('.truncate')].some((n) => n.scrollWidth > n.clientWidth + 1);

/** Раскрытие обрезанной ячейки: обработчики для её содержимого и сама плашка. */
export function useCellPeek() {
  const ref = useRef(null);
  const [rect, setRect] = useState(null);
  const [clipped, setClipped] = useState(false);
  const close = useCallback(() => setRect(null), []);

  useEffect(() => {
    if (!rect) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e) => {
      if (!e.target.closest?.('[data-cell-peek]') && !ref.current?.contains(e.target)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [rect, close]);

  const bind = {
    ref,
    onMouseEnter: () => setClipped(isClipped(ref.current)),
    onClick: (e) => {
      if (e.target.closest(INTERACTIVE) || !isClipped(ref.current)) return;
      e.stopPropagation();
      if (rect) close();
      else setRect((ref.current.closest('td') ?? ref.current).getBoundingClientRect());
    },
  };

  const peek = (children) =>
    rect &&
    createPortal(
      <div
        data-cell-peek=""
        role="tooltip"
        className="fixed z-50 flex items-center gap-1.5 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg [&_.h-4]:h-auto [&_.h-5]:h-auto [&_.truncate]:overflow-visible [&_.truncate]:whitespace-normal [&_.truncate]:[overflow-wrap:anywhere]"
        style={{
          left: Math.max(8, Math.min(rect.left, window.innerWidth - PEEK_MAX - 8)),
          top: rect.top,
          minWidth: rect.width,
          minHeight: rect.height,
          maxWidth: Math.max(rect.width, PEEK_MAX),
        }}
        // Портал всплывает по дереву React: без этого щелчок дошёл бы до строки и открыл чат.
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
      >
        {children}
      </div>,
      document.body,
    );

  return { bind, clipped, peek };
}

/** Содержимое ячейки, которое раскрывается щелчком, если обрезано. */
export function Peek({ className, title, children }) {
  const { bind, clipped, peek } = useCellPeek();
  return (
    <>
      <div {...bind} className={cn(className, clipped && 'cursor-zoom-in')} title={title}>
        {children}
      </div>
      {peek(children)}
    </>
  );
}
