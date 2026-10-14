// review-bot/server.js
//
// Minimal backend that bridges the recipe portal frontend and your Telegram bot.
//
// Flow:
//   1. Frontend POSTs the user's 8 answers to  /submit
//   2. This server stores it and sends YOU a Telegram message with Pass/Fail buttons
//   3. You tap Fail  -> submission is marked "fail" immediately
//      You tap Pass  -> bot asks "Enter marks for <id>:" and waits for your reply
//      You reply with a number (e.g. 80) -> submission is marked "pass" with that mark
//   4. Frontend polls  GET /status/:id  every few seconds and shows the result
//
// Requires: Node 18+, a Telegram bot token (from @BotFather), and your own
// Telegram numeric chat id (message @userinfobot to get it).
//
// Setup:
//   cd review-bot
//   npm install
//   cp .env.example .env        # fill in BOT_TOKEN, ADMIN_CHAT_ID, ALLOWED_ORIGIN
//   npm start
//
// Then deploy this folder somewhere with a public URL (Render, Railway, Fly.io,
// a VPS, etc.) and point BACKEND_URL in access-portal.html at that URL.

import express from "express";
import cors from "cors";
import crypto from "crypto";
import TelegramBot from "node-telegram-bot-api";
import "dotenv/config";

const {
  BOT_TOKEN,
  ADMIN_CHAT_ID,
  ALLOWED_ORIGIN = "*",
  PORT = 3000,
} = process.env;

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
  console.error("Missing BOT_TOKEN or ADMIN_CHAT_ID. Copy .env.example to .env and fill them in.");
  process.exit(1);
}

// In-memory store. Fine for a single-instance personal/internal tool.
// Swap for a real database if you need it to survive restarts or scale out.
const submissions = new Map(); // id -> { fruit, steps, status, marks, createdAt }
let pendingMarksId = null;     // id waiting on the admin's next text reply

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

function fmtSubmission(id, s) {
  const lines = s.steps.map((v, i) => `Step ${i + 1}: ${v}`).join("\n");
  return `New recipe submission\nID: ${id}\nFruit: ${s.fruit}\n\n${lines}`;
}

// --- Frontend-facing API ---

app.post("/submit", async (req, res) => {
  const { fruit, steps } = req.body || {};
  if (!fruit || !Array.isArray(steps) || steps.length !== 8 || steps.some(s => !String(s).trim())) {
    return res.status(400).json({ error: "Expected { fruit, steps: [8 non-empty strings] }" });
  }

  const id = crypto.randomBytes(4).toString("hex");
  submissions.set(id, { fruit, steps, status: "pending", marks: null, createdAt: Date.now() });

  try {
    await bot.sendMessage(ADMIN_CHAT_ID, fmtSubmission(id, submissions.get(id)), {
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Pass", callback_data: `pass:${id}` },
          { text: "❌ Fail", callback_data: `fail:${id}` },
        ]],
      },
    });
  } catch (err) {
    console.error("Failed to notify Telegram:", err.message);
    // Submission still recorded; you can act on it once Telegram is reachable again.
  }

  res.json({ id });
});

app.get("/status/:id", (req, res) => {
  const s = submissions.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Unknown submission id" });
  res.json({ status: s.status, marks: s.marks });
});

// Optional: list pending submissions, handy while testing.
app.get("/pending", (req, res) => {
  const pending = [...submissions.entries()]
    .filter(([, s]) => s.status === "pending")
    .map(([id, s]) => ({ id, fruit: s.fruit, createdAt: s.createdAt }));
  res.json(pending);
});

// --- Telegram side ---

bot.on("callback_query", async (query) => {
  const [action, id] = (query.data || "").split(":");
  const s = submissions.get(id);
  if (!s) return bot.answerCallbackQuery(query.id, { text: "Submission not found." });

  if (action === "fail") {
    s.status = "fail";
    await bot.answerCallbackQuery(query.id, { text: "Marked as fail." });
    await bot.editMessageText(`${fmtSubmission(id, s)}\n\n❌ FAILED`, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
    });
  } else if (action === "pass") {
    pendingMarksId = id;
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(query.message.chat.id, `Enter marks (0-100) for ${id}:`, {
      reply_markup: { force_reply: true },
    });
  }
});

bot.on("message", async (msg) => {
  // Ignore anything that isn't the admin replying with a mark.
  if (String(msg.chat.id) !== String(ADMIN_CHAT_ID)) return;
  if (!pendingMarksId) return;
  if (!/^\d+$/.test((msg.text || "").trim())) return;

  const marks = Math.max(0, Math.min(100, parseInt(msg.text.trim(), 10)));
  const id = pendingMarksId;
  const s = submissions.get(id);
  if (s) {
    s.status = "pass";
    s.marks = marks;
    await bot.sendMessage(msg.chat.id, `Recorded: ${id} passed with ${marks}/100.`);
  }
  pendingMarksId = null;
});

app.listen(PORT, () => console.log(`review-bot backend listening on :${PORT}`));
