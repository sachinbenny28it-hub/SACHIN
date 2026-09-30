# SACHIN

> Most AI assistants know what you ask them. SACHIN learns how you work.

SACHIN is a personal AI companion for conversation, learning, coding, goals, and daily guidance. It adapts to the preferences you explicitly share, keeps only memories you approve, and stays clear that it is an AI.

## What works

- Account registration and sign-in with bcrypt password hashes, signed JWTs, per-user data scoping, and sign-in rate limiting.
- Private local AI chat powered by Ollama and Qwen3; chat, memories, goals, and transcripts are processed on this computer without API credits or an AI API key.
- Memory Vault with opt-in personalization, review-before-save suggestions, manual entries, categories, pinning, editing, selected deletion, and clear-all. A message that asks SACHIN not to remember it is not saved to the conversation or Memory Vault.
- Five conversation modes, configurable answer length, and saved Voice / Message / Smart response preferences.
- Browser voice input and speech output. Voice input starts only after a user action and microphone permission. Browsers with Web Speech use browser recognition; the recording fallback is converted to WAV in the browser and transcribed by a local Ollama speech model. Free accounts receive five voice turns per UTC day.
- A standalone widget page and floating in-app launcher. The project is an installable PWA with a widget shortcut; it is not an operating-system live widget.
- An optional Electron desktop companion that opens the compact widget in an always-on-top window, with a shortcut to reopen it and a shared sign-in session inside the companion.
- Dashboard goals with due dates, completion, and deletion.
- RevenueCat Web Billing SDK integration, a RevenueCat-managed paywall, and a webhook that updates the account plan after confirmed entitlement events.
- User-controlled wake phrase. Browser wake listening works only while the app tab is open, visible, and focused. It stops when the user leaves the tab or switches windows.

## Requirements

- Node.js 20 or newer
- MySQL 8 or newer
- Ollama for free local AI (the app starts its local service when available)
- A RevenueCat Web Billing project for real subscriptions (optional for local chat)
- A secure deployment origin (`https://`) for microphone and PWA features outside localhost

## Architecture

The browser serves the HTML/CSS/JavaScript client and calls the same-origin Express API. Express authenticates each request with the account JWT and scopes every database read and write to that account. Chat builds a request from the selected mode, response preference, recent conversation messages, relevant approved memories, and active dashboard goals when memory personalization is enabled. The server sends the prompt to the local Ollama service and stores the completed turn in MySQL. AI prompts stay on this computer.

For browsers without Web Speech recognition, the user can record a short message after pressing Talk. The browser converts the recording to 16 kHz WAV, Express holds it in memory and sends it to the local Ollama speech model, then accepts the returned transcript with a short-lived, one-use reservation. Audio is not written to disk or sent to an AI provider. RevenueCat handles the web paywall and sends entitlement events to the authenticated webhook; the webhook is the authority for plan limits in MySQL.

## Run locally

1. Copy `.env.example` to `.env`.
2. Generate a unique JWT secret, for example:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

   Put the result in `JWT_SECRET`. The server refuses to start with the example placeholder.

3. Set the MySQL host, user, password, and database name in `.env`. The MySQL user needs permission to create the configured database on the first run, and then to create and alter tables in it.
4. Install Ollama from [ollama.com/download](https://ollama.com/download), then download the small local models once:

   ```bash
   ollama pull qwen3:0.6b
   ollama pull frozenlab/qwen3-asr:0.6b
   ```

   Chat uses `OLLAMA_MODEL` (default `qwen3:0.6b`); voice transcription uses `OLLAMA_ASR_MODEL` (default `frozenlab/qwen3-asr:0.6b`).
5. Install and initialize:

   ```bash
   npm install
   npm run db:init
   npm start
   ```

6. Open `http://localhost:4000`.

To run the optional desktop widget after setting up the web app, use `npm run desktop`. It starts or reuses the local Express server and opens the standalone widget in a compact, always-on-top window. `Ctrl+Shift+S` reopens the widget while the desktop companion is running; closing the widget quits the companion. Its **Open full SACHIN** link opens an authenticated desktop app window in the same session.

`npm run db:init` creates the configured database, applies the schema, adds missing columns, and runs the one-time memory-consent migration. On older SACHIN databases, memories that were previously auto-saved are marked for review and old behavior observations are moved into the visible Memory Vault as unapproved suggestions. Nothing from those old suggestions is used in AI context until approved.

## RevenueCat setup

1. Create a RevenueCat Web Billing configuration and connect its billing provider.
2. Create the Pro products and offering, and add an entitlement named `sachin_pro`.
3. Set `REVENUECAT_PUBLIC_API_KEY` to the Web Billing public SDK key. The app loads it from `/api/config`; this is a public key, not a secret.
4. Set a long random `REVENUECAT_WEBHOOK_SECRET`. Configure RevenueCat's webhook to call `POST /api/billing/revenuecat-webhook` with `Authorization: Bearer <secret>`.
5. Keep the RevenueCat app user ID equal to SACHIN's authenticated user UUID. The Web SDK uses this ID when it initializes.

The paywall is served by RevenueCat. The app grants Pro limits only after a verified webhook updates the MySQL account plan. A cancellation event does not remove access immediately; expiration does. Without a configured RevenueCat key, offering, and webhook, subscription checkout is intentionally unavailable.

## Privacy and voice limits

- Personalization is off by default. Onboarding asks whether to enable memory suggestions. When enabled, SACHIN can use approved memories and show a suggested note, but the suggestion is only saved after the user presses **Save to Memory Vault**.
- Turning memory off pauses memory retrieval and suggestions; it does not delete existing Vault items. Users can delete individual memories, selected memories, all memories, conversations, or the whole account.
- “Don't remember this” turns are processed by the local Ollama model but are not saved in SACHIN's conversation history or Memory Vault.
- SACHIN does not save microphone audio to disk. Browser speech recognition may process audio using the browser's speech provider and is subject to that provider's privacy rules. Where browser recognition is unavailable, a user-started recording is limited to 20 seconds, converted to WAV in browser memory, and sent only to the local Ollama service. The app only starts capture after an explicit Talk action or after the user enables browser voice activation and grants microphone access.
- Website wake phrase detection is not available after the tab/browser closes. The Electron companion provides a real compact desktop widget, but it does not implement background wake-word detection. Reliable closed-app wake requires an on-device wake-word engine; arbitrary custom phrases may need a trained wake-word model. The browser speech recognizer can mishear phrases.
- An installable PWA with a widget shortcut and the Electron desktop widget are included. A native mobile home-screen widget and closed-app wake service are separate build targets.

## Plans

| Free | SACHIN Pro |
| --- | --- |
| Text chat | Larger long-term memory (up to 400 items) |
| Up to 25 Memory Vault items | Full conversation history |
| Five voice turns per UTC day | No app-level daily voice cap |
| Last 10 conversations and last 40 messages per conversation | Full history and more room for approved learning, project, and behaviour memories |
| All five conversation modes | All free features |

The model prompt receives at most the 16 most recent messages from the active conversation, for either plan. Conversation display history and model context are separate limits.

## API

All account routes except `/api/health`, `/api/config`, registration, login, and the RevenueCat webhook require `Authorization: Bearer <JWT>`.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Create account |
| `POST` | `/api/auth/login` | Sign in |
| `GET` | `/api/auth/me` | Current account and plan |
| `DELETE` | `/api/auth/me` | Permanently delete account (requires password) |
| `POST` | `/api/chat` | Send a text or voice-transcribed message |
| `POST` | `/api/voice/transcribe` | Transcribe a user-recorded voice message (up to 12 MB) |
| `GET/POST/DELETE` | `/api/memory` | List, add, or clear Memory Vault items |
| `PATCH/DELETE` | `/api/memory/:id` | Approve, edit, pin, or delete a memory |
| `GET/PATCH` | `/api/preferences` | Read or update preferences |
| `GET/POST` | `/api/conversations` | List or create conversations |
| `GET/DELETE` | `/api/conversations/:id` | Read messages or delete a conversation |
| `GET/POST` | `/api/goals` | List or create goals |
| `PATCH/DELETE` | `/api/goals/:id` | Complete, reopen, drop, or delete a goal |
| `POST` | `/api/billing/revenuecat-webhook` | Receive RevenueCat entitlement events |
| `GET` | `/api/health` | Check server and MySQL status |

Chat accepts `{ "message": "...", "conversationId": "...", "mode": "friend", "inputType": "text" }`. `conversationId` may be omitted for a new conversation; `mode` is one of `friend`, `teacher`, `coding`, `coach`, or `daily`. Successful responses include `conversationId`, `reply`, and any reviewable `suggestions`.

## Project layout

```text
server/
  controllers/      Auth, chat, conversation, goal, memory, and preference handlers
  db/               MySQL schema and initializer/migrations
  middleware/       JWT auth and async error forwarding
  routes/           Express API routes
  services/         Local Ollama chat and speech, voice quota, memory retrieval, SACHIN prompt
  config/           MySQL connection pool
desktop/
  main.js           Electron always-on-top desktop widget and local server launcher
  preload.js        Minimal isolated close-window bridge
public/
  index.html        Landing page
  onboarding.html   Account and preference onboarding
  app.html          Dashboard, chat, Memory Vault, and settings
  widget.html       Standalone compact companion page
  manifest.webmanifest, sw.js, sachin-icon.svg   Installable PWA shell
  css/              Responsive SACHIN visual system
  js/               API, chat, voice, billing, onboarding, and widget clients
```

## Production notes

Use HTTPS, a private MySQL network, a strong unique JWT secret, a restrictive `CLIENT_ORIGIN`, and managed environment secrets. The RevenueCat webhook secret must never be sent to the browser. Back up the MySQL database and configure retention/deletion policies appropriate for your deployment.
