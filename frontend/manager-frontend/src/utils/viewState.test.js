// @vitest-environment jsdom
import { expect, test } from 'vitest';
import { dialogOrder, rememberDialogOrder } from './viewState';

test('листание в чате идёт по отфильтрованному списку, если чат в нём', () => {
  rememberDialogOrder(['5', '9', '2']);
  expect(dialogOrder('9', [1, 2, 3, 5, 9])).toEqual([5, 9, 2]);
  // чат не из этого списка — весь список
  expect(dialogOrder(3, [1, 2, 3, 5, 9])).toEqual([1, 2, 3, 5, 9]);
});
