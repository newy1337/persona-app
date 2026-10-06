import { cn } from '@/lib/utils';

export function Attribution({ value, compact = false, as: Tag = 'div', className }) {
  return (
    <Tag
      className={cn(
        'flex min-w-0 flex-col text-xs leading-normal [overflow-wrap:anywhere]',
        compact ? 'gap-0.5' : 'gap-1',
        className,
      )}
      data-testid="manager-attribution"
    >
      <span>
        <span className="text-muted-foreground">Менеджер: </span>
        {value.manager_username || 'не назначен'}
      </span>
      <span>
        <span className="text-muted-foreground">Регион: </span>
        {value.region_code || 'не задан'}
      </span>
    </Tag>
  );
}
