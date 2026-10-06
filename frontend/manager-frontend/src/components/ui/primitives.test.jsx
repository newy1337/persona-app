// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Avatar, AvatarFallback, AvatarImage } from './avatar';
import { Badge } from './badge';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Checkbox } from './checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { Input } from './input';
import { Label } from './label';
import { NativeSelect } from './native-select';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Separator } from './separator';
import { Skeleton } from './skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';
import { Textarea } from './textarea';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
});
