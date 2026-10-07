import { Fragment } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const Dialog = (props) => <DialogPrimitive.Root data-slot="dialog" {...props} />;
const DialogTrigger = (props) => <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
const DialogClose = (props) => <DialogPrimitive.Close data-slot="dialog-close" {...props} />;

/**
 * portal — рисовать ли окно через DialogPrimitive.Portal (по умолчанию да).
 * При portal={false} оверлей и содержимое остаются в дереве React там, где
 * стоит <Dialog>: это нужно страницам, которые держат окно внутри своего
 * контейнера (тесты ищут его внутри хоста). container — узел для портала.
 * showCloseButton — крестик в правом верхнем углу (квадрат 28px).
 *
 * Окно — колонка с шагом 16px: DialogHeader, тело, DialogFooter. Отступ 20px,
 * ширина по умолчанию sm:max-w-md, широкие окна задают sm:max-w-2xl.
 * Длинное тело заворачивают в DialogBody: тогда прокручивается оно, а шапка
 * и подвал стоят на месте. Без DialogBody прокручивается окно целиком.
 * Ошибку отправки формы показывает DialogError — одна строка над подвалом.
 */
function DialogContent({
  className,
  children,
  portal = true,
  container,
  showCloseButton = true,
  ...props
}) {
  const Wrapper = portal ? DialogPrimitive.Portal : Fragment;
  const wrapperProps = portal && container ? { container } : {};
  return (
    <Wrapper {...wrapperProps}>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'bg-card text-card-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-3rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl border p-5 shadow-lg outline-none sm:max-w-md',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-[3px]"
          >
            <XIcon className="size-4" aria-hidden />
            <span className="sr-only">Закрыть</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </Wrapper>
  );
}

const DialogHeader = ({ className, ...props }) => (
  <div
    data-slot="dialog-header"
    className={cn('flex shrink-0 flex-col gap-1', className)}
    {...props}
  />
);

// Прокручиваемое тело окна. Отрицательные поля возвращают полосу прокрутки к
// краю окна и оставляют место под кольцо фокуса крайних полей; правое поле
// уже левого на ширину зарезервированной полосы прокрутки.
const DialogBody = ({ className, ...props }) => (
  <div
    data-slot="dialog-body"
    className={cn(
      '-mx-5 -my-1 min-h-0 flex-1 overflow-y-auto overscroll-contain py-1 pr-2.5 pl-5 [scrollbar-gutter:stable]',
      className,
    )}
    {...props}
  />
);

// Единственная строка ошибки формы — над подвалом. Место занято всегда, так
// что появление текста не меняет высоту окна; отрицательные поля сокращают
// шаг до тела и подвала до 8px, пока строка пуста.
const DialogError = ({ className, ...props }) => (
  <p
    data-slot="dialog-error"
    className={cn(
      '-my-2 min-h-4 shrink-0 text-xs leading-4 text-destructive [overflow-wrap:anywhere]',
      className,
    )}
    {...props}
  />
);

const DialogFooter = ({ className, ...props }) => (
  <div
    data-slot="dialog-footer"
    className={cn('flex shrink-0 flex-wrap items-center justify-end gap-2', className)}
    {...props}
  />
);

const DialogTitle = ({ className, ...props }) => (
  <DialogPrimitive.Title
    data-slot="dialog-title"
    className={cn('text-base leading-6 font-semibold [overflow-wrap:anywhere]', className)}
    {...props}
  />
);

const DialogDescription = ({ className, ...props }) => (
  <DialogPrimitive.Description
    data-slot="dialog-description"
    className={cn('text-muted-foreground text-sm', className)}
    {...props}
  />
);

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogError,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
