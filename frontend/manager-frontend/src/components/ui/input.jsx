import { cn } from '@/lib/utils';

function Input({ className, type, ...props }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input flex h-8 w-full min-w-0 rounded-md border bg-transparent px-2.5 py-1 text-sm transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
