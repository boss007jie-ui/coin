const TELEGRAM_API_BASE = "https://api.telegram.org";

function telegramConfigured(env = process.env) {
  return Boolean(String(env.TELEGRAM_BOT_TOKEN || "").trim() && String(env.TELEGRAM_CHAT_ID || "").trim());
}

function createTelegramNotifier({ env = process.env, fetchImpl = fetch } = {}) {
  const token = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  const enabled = telegramConfigured({ TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId });

  async function sendMessage(text, options = {}) {
    if (!enabled) {
      return { ok: false, skipped: true, reason: "telegram-not-configured" };
    }

    const response = await fetchImpl(`${TELEGRAM_API_BASE}/bot${encodeURIComponent(token)}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(text || ""),
        disable_web_page_preview: true,
        ...options
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const error = new Error(`Telegram sendMessage failed: HTTP ${response.status}`);
      error.details = { body };
      throw error;
    }

    return response.json();
  }

  return {
    enabled,
    sendMessage
  };
}

module.exports = {
  createTelegramNotifier,
  telegramConfigured
};
