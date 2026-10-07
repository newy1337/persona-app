import { Fragment } from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const Sheet = (props) => <SheetPrimitive.Root data-slot="sheet" {...props} />;
const SheetTrigger = (props) => <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
const SheetClose = (props) => <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
const SheetPortal = (props) => <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;

function SheetOverlay({ className, ...props }) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60',
        className,
      )}
      {...props}
    />
  );
}

/**
 * portal / container — как у DialogContent: при portal={false} панель
 * остаётся в дереве React внутри хоста, container задаёт узел портала.
 */
function SheetContent({
  className,
  children,
  side = 'right',
  portal = true,
  container,
  ...props
}) {
  const Wrapper = portal ? SheetPortal : Fragment;
  const wrapperProps = portal && container ? { container } : {};
  return (
    <Wrapper {...wrapperProps}>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500',
          side === 'right' &&
            'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm',
          side === 'left' &&
            'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm',
          side === 'top' &&
            'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b',
          side === 'bottom' &&
            'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t',
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 absolute top-3 right-3 inline-flex size-7 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-[3px] disabled:pointer-events-none">
          <XIcon className="size-4" />
          <span className="sr-only">Закрыть</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </Wrapper>
  );
}

const SheetHeader = ({ className, ...props }) => (
  <div data-slot="sheet-header" className={cn('flex flex-col gap-1.5 p-4', className)} {...props} />
);

const SheetFooter = ({ className, ...props }) => (
  <div
    data-slot="sheet-footer"
    className={cn('mt-auto flex flex-col gap-2 p-4', className)}
    {...props}
  />
);

const SheetTitle = ({ className, ...props }) => (
  <SheetPrimitive.Title
    data-slot="sheet-title"
    className={cn('text-foreground font-semibold', className)}
    {...props}
  />
);

const SheetDescription = ({ className, ...props }) => (
  <SheetPrimitive.Description
    data-slot="sheet-description"
    className={cn('text-muted-foreground text-sm', className)}
    {...props}
  />
);

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
