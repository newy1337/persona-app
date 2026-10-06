import { Fragment } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

const Popover = (props) => <PopoverPrimitive.Root data-slot="popover" {...props} />;
const PopoverTrigger = (props) => (
  <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
);

/**
 * portal / container — как у DialogContent: при portal={false} содержимое
 * остаётся в дереве React рядом с триггером, container задаёт узел портала.
 */
function PopoverContent({
  className,
  align = 'start',
  sideOffset = 4,
  portal = true,
  container,
  ...props
}) {
  const Wrapper = portal ? PopoverPrimitive.Portal : Fragment;
  const wrapperProps = portal && container ? { container } : {};
  return (
    <Wrapper {...wrapperProps}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 z-50 w-72 rounded-md border p-3 shadow-md outline-hidden',
          className,
        )}
        {...props}
      />
    </Wrapper>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
