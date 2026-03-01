# 📰 Daily News Clipper — n8n + Telegram Bot

A self-hosted news aggregation bot for [n8n](https://n8n.io) that collects, filters, and delivers a daily digest from 9 sources via Telegram — with AI-powered search, explanations, and voice replies.

![Telegram screenshot](https://img.shields.io/badge/Telegram-Bot-blue?logo=telegram) ![n8n](https://img.shields.io/badge/n8n-workflow-orange?logo=n8n) ![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **9 news categories** with smart filtering and cross-source trending detection
- **On-demand commands** via Telegram bot + scheduled daily digest at 8 AM
- **Smart delivery** — text message when it fits; when it doesn't, the digest is published to a self-hosted web page and a clickable link is sent via Telegram
- **Live feedback** — "⏳ Fetching..." placeholder that gets edited in-place with the final result
- **AI-powered** with automatic failover across 5 providers:
  - **Google Gemini 2.0 Flash** (primary) — with Google Search grounding for `/search`
  - **GPT-5 via GitHub Models** (fallback 2) — kicks in if Gemini quota is exhausted
  - **NVIDIA Llama 3.3 70B** (fallback 3)
  - **Cerebras Llama 3.3 70B** (fallback 4) — generous free daily token quota
  - **Mistral Small** (fallback 5) — final safety net
- **AI Daily Briefing** — every digest opens with an AI-generated executive summary and Story of the Day headline
- **BRPT deduplication** — AI groups duplicate stories (same event, different sources) into a single entry with source links
- **Voice I/O** — send a voice message, get a voice reply (with graceful text fallback if TTS is unavailable). Transcription uses a 3-model Gemini fallback chain (each model has separate rate limits) with Groq Whisper as last resort
- **CVE lookup** — query specific CVEs with CVSS scores, affected products, and references
- **Full Unicode** — robust encoding handling: auto-detects UTF-8 vs Latin-1 per feed, with fallback re-decode if a mislabelled feed causes replacement characters

## Prerequisites

| What | Where to get it | Cost |
|---|---|---|
| **n8n instance** | Self-hosted via Docker | Free |
| **Telegram Bot token** | [@BotFather](https://t.me/BotFather) | Free |
| **NVD API key** | [nvd.nist.gov](https://nvd.nist.gov/developers/request-an-api-key) | Free |
| **Google Gemini API key** | [aistudio.google.com](https://aistudio.google.com/apikey) | Free (15 req/min) |
| **Public HTTPS URL** | See note below | Free options available |
| **GitHub token (GPT-5)** *(optional)* | [github.com/marketplace/models](https://github.com/marketplace/models) | Free tier available |
| **NVIDIA API key** *(optional)* | [build.nvidia.com](https://build.nvidia.com/) | Free tier available |
| **Cerebras API key** *(optional)* | [cloud.cerebras.ai](https://cloud.cerebras.ai/) | Free daily quota |
| **Mistral API key** *(optional)* | [console.mistral.ai](https://console.mistral.ai/) | Free tier available |

### Getting a public HTTPS URL

n8n needs a publicly reachable HTTPS URL so Telegram can deliver messages to its webhook. You have a few options:

#### Option A — Cloudflare Tunnel *(recommended, free)*

The easiest approach: no open ports, no static IP, no TLS certificate to manage. Cloudflare Tunnel creates an outbound-only encrypted connection from your machine to Cloudflare's edge.

1. Sign up at [cloudflare.com](https://cloudflare.com) (free)
2. Install `cloudflared`: [developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started)
3. Run `cloudflared tunnel login` and follow the prompts
4. Create a tunnel and route your domain to `localhost:5678` (n8n) and `localhost:8080` (digest page)

> **Don't have a domain?** Cloudflare requires you to own the domain you tunnel to. See the DynDNS options below if you need a free one first.

#### Option B — Free dynamic DNS + Cloudflare Tunnel

If you don't own a domain, any of these free DynDNS services gives you a subdomain you can then add to Cloudflare:

| Service | Example hostname | Notes |
|---|---|---|
| [DuckDNS](https://www.duckdns.org) | `yourname.duckdns.org` | Completely free, no ads, ACME-friendly |
| [Afraid FreeDNS](https://freedns.afraid.org) | `yourname.afraid.org` (+ others) | Free tier, many TLD choices |
| [No-IP](https://www.noip.com) | `yourname.ddns.net` | Free tier (requires monthly confirmation) |

Once you have a hostname: add it to Cloudflare as a custom domain, then use Cloudflare Tunnel to route traffic from it to your local machine.

#### Option C — Reverse proxy with a VPS

Run a small VPS (e.g. Hetzner CX11 ~€4/mo, Oracle Always Free tier) with nginx or Caddy as a reverse proxy pointing to your home machine over SSH tunnel or WireGuard. Caddy handles TLS automatically.

---

## Setup Guide

### Step 1 — Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to choose a name and username
3. BotFather will reply with a **bot token** like `1234567890:AAH_xxxxxxxxxxxxxxxxxxxxxxxxxxxx`
4. Copy the full token — you'll need it in Step 5
5. Send any message to your new bot (this creates the chat so the bot can reply)

### Step 2 — Get Your Chat ID

Your chat ID tells the bot where to send the daily scheduled digest. Run:

```bash
curl -s https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates | grep -o '"id":[0-9]*' | head -1
```

You'll get something like `"id":1064161611` — that number is your chat ID.

### Step 3 — Get API Keys

**NVD API Key** (for CVE alerts):
1. Go to [nvd.nist.gov/developers/request-an-api-key](https://nvd.nist.gov/developers/request-an-api-key)
2. Fill in the form with your email
3. Check your inbox — the key arrives within minutes

**Google Gemini API Key** (for `/search`, `/explain`, `/explainlike5`):
1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **"Create API Key"** → select any project (or create one)
4. Copy the key (starts with `AIzaSy...`)
5. No credit card required — free tier gives 15 requests/minute

**NVIDIA API Key** *(optional fallback — kicks in when Gemini quota is exceeded)*:
1. Go to [build.nvidia.com](https://build.nvidia.com/)
2. Sign up / sign in
3. Go to any model page (e.g., [Llama 3.3 70B](https://build.nvidia.com/meta/llama-3_3-70b-instruct))
4. Click **"Get API Key"** or find it in your account settings
5. Copy the key (starts with `nvapi-...`)

### Step 4 — Deploy n8n with Docker Compose

Create a `.env` file:

```env
POSTGRES_PASSWORD=change-me-to-something-secure
N8N_ENCRYPTION_KEY=generate-a-random-string-here
N8N_ADMIN_PASSWORD=your-admin-password
DOMAIN=n8n.yourdomain.com
DIGEST_PUBLIC_URL=https://digest.yourdomain.com
GEMINI_API_KEY=AIzaSy...your-gemini-key
N8N_GITHUB_GPT5_KEY=github_pat_...your-github-token
NVIDIA_API_KEY=nvapi-...your-nvidia-key
N8N_CEREBRAS_API_KEY=csk-...your-cerebras-key
N8N_MISTRAL_API_KEY=...your-mistral-key
N8N_GROQ_API_KEY=gsk_...your-groq-key
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CHAT_ID=1064161611
```

Create `docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:18
    restart: unless-stopped
    environment:
      POSTGRES_USER: n8n
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: n8n
    volumes:
      - ./postgres:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U n8n"]
      interval: 5s
      timeout: 5s
      retries: 5

  n8n:
    image: n8nio/n8n:2.10.2
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "127.0.0.1:5678:5678"
    environment:
      # Database
      DB_TYPE: postgresdb
      DB_POSTGRESDB_HOST: postgres
      DB_POSTGRESDB_PORT: 5432
      DB_POSTGRESDB_DATABASE: n8n
      DB_POSTGRESDB_USER: n8n
      DB_POSTGRESDB_PASSWORD: ${POSTGRES_PASSWORD}

      # Encryption (CRITICAL – never change after first run)
      N8N_ENCRYPTION_KEY: ${N8N_ENCRYPTION_KEY}
      N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS: "true"

      # Digest web page
      DIGEST_PUBLIC_URL: ${DIGEST_PUBLIC_URL}

      # Allow workflow code to read env vars
      N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"

      # API keys (accessible via $env in Code nodes)
      N8N_GEMINI_API_KEY: ${GEMINI_API_KEY}
      N8N_NVIDIA_API_KEY: ${NVIDIA_API_KEY}
      N8N_GITHUB_GPT5_KEY: ${N8N_GITHUB_GPT5_KEY}
      N8N_CEREBRAS_API_KEY: ${N8N_CEREBRAS_API_KEY}
      N8N_MISTRAL_API_KEY: ${N8N_MISTRAL_API_KEY}
      TELEGRAM_CHAT_ID: ${TELEGRAM_CHAT_ID}

      # External URL (required for Telegram webhooks)
      N8N_HOST: ${DOMAIN}
      N8N_PROTOCOL: https
      WEBHOOK_URL: https://${DOMAIN}/

      # Security
      N8N_BASIC_AUTH_ACTIVE: "true"
      N8N_BASIC_AUTH_USER: admin
      N8N_BASIC_AUTH_PASSWORD: ${N8N_ADMIN_PASSWORD}
      N8N_SECURE_COOKIE: "true"

      # Housekeeping
      EXECUTIONS_PROCESS: main
      EXECUTIONS_DATA_PRUNE: "true"
      EXECUTIONS_DATA_MAX_AGE: 168

      GENERIC_TIMEZONE: UTC
    volumes:
      - ./n8n_data:/home/node/.n8n
      - digest-files:/home/node/.n8n/digest-files

  nginx-digest:
    image: nginx:alpine
    restart: unless-stopped
    # nginx runs as root → chowns the shared volume so n8n (uid 1000) can write
    command: sh -c "chmod 777 /srv/digest && nginx -g 'daemon off;'"
    volumes:
      - digest-files:/srv/digest
      - ./nginx-digest.conf:/etc/nginx/conf.d/default.conf:ro
    ports:
      - "127.0.0.1:8080:80"

volumes:
  digest-files:
```

> **Note:** `nginx-digest` serves the digest HTML at port 8080. Point your reverse proxy / Cloudflare Tunnel to `localhost:8080` for `digest.yourdomain.com`.

Start it:

```bash
docker compose up -d
```

> **Important:** `N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"` is required. Without it, the AI features cannot read the API keys.

### Step 5 — Import the Workflow

1. Open n8n at `https://your-domain:5678`
2. Go to **Workflows** → **Import from File**
3. Select `security-news-workflow.json`
4. Click **Save**

### Step 6 — Configure n8n Credentials

After importing, you need to create and link **2 credentials**:

#### 🤖 Telegram Bot API

1. Go to **Settings** → **Credentials** → **Add Credential**
2. Search for **"Telegram"** and select **Telegram API**
3. Paste your bot token from Step 1
4. Click **Save**
5. Open **each** of these 11 nodes and select your Telegram credential:

| Node | Purpose |
|---|---|
| `Telegram Trigger` | Receives incoming messages |
| `Send Help` | Replies with command list |
| `Send CVE Detail` | Replies with CVE info |
| `Send AI Thinking` | Sends "🔍 Searching..." placeholder |
| `Edit AI Response` | Edits placeholder with AI result |
| `Send Voice Reply` | Sends audio response |
| `Edit After Audio` | Edits placeholder after voice |
| `Send Processing` | Sends "⏳ Fetching..." placeholder |
| `Edit Text Message` | Edits placeholder with digest text |
| `Delete Processing Msg` | Deletes placeholder when digest is long |
| `Send Digest Link` | Sends link to the published web page |

#### 🔑 NVD API Key (Header Auth)

1. Go to **Settings** → **Credentials** → **Add Credential**
2. Search for **"Header Auth"**
3. Configure:
   - **Name**: `NVD API Key`
   - **Header Name**: `apiKey` ← must be exactly this (it's the HTTP header the NVD API expects)
   - **Header Value**: your NVD API key from Step 3
4. Click **Save**
5. Open these 2 nodes and select the credential:

| Node | Purpose |
|---|---|
| `Fetch CVEs` | Daily CVE feed |
| `Fetch Single CVE` | `/cve CVE-xxxx-xxxx` lookup |

> **Note:** Gemini and NVIDIA API keys do **not** use n8n credentials — they're read from environment variables by the `Call AI` Code node. This is because n8n's HTTP Request node had compatibility issues with the Gemini API body format.

### Step 7 — Activate & Test

1. Click **Save**, then toggle **Active** (top-right)
2. Send `/help` to your bot on Telegram
3. Test the digest: `/all`
4. Test AI: `/explainlike5 black holes`
5. Test search: `/search latest news on kubernetes`

Verify the webhook is registered:

```bash
curl -s https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo | python3 -m json.tool
```

You should see your n8n webhook URL in the `url` field.

---

## Bot Commands

### 📰 News Digest

| Command | Description |
|---|---|
| `/all` | Compact digest (top 5 per trending category) |
| `/extended` | Full digest with all items |
| `/cve` | Today's CVE alerts |
| `/cve CVE-2024-XXXX` | Detailed CVE lookup |
| `/security` | Security news |
| `/services` | Service disruptions |
| `/retro` | Retrogaming / modding / jailbreak |
| `/scitech` | Science & tech (cross-source trending) |
| `/world` | World news (cross-source trending) |
| `/hn` | Hacker News front page (top 15, pre-filtered ≥ 30 points) |
| `/brpt` | Brazil & Portugal (cross-source trending) |
| `/youtube` | Recent YouTube uploads |

Append `extended` for full results: `/retro extended`, `/scitech extended`

### 🤖 AI Commands

| Command | Description |
|---|---|
| `/search <query>` | Google-grounded web search via Gemini |
| `/explain <topic>` | Detailed explanation |
| `/explainlike5 <topic>` | Explain like I'm 5 years old |
| 🎤 *Send voice message* | AI processes → replies with voice (or text fallback if TTS unavailable) |
| 📷 *Send photo* | AI describes what it sees (Gemini Vision, 3-model fallback) |
| 📷 *Send photo + caption* | AI analyzes the image in the context of your message |
| 🎥 *Send video* (≤ 20 MB) | AI analyzes video content via Gemini File API |
| 🎥 *Send video + caption* | AI analyzes the video in the context of your message |

AI commands try providers in order: **Gemini → GPT-5 (GitHub) → NVIDIA → Cerebras → Mistral**. The first available provider with remaining quota is used.

Photo and video analysis use **Gemini Vision** exclusively (3-model fallback: gemini-2.0-flash → gemini-2.5-flash → gemini-2.0-flash-lite). Photos are sent as inline base64; videos are uploaded via the Gemini File API. If vision analysis fails and no caption was provided, the bot returns a friendly error instead of falling through to a text-only LLM.

Voice transcription tries: **gemini-2.0-flash → gemini-2.5-flash → gemini-2.0-flash-lite → Groq Whisper**. Each Gemini model has its own rate limit (~15 RPM / 1500 RPD), so quota exhaustion on one model doesn't affect others.

---

## Architecture

```
Telegram Trigger → Parse Command
                      │
        ┌─────────────┼─────────────────────┐
        ▼             ▼                     ▼
    Is Help?    Is CVE Lookup?           Is AI?
        │             │               ┌─────┴──────┐
        ▼             ▼               ▼            ▼
   Send Help    NVD API →        Call AI       Send "⏳" →
                Format →         ┌──────────┐  Capture ID →
                Send             │ 🎤 Voice  │  9 RSS/API
                                 │ 📷 Photo  │  sources →
                                 │ 🎥 Video  │  8 Merge nodes →
                                 │ → Gemini  │  Tag + Condense
                                 │   Vision  │       │
                                 │ + text AI │  ┌─────┴──────┐
                                 │ fallback  │  ▼            ▼
                                 └─────┬─────┘ Edit "⏳"  Delete "⏳" →
                                       ▼      with text   Write HTML →
                                 Is Audio?                 Send link
                                  ┌──┴──┐
                                  ▼     ▼
                               TTS?   Edit
                                │     "🔍"
                             ┌──┴──┐  (text
                             ▼     ▼  fallback)
                          Voice  Edit
                          reply  "🎤 Here's
                                 your answer:"
```

### How the Digest Works

1. 9 sources are fetched in parallel (RSS feeds + NVD API)
2. Each source has a dedicated filter node with category-specific logic
3. Results flow through 8 chained Merge nodes (ensuring all sources complete before continuing)
4. `Tag Category` attaches the chat ID and requested category
5. `Condense Digest` builds either a text message or HTML file depending on size
6. If ≤ 4000 chars → the "⏳" placeholder is **edited** with the digest text
7. If > 4000 chars → the HTML is written to the `nginx-digest` volume, the "⏳" placeholder is **deleted**, and a Telegram message with a link to the web page is sent

### Cross-Source Trending

Science & Tech, World News, and Brazil & Portugal categories use a trending algorithm: only articles with keywords appearing in **2+ different sources** make the cut. This filters out noise and surfaces stories that multiple outlets are covering.

---

## News Sources

| Category | Sources | Filter Logic |
|---|---|---|
| 🛡️ CVE Alerts | NVD API v2.0 | Keywords (AWS, Kubernetes, Terraform) + CVSS ≥ 7 — OR any CVSS ≥ 9.0 (critical bypass). 48h recency gate. |
| 🔐 Security News | TheHackersNews, SecurityWeek | Security-event vocabulary: breach, ransomware, zero-day, exploit, RCE, supply chain, phishing, etc. |
| ⚠️ Service Disruptions | Cloudflare, AWS, Hetzner, Atlassian | 14 incident terms: outage, degraded, unavailable, investigating, elevated latency, etc. |
| 🎮 Retrogaming | RetroRGB, Retro Dodo, Hackaday, Wololo | 40+ keywords: emulation, homebrew, FPGA, MiSTer, Steam Deck, RetroArch, Miyoo, Anbernic, etc. |
| 🔬 Science & Tech | NYT, BBC, Guardian, Ars Technica, MIT TR, Nature | Cross-source trending (≥ 2 sources) + high-signal single-source bypass + 48h recency. Fallback: top 3 most recent. |
| 🌍 World News | BBC, NYT, Guardian, Al Jazeera, Reuters | Cross-source trending (≥ 2 sources) + breaking-news bypass + 48h recency. Fallback: top 3 most recent. |
| 🟠 Hacker News | hnrss.org/frontpage?points=30 | Pre-filtered to ≥ 30 points via HNRSS, top 15 stories. |
| 🇧🇷🇵🇹 Brazil & Portugal | Folha, G1, UOL, Renascença, Público, SAPO, Observador | Cross-source trending + urgency bypass + 48h recency. Split into 🇧🇷 Brasil / 🇵🇹 Portugal subsections. AI deduplication groups same-event articles from multiple sources. |
| 📺 YouTube | Custom channel subscriptions | Published in last 24 hours. |

---

## Customization

### Add/Remove RSS Feeds
Edit the URL Function nodes (e.g., `SciTech URLs`, `BR PT URLs`). Each returns an array of `{ json: { url: '...' } }` items.

### Add YouTube Channels
1. Find the channel ID (view page source or use a lookup tool)
2. Edit `YouTube URLs` node and add:
```javascript
{ json: { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC...', channel: 'Channel Name' } }
```

### Change Filter Keywords
Edit the Filter Function nodes. `Filter Security News` uses a security-event regex (breach, ransomware, zero-day, RCE, etc.) — extend it there. `Filter CVEs` uses `kw=['AWS','Kubernetes','Terraform']` — expand this list for your stack.

### Change Trending Sensitivity
In trending filter nodes (`Filter SciTech Trending`, etc.), find `ks[k].size >= 2` and change `2` to a higher number to require more cross-source agreement.

### Change Schedule
Edit the `Cron Daily` node to change from 8:00 AM UTC.

### Change AI Model
In the relevant Code nodes (`Call AI`, `Generate AI Briefing`, `Deduplicate BRPT`):
- **Gemini**: change `gemini-2.0-flash` in the URL to another model
- **NVIDIA**: change `meta/llama-3.3-70b-instruct` to any model from [build.nvidia.com](https://build.nvidia.com/)
- **Cerebras**: change `llama-3.3-70b` to any model from [inference-docs.cerebras.ai](https://inference-docs.cerebras.ai/)
- **Mistral**: change `mistral-small-latest` to any model from [docs.mistral.ai](https://docs.mistral.ai/)

### Change Transcription Models
In `Call AI`, find the `_models` array in the voice transcription block:
```javascript
const _models = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash-lite'];
```
Replace or reorder models. All models must support audio input via the Gemini `v1beta` API. Each model has separate rate limits, so more models = more total quota for voice messages.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Bot doesn't respond | Check workflow is **Active**. Verify webhook: `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo` |
| AI says "No AI provider configured" | Check that at least one AI key (`GEMINI_API_KEY`, `N8N_GITHUB_GPT5_KEY`, `NVIDIA_API_KEY`, `N8N_CEREBRAS_API_KEY`, or `N8N_MISTRAL_API_KEY`) is set in docker-compose **and** that `N8N_BLOCK_ENV_ACCESS_IN_NODE` is `"false"`. Restart container after changes. |
| AI says "process is not defined" | The `Call AI` node must be a **Code** node (`n8n-nodes-base.code`), not the old Function node. Re-import the latest workflow. |
| Gemini returns 429 | Quota exhausted — the fallback chain (GPT-5 → NVIDIA → Cerebras → Mistral) kicks in automatically for AI answers. For voice transcription, 3 Gemini models are tried with separate rate limits before falling back to Groq. If all providers fail, wait ~60s for quota to reset. |
| BRPT deduplication not running | The `Deduplicate BRPT` node requires at least one AI key. Check the n8n execution log for the node's output — it skips silently if no key is found. |
| NVD returns 403 | Check the Header Auth credential: Header Name must be exactly `apiKey` (case-sensitive). |
| Multiple messages instead of one | The 8 chained Merge nodes must be properly connected. Re-import if broken. |
| Broken accents / diamonds (ã→â–ï¿½) | `BR PT Fetch` auto-detects mislabelled UTF-8 feeds and re-decodes as Latin-1. If still broken on non-BRPT feeds, those filters include an `_d()` HTML entity decoder; check your n8n container's locale. |
| "message to edit not found" | The placeholder message was deleted before the edit could happen. Check `Capture Msg ID` node. |
| Webhook not registering | n8n must be publicly accessible via HTTPS. Check `WEBHOOK_URL` env var. Try deactivating and reactivating the workflow. |
| Voice transcription fails | Gemini models are tried in order (2.0-flash → 2.5-flash → 2.0-flash-lite), each with separate rate limits. If all 3 are exhausted, Groq Whisper is the last resort. **Note:** Groq multipart upload is experimental on n8n 2.x due to `httpRequest` binary handling limitations — it may not work reliably on all n8n versions. Check `Call AI` node execution log for provider-specific errors. |
| Voice reply sent as text | The `Is Audio Response?` IF node must use a **boolean** condition (not string) checking `respondAsAudio`. Re-import the workflow if it was modified. |
| Voice reply doesn't work | Google TTS has rate limits. `Fetch TTS Audio` has `continueOnFail` enabled — if TTS fails, the bot automatically falls back to text with a "🎤 Voice reply unavailable" indicator. Check the node execution log for details. |
| Photo analysis not working | Requires `N8N_GEMINI_API_KEY`. The bot will still reply with text using the original caption. Check the `Call AI` execution log for photo-specific errors. |
| Video analysis not working | Requires `N8N_GEMINI_API_KEY`. Videos must be ≤ 20 MB (Telegram's getFile limit). The File API upload + polling can take up to 60 seconds for longer clips. Check `Call AI` execution log for details. |
| "Video too large" error | Expected for files > 20 MB — Telegram's cloud download cap. Compress or trim the video. |
| Digest link returns 404 | The `nginx-digest` container is running but no digest has been generated yet. Trigger `/all` or wait for the cron to run. |
| Digest page not accessible | Confirm your reverse proxy / Cloudflare Tunnel routes `digest.yourdomain.com` → `localhost:8080`. Check `docker compose ps` to verify `nginx-digest` is running. |

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes* | Google Gemini API key for AI features (also powers photo/video vision analysis and voice transcription) |
| `N8N_GITHUB_GPT5_KEY` | No | GitHub personal access token — GPT-5 via GitHub Models (fallback 2) |
| `NVIDIA_API_KEY` | No | NVIDIA API key — Llama 3.3 70B (fallback 3) |
| `N8N_CEREBRAS_API_KEY` | No | Cerebras API key — Llama 3.3 70B with generous free quota (fallback 4) |
| `N8N_MISTRAL_API_KEY` | No | Mistral API key — Mistral Small (fallback 5) |
| `N8N_GROQ_API_KEY` | No* | Groq API key — Whisper `whisper-large-v3-turbo` for voice transcription (fallback if Gemini quota exhausted) |
| `TELEGRAM_BOT_TOKEN` | Yes | Your Telegram bot token — also used by `Call AI` to download voice messages, photos, and videos for AI analysis |
| `TELEGRAM_CHAT_ID` | Yes | Your Telegram chat ID (used for scheduled daily digests) |
| `DOMAIN` | Yes | Public domain for your n8n instance (e.g. `n8n.yourdomain.com`) |
| `DIGEST_PUBLIC_URL` | No | Public URL where long digests are published (e.g. `https://digest.yourdomain.com`). If unset, long digests are silently skipped. |
| `WEBHOOK_URL` | Yes | Public HTTPS URL of your n8n instance |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | Yes | Must be `"false"` for AI features to read API keys |
| `N8N_ENCRYPTION_KEY` | Yes | n8n encryption key — **never change after first run** |

\* At least one AI key is required for AI commands and BRPT deduplication. The fallback chain is: Gemini → GPT-5 → NVIDIA → Cerebras → Mistral.

\*\* Voice transcription uses a 3-model Gemini chain (gemini-2.0-flash → gemini-2.5-flash → gemini-2.0-flash-lite) via base64 multimodal input, with Groq Whisper as last resort. Each Gemini model has separate rate limits. At least one of `N8N_GEMINI_API_KEY` or `N8N_GROQ_API_KEY` is needed for voice messages to work. Groq multipart is experimental on n8n 2.x (`httpRequest` may not reliably send binary multipart). Get a free Groq key at [console.groq.com](https://console.groq.com).

---

## Workflow Stats

- **69 nodes**, **86 connections**
- 13 Telegram nodes (trigger + send/edit/delete, including photo/video scaffold)
- 9 parallel RSS/API fetchers
- 8 chained Merge nodes
- 3 Code nodes for AI:
  - `Call AI` — on-demand commands (`/search`, `/explain`, `/explainlike5`, voice/photo/video)
  - `Generate AI Briefing` — digest-time executive summary + Story of the Day (one call per digest run)
  - `Deduplicate BRPT` — groups same-event articles from Brazil & Portugal into single entries with multi-source links

## License

MIT — do whatever you want with it.
