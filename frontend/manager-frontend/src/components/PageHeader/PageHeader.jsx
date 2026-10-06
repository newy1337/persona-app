import { cn } from '@/lib/utils';

/**
 * Верх страницы: заголовок, необязательное пояснение и действия справа.
 * Одна высота и отступы на всех страницах; главная кнопка страницы — одна.
 */
export function PageHeader({ title, description, children, className }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-5 pb-4', className)}>
      <div className="min-w-0">
        <h1 className="text-lg leading-8 font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
