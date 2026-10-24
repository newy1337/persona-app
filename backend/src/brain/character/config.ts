export function stripMetadata<T>(value: T): T {
  if (Array.isArray(value))
    return value.map((item) => stripMetadata(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !key.startsWith('_'))
        .map(([key, item]) => [key, stripMetadata(item)]),
    ) as T;
  }
  return value;
}
