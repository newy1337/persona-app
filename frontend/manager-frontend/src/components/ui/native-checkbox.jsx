import { cn } from '@/lib/utils';

/**
 * Обычный <input type="checkbox"> в оформлении Checkbox. Нужен там, где
 * тесты и формы читают .checked у настоящего поля, а Radix-кнопка с
 * aria-checked не подходит.
 */
function NativeCheckbox({ className, ...props }) {
  return (
    <input
      type="checkbox"
      data-slot="native-checkbox"
      className={cn(
        'peer size-4 shrink-0 rounded-[4px] border border-input accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  );
}

export { NativeCheckbox };
