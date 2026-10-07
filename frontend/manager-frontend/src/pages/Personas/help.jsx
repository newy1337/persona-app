import { HelpHint } from '@/components/HelpHint/HelpHint';
import { cn } from '@/lib/utils';

/**
 * Подпись поля или раздела с пояснением за значком «?». Текст пояснения не
 * занимает строку под полем; без пояснения подпись остаётся как была.
 * name — как пояснение называется для скринридера, когда к подписи дописана
 * единица измерения.
 */
export function Labeled({ label, name = label, help, className }) {
  if (!help) return className ? <span className={className}>{label}</span> : label;
  return (
    <span className={cn('flex items-center gap-1', className)}>
      <span className="min-w-0">{label}</span>
      <HelpHint label={name}>{help}</HelpHint>
    </span>
  );
}
