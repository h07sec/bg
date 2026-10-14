# review-bot

Backend that connects the recipe-portal frontend (`access-portal.html`) to a
Telegram bot, so you can tap Pass/Fail in Telegram and the result shows up on
the user's "Reviewing your answers…" screen.

## How it works

1. The frontend POSTs the user's 8 steps to `POST /submit`.
2. This server stores the submission and sends you a Telegram message with
   **✅ Pass** / **❌ Fail** buttons.
3. Tap **Fail** → marked failed immediately.
   Tap **Pass** → the bot asks you to reply with a number (0–100). Reply with
   it and the submission is marked passed with those marks.
4. The frontend polls `GET /status/:id` every few seconds and shows the
   result once it's no longer "pending".

Data is kept in memory, so it resets if the server restarts. Good enough for
a small/internal tool; swap `submissions` (a `Map`) for a real database if
you need it to persist.

## 1. Create your Telegram bot

1. Message **@BotFather** on Telegram, send `/newbot`, follow the prompts.
2. Copy the token it gives you — that's `BOT_TOKEN`.
3. Message **@userinfobot** to get your own numeric chat id — that's
   `ADMIN_CHAT_ID`. Then send your new bot a `/start` message so it's allowed
   to message you back.

## 2. Configure

```bash
cd review-bot
npm install
cp .env.example .env
```

Edit `.env`:

```
BOT_TOKEN=your-token-here
ADMIN_CHAT_ID=your-chat-id-here
ALLOWED_ORIGIN=https://your-frontend-domain.example.com
PORT=3000
```

## 3. Run it

```bash
npm start
```

For local testing you can leave `ALLOWED_ORIGIN=*`. For production, set it to
the exact origin your frontend is served from.

## 4. Deploy it somewhere public

The frontend needs to reach this server over the internet, so run it on
something with a public URL — Render, Railway, Fly.io, a small VPS, etc. Any
Node 18+ host works; no inbound webhook is needed since this uses Telegram
long-polling (`polling: true` in `server.js`), so you just need the HTTP API
(`/submit`, `/status/:id`) to be reachable, not a public endpoint for
Telegram itself.

## 5. Point the frontend at it

In `access-portal.html`, find:

```js
const BACKEND_URL="https://YOUR-BACKEND-DOMAIN.example.com";
```

and replace it with wherever you deployed this server.

## Security notes

- This has no authentication on `/submit` — anyone who finds the URL can
  submit. Fine for a casual/internal tool; add an API key or rate limiting
  if that's a concern.
- `ADMIN_CHAT_ID` is hardcoded to one reviewer. Extend `callback_query` /
  `message` handling if you want multiple reviewers.
- Keep `.env` out of version control (already covered by common `.gitignore`
  templates, but double check).
