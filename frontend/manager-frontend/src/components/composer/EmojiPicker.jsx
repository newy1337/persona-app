import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** Габариты панели: по ним же pickerPlacement() решает, где её открыть. */
export const PICKER_W = 272;
export const PICKER_H = 300;

const GROUPS = [
  ['Лица', ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '🙂', '😉', '😊', '😍', '🥰', '😘', '😗', '😜', '🤪', '🤨', '🧐', '😎', '🥳', '😏', '😒', '😔', '😞', '😢', '😭', '😤', '😠', '🤯', '😳', '🥺', '😱', '😴', '🤔', '🤗', '🤭', '🙄', '😬', '😶', '🙃']],
  ['Жесты', ['👍', '👎', '👌', '✌', '🤞', '🤝', '👏', '🙏', '💪', '🙌', '👋', '🤷', '🤦', '☝', '👀']],
  ['Сердца', ['❤', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '❤‍🔥', '💕', '💖', '💘', '💝']],
  ['Разное', ['🔥', '✨', '⭐', '🎉', '🎁', '☕', '🍕', '🍻', '🌸', '🌞', '🌙', '🌧', '⚡', '✅', '❌', '❗', '❓', '💯', '👻', '🙈']],
];

function useDismiss(onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return ref;
}

export default function EmojiPicker({ onPick, onClose, only = null, title = 'Эмодзи', className = '', style }) {
  const ref = useDismiss(onClose);
  const groups = only ? [[title, only]] : GROUPS;

  return (
    <div
      className={cn(
        'absolute bottom-full left-0 z-50 mb-2 flex flex-col gap-2.5 overflow-y-auto rounded-lg border bg-popover p-2.5 text-popover-foreground shadow-sm [scrollbar-gutter:stable]',
        className,
      )}
      style={{ width: PICKER_W, maxHeight: PICKER_H, ...style }}
      ref={ref}
    >
      {groups.map(([name, list]) => (
        <div key={name} className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">{name}</span>
          <div className="grid grid-cols-7 gap-0.5">
            {list.map((emoji) => (
              <Button
                key={emoji}
                type="button"
                variant="ghost"
                size="sm"
                className="w-full px-0 text-lg leading-none"
                onClick={() => onPick(emoji)}
                title={emoji}
              >
                {emoji}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
