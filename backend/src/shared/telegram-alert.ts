import { appConfig } from 'src/config/app.config';

/** Группа для предупреждений (баланс, прокси) настроена: есть чат и бот. */
export const alertConfigured = (): boolean =>
  Boolean(appConfig.balanceAlert.chatId && appConfig.balanceAlert.botToken);

/**
 * Сообщение в группу предупреждений через Bot API: бот BALANCE_ALERT_BOT_TOKEN
 * (если не задан — бот войсеров), чат BALANCE_ALERT_CHAT_ID.
 */
export async function sendTelegramAlert(text: string): Promise<void> {
  const { botToken, chatId } = appConfig.balanceAlert;
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
  } | null;
  if (!res.ok || !body?.ok)
    throw new Error(
      `Telegram не принял сообщение: ${body?.description ?? `HTTP ${res.status}`}`,
    );
}
