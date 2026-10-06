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
 * showCloseButton — крестик в правом верхнем углу.
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
        className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed top-1/2 left-1/2 z-50 grid max-h-[90vh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border p-6 shadow-lg sm:max-w-lg',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden"
          >
            <XIcon className="size-4" />
            <span className="sr-only">Закрыть</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </Wrapper>
  );
}

const DialogHeader = ({ className, ...props }) => (
  <div data-slot="dialog-header" className={cn('flex flex-col gap-2', className)} {...props} />
);

const DialogFooter = ({ className, ...props }) => (
  <div
    data-slot="dialog-footer"
    className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
    {...props}
  />
);

const DialogTitle = ({ className, ...props }) => (
  <DialogPrimitive.Title
    data-slot="dialog-title"
    className={cn('text-lg leading-none font-semibold', className)}
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
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
