import { useState } from 'react';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HOTKEYS, useHotkeys } from './hotkeys';

/** Шпаргалка горячих клавиш: открывается клавишей «?» на любой странице. */
export default function HotkeysHelp() {
  const [open, setOpen] = useState(false);
  useHotkeys({ '?': () => setOpen(true) });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Горячие клавиши</DialogTitle>
          <DialogDescription>Работают, когда курсор не в поле ввода. Раскладка не важна.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4" data-testid="hotkeys-help">
          {HOTKEYS.map((group) => (
            <section key={group.where} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">{group.where}</h3>
              {group.keys.map(([keys, what]) => (
                <p key={keys} className="flex items-center justify-between gap-3 text-sm">
                  <span>{what}</span>
                  <span className="flex gap-1">
                    {keys.split(' / ').map((k) => (
                      <kbd key={k} className="min-w-6 rounded border bg-muted px-1.5 py-0.5 text-center font-mono text-xs">{k}</kbd>
                    ))}
                  </span>
                </p>
              ))}
            </section>
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
