// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, AlertDescription, AlertTitle } from './alert';
import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import { Badge } from './badge';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Checkbox } from './checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Field } from './field';
import { Input } from './input';
import { Label } from './label';
import { NativeCheckbox } from './native-checkbox';
import { NativeSelect } from './native-select';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { ScrollArea, ScrollBar } from './scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './select';
import { Separator } from './separator';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from './sheet';
import { Skeleton } from './skeleton';
import { Switch } from './switch';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  denseTable,
  stickyLastCol,
} from './table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Textarea } from './textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom не знает ResizeObserver (его ждут стрелка Tooltip и ScrollArea) и
// scrollIntoView (его зовёт Select, фокусируя первый пункт при открытии).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};

// Примитивы скопированы из прототипа с другими версиями Radix и lucide-react.
// Этот тест — дымовая проверка, что каждый из них вообще монтируется здесь;
// без него поломка всплыла бы только внутри страницы, которая его подключит.
let container;
let root;

const mount = async (element) => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(element));
  return container;
};

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});

describe('примитивы shadcn монтируются в этом проекте', () => {
  it('кнопка, бейдж, карточка, поля', async () => {
    const el = await mount(
      <Card>
        <CardHeader>
          <CardTitle>Заголовок</CardTitle>
          <CardDescription>Описание</CardDescription>
        </CardHeader>
        <CardContent>
          <Button>Действие</Button>
          <Button variant="outline" size="sm">
            Ещё
          </Button>
          <Badge variant="secondary">метка</Badge>
          <Label htmlFor="f">Поле</Label>
          <Input id="f" defaultValue="текст" />
          <Textarea defaultValue="много текста" />
          <NativeSelect defaultValue="a">
            <option value="a">А</option>
          </NativeSelect>
          <Separator />
          <Skeleton className="h-4 w-10" />
        </CardContent>
      </Card>,
    );
    expect(el.textContent).toContain('Заголовок');
    expect(el.querySelector('button')?.textContent).toBe('Действие');
    expect(el.querySelector('input')?.value).toBe('текст');
    expect(el.querySelector('select')?.value).toBe('a');
  });

  it('таблица и вкладки', async () => {
    const el = await mount(
      <Tabs defaultValue="one">
        <TabsList>
          <TabsTrigger value="one">Один</TabsTrigger>
          <TabsTrigger value="two">Два</TabsTrigger>
        </TabsList>
        <TabsContent value="one">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Колонка</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>ячейка</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="two">скрыто</TabsContent>
      </Tabs>,
    );
    expect(el.querySelector('table')).toBeTruthy();
    expect(el.textContent).toContain('ячейка');
    expect(el.textContent).not.toContain('скрыто');
  });

  it('чекбокс переключается', async () => {
    const el = await mount(<Checkbox aria-label="флаг" />);
    const box = el.querySelector('button[role="checkbox"]');
    expect(box?.getAttribute('aria-checked')).toBe('false');
    await act(async () => box.click());
    expect(box.getAttribute('aria-checked')).toBe('true');
  });

  it('аватар показывает запасные инициалы', async () => {
    const el = await mount(
      <Avatar>
        <AvatarImage src="/nope.png" alt="" />
        <AvatarFallback>НК</AvatarFallback>
      </Avatar>,
    );
    expect(el.textContent).toContain('НК');
  });

  it('диалог и поповер открываются порталом', async () => {
    await mount(
      <>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Окно</DialogTitle>
            <DialogDescription>Текст окна</DialogDescription>
          </DialogContent>
        </Dialog>
        <Popover open>
          <PopoverTrigger asChild>
            <Button>Открыть</Button>
          </PopoverTrigger>
          <PopoverContent>Содержимое поповера</PopoverContent>
        </Popover>
      </>,
    );
    expect(document.body.textContent).toContain('Окно');
    expect(document.body.textContent).toContain('Содержимое поповера');
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('подсказка открывается порталом', async () => {
    await mount(
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button>Наведи</Button>
        </TooltipTrigger>
        <TooltipContent>Подсказка</TooltipContent>
      </Tooltip>,
    );
    expect(document.querySelector('[role="tooltip"]')).toBeTruthy();
    expect(document.body.textContent).toContain('Подсказка');
  });

  it('выпадающее меню открывается с пунктами', async () => {
    await mount(
      <DropdownMenu open>
        <DropdownMenuTrigger asChild>
          <Button>Меню</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Действия</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem>
              Открыть
              <DropdownMenuShortcut>⌘O</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem inset variant="destructive">
              Удалить
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked>Флаг</DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a">А</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="b">Б</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Ещё</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Вложенный</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const menu = document.querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
    expect(menu.querySelectorAll('[role="menuitem"]').length).toBe(3);
    expect(menu.textContent).toContain('Действия');
    expect(menu.textContent).toContain('⌘O');
    const destructive = menu.querySelector('[data-variant="destructive"]');
    expect(destructive?.textContent).toBe('Удалить');
    expect(destructive.getAttribute('data-inset')).toBe('true');
    expect(menu.querySelector('[role="menuitemcheckbox"]')?.getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(menu.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent).toBe(
      'А',
    );
    // Подменю закрыто, его пункт ещё не смонтирован.
    expect(menu.textContent).not.toContain('Вложенный');
  });

  it('селект показывает пункты через open', async () => {
    const el = await mount(
      <Select open defaultValue="a">
        <SelectTrigger aria-label="Выбор" size="sm">
          <SelectValue placeholder="Выберите" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Группа</SelectLabel>
            <SelectItem value="a">Первый</SelectItem>
            <SelectItem value="b">Второй</SelectItem>
          </SelectGroup>
          <SelectSeparator />
        </SelectContent>
      </Select>,
    );
    const trigger = el.querySelector('[data-slot="select-trigger"]');
    expect(trigger?.getAttribute('data-size')).toBe('sm');
    expect(trigger.textContent).toContain('Первый');
    const listbox = document.querySelector('[role="listbox"]');
    expect(listbox).toBeTruthy();
    expect(listbox.querySelectorAll('[role="option"]').length).toBe(2);
    expect(listbox.textContent).toContain('Группа');
    expect(listbox.querySelector('[role="option"][aria-selected="true"]')?.textContent).toBe(
      'Первый',
    );
  });

  it('переключатель меняет aria-checked', async () => {
    const el = await mount(<Switch aria-label="тумблер" />);
    const sw = el.querySelector('button[role="switch"]');
    expect(sw?.getAttribute('aria-checked')).toBe('false');
    expect(sw.getAttribute('data-state')).toBe('unchecked');
    await act(async () => sw.click());
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.querySelector('[data-slot="switch-thumb"]')?.getAttribute('data-state')).toBe(
      'checked',
    );
  });

  it('область прокрутки рисует содержимое', async () => {
    const el = await mount(
      <ScrollArea className="h-20">
        <div>Прокрутка</div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>,
    );
    expect(el.querySelector('[data-slot="scroll-area-viewport"]')?.textContent).toContain(
      'Прокрутка',
    );
  });

  it('сворачиваемый блок открывается и закрывается', async () => {
    const el = await mount(
      <Collapsible>
        <CollapsibleTrigger>Раскрыть</CollapsibleTrigger>
        <CollapsibleContent>Скрытый текст</CollapsibleContent>
      </Collapsible>,
    );
    const trigger = el.querySelector('[data-slot="collapsible-trigger"]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(el.textContent).not.toContain('Скрытый текст');
    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(el.textContent).toContain('Скрытый текст');
    await act(async () => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(el.textContent).not.toContain('Скрытый текст');
  });

  it('боковая панель открывается с заголовком', async () => {
    await mount(
      <Sheet open>
        <SheetContent side="left">
          <SheetHeader>
            <SheetTitle>Панель</SheetTitle>
            <SheetDescription>Описание панели</SheetDescription>
          </SheetHeader>
          <SheetFooter>
            <SheetClose asChild>
              <Button>Готово</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>,
    );
    const content = document.querySelector('[data-slot="sheet-content"]');
    expect(content).toBeTruthy();
    expect(content.getAttribute('role')).toBe('dialog');
    expect(content.className).toContain('left-0');
    expect(content.textContent).toContain('Панель');
    expect(content.textContent).toContain('Закрыть');
  });

  it('кнопка xs и бейджи success/warning получают свои классы', async () => {
    const el = await mount(
      <>
        <Button size="xs">Мелкая</Button>
        <Badge variant="success">готово</Badge>
        <Badge variant="warning">внимание</Badge>
      </>,
    );
    const btn = el.querySelector('button');
    expect(btn?.className).toContain('h-7');
    expect(btn.className).toContain('text-xs');
    const [ok, warn] = el.querySelectorAll('[data-slot="badge"]');
    // Статус — цветная точка у нейтрального текста, без заливки.
    expect(ok.className).toContain('before:bg-success-foreground');
    expect(ok.className).toContain('text-foreground');
    expect(ok.className.split(' ')).not.toContain('bg-success');
    expect(warn.className).toContain('before:bg-warning-foreground');
    expect(warn.className.split(' ')).not.toContain('bg-warning');
  });

  it('подвал таблицы и общие наборы классов', async () => {
    const el = await mount(
      <Table className={`${stickyLastCol} ${denseTable}`}>
        <TableBody>
          <TableRow>
            <TableCell>ячейка</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>итого</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    );
    const foot = el.querySelector('tfoot');
    expect(foot?.getAttribute('data-slot')).toBe('table-footer');
    expect(foot.textContent).toContain('итого');
    const table = el.querySelector('table');
    expect(table.className).toContain('[&_td:last-child]:sticky');
    expect(table.className).toContain('text-xs');
  });

  it('поле: подпись оборачивает контрол, слот подсказки всегда есть', async () => {
    const el = await mount(
      <>
        <Field label="Имя" hint="Как в паспорте">
          <Input defaultValue="Аня" />
        </Field>
        <Field label="Телефон" error="Обязательное поле">
          <Input defaultValue="" />
        </Field>
      </>,
    );
    const [withHint, withError] = el.querySelectorAll('label');
    expect(withHint.querySelector('input')?.value).toBe('Аня');
    expect(withHint.textContent).toContain('Имя');
    const hint = withHint.querySelector('[data-slot="field-message"]');
    expect(hint?.className).toContain('min-h-4');
    expect(hint.textContent).toBe('Как в паспорте');
    expect(hint.className).toContain('text-muted-foreground');
    const error = withError.querySelector('[data-slot="field-message"]');
    expect(error?.textContent).toBe('Обязательное поле');
    expect(error.className).toContain('text-destructive');
  });

  it('нативный чекбокс переключает .checked', async () => {
    const el = await mount(<NativeCheckbox aria-label="флажок" />);
    const box = el.querySelector('input[type="checkbox"]');
    expect(box?.checked).toBe(false);
    expect(box.className).toContain('accent-primary');
    await act(async () => box.click());
    expect(box.checked).toBe(true);
  });

  it('уведомление: role=status и варианты', async () => {
    const el = await mount(
      <>
        <Alert>
          <svg aria-hidden="true" />
          <AlertTitle>Заголовок</AlertTitle>
          <AlertDescription>Описание</AlertDescription>
        </Alert>
        <Alert variant="destructive" role="alert">
          <AlertTitle>Ошибка</AlertTitle>
        </Alert>
        <Alert variant="warning">
          <AlertTitle>Внимание</AlertTitle>
        </Alert>
      </>,
    );
    const [plain, danger, warn] = el.querySelectorAll('[data-slot="alert"]');
    expect(plain.getAttribute('role')).toBe('status');
    expect(plain.querySelector('[data-slot="alert-title"]')?.textContent).toBe('Заголовок');
    expect(plain.querySelector('[data-slot="alert-description"]')?.textContent).toBe('Описание');
    expect(danger.getAttribute('role')).toBe('alert');
    expect(danger.className).toContain('text-destructive');
    expect(warn.getAttribute('role')).toBe('status');
    expect(warn.className).toContain('border-warning-foreground/30');
    expect(warn.className.split(' ')).not.toContain('bg-warning');
  });

  it('диалог, панель и поповер без портала остаются внутри хоста', async () => {
    const el = await mount(
      <>
        <Dialog open>
          <DialogContent portal={false} showCloseButton={false}>
            <DialogTitle>Встроенное окно</DialogTitle>
            <DialogDescription>Текст</DialogDescription>
          </DialogContent>
        </Dialog>
        <Sheet open>
          <SheetContent portal={false}>
            <SheetTitle>Встроенная панель</SheetTitle>
            <SheetDescription>Текст панели</SheetDescription>
          </SheetContent>
        </Sheet>
        <Popover open>
          <PopoverTrigger asChild>
            <Button>Открыть</Button>
          </PopoverTrigger>
          <PopoverContent portal={false}>Встроенный поповер</PopoverContent>
        </Popover>
      </>,
    );
    const dialog = el.querySelector('[data-slot="dialog-content"]');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.textContent).toContain('Встроенное окно');
    expect(dialog.textContent).not.toContain('Закрыть');
    expect(el.querySelector('[data-slot="dialog-overlay"]')).toBeTruthy();
    const sheet = el.querySelector('[data-slot="sheet-content"]');
    expect(sheet?.textContent).toContain('Встроенная панель');
    expect(sheet.textContent).toContain('Закрыть');
    expect(el.querySelector('[data-slot="popover-content"]')?.textContent).toBe(
      'Встроенный поповер',
    );
  });
});
