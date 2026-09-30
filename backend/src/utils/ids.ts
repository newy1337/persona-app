export const toChatId = (value: number | string | bigint): bigint =>
  BigInt(value);

export const fromChatId = (
  value: bigint | number | null | undefined,
): number | null =>
  value === null || value === undefined ? null : Number(value);

export const conversationUserId = (chatId: number | bigint): string =>
  `telegram:${chatId}`;
