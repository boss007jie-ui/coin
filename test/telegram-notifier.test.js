const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createTelegramNotifier,
  telegramConfigured
} = require("../lib/telegram-notifier");

test("telegramConfigured requires token and chat id", () => {
  assert.equal(telegramConfigured({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "123" }), true);
  assert.equal(telegramConfigured({ TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "123" }), false);
  assert.equal(telegramConfigured({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "" }), false);
});

test("disabled notifier reports skipped send", async () => {
  const notifier = createTelegramNotifier({ env: {}, fetchImpl: async () => {
    throw new Error("should not call fetch");
  } });

  assert.equal(notifier.enabled, false);
  const result = await notifier.sendMessage("hello");
  assert.deepEqual(result, { ok: false, skipped: true, reason: "telegram-not-configured" });
});

test("sendMessage posts to Telegram Bot API", async () => {
  const calls = [];
  const notifier = createTelegramNotifier({
    env: {
      TELEGRAM_BOT_TOKEN: "123456:abcdef",
      TELEGRAM_CHAT_ID: "998877"
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 1 } }),
        text: async () => "{\"ok\":true}"
      };
    }
  });

  const result = await notifier.sendMessage("LABUSDT alert");

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.telegram.org/bot123456%3Aabcdef/sendMessage");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    chat_id: "998877",
    text: "LABUSDT alert",
    disable_web_page_preview: true
  });
});

test("sendMessage throws with Telegram error body", async () => {
  const notifier = createTelegramNotifier({
    env: {
      TELEGRAM_BOT_TOKEN: "token",
      TELEGRAM_CHAT_ID: "chat"
    },
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      text: async () => "{\"ok\":false,\"description\":\"Bad Request\"}"
    })
  });

  await assert.rejects(
    notifier.sendMessage("bad"),
    (error) => {
      assert.equal(error.message, "Telegram sendMessage failed: HTTP 400");
      assert.deepEqual(error.details, { body: "{\"ok\":false,\"description\":\"Bad Request\"}" });
      return true;
    }
  );
});
