import React from 'react';

const h = React.createElement;

export function Attribution({ value, compact = false, as: Tag = 'div' }) {
  return h(Tag, { className: `mr-attribution ${compact ? 'mr-compact' : ''}`, 'data-testid': 'manager-attribution' },
    h('span', null, h('span', { className: 'mr-caption' }, 'Менеджер: '), value.manager_username || 'не назначен'),
    h('span', null, h('span', { className: 'mr-caption' }, 'Регион: '), value.region_code || 'не задан'));
}
