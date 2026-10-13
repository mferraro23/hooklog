# hookpeek

Catch, inspect, replay, and forward webhooks.

Create an endpoint, point Stripe, GitHub, Paystand, or anything else at it, and watch requests arrive live. From there you can inspect headers, query, and body, copy any request as cURL, replay it to another URL, or forward new requests to `localhost` with a one-line CLI.

It runs entirely on Azure's free and near-free tiers.

## How it works

```
 webhook sender ──► /api/h/{id}/*  ─┐
                                    │  Azure Static Web Apps (Free)
 dashboard (React) ◄── /api/... ────┤  └─ managed Azure Functions (TypeScript)
                                    │
 hookpeek CLI ──► polls, forwards ───┘        Azure Table Storage
     └──► http://localhost:3000                 endpoints · requests
```

| Piece | What it does |
| --- | --- |
| `web/` | React + TypeScript + Tailwind dashboard. Polls for new requests every 2 seconds and pauses when the tab is hidden. |
| `api/` | Azure Functions (Node 20, v4 model). Capture, list, detail, clear, replay, and purge. |
| `cli/hookpeek.mjs` | Dependency-free Node CLI that forwards new requests to a local server. |
| `infra/main.bicep` | Storage account, Static Web App (Free), app settings, and an optional $5/month budget alert. |
| `.github/workflows` | Build checks and deploy on push. A daily job purges expired endpoints. |

### Design notes

- **Newest-first row keys.** A request id is `(9999999999999 - now)` plus a random suffix, so Table Storage's natural ascending order returns the newest requests first. Polling for anything newer is a single `RowKey lt '<newest>'` range query.
- **Chunked bodies.** Table string properties max out at about 32K characters, so bodies up to 256 KB are split across `body0..bodyN` properties. Non-UTF-8 bodies are stored as base64 so binary payloads round-trip exactly.
- **Replay is SSRF-guarded.** Target hosts are resolved, and the replay is refused if any resolved address is loopback, private, link-local (including cloud metadata at `169.254.169.254`), CGNAT, or multicast. Redirects aren't followed. Forwarding to your own machine is the CLI's job.
- **Bounded storage.** Each endpoint keeps at most 200 requests (pruned on write), and endpoints expire after 7 days. Static Web Apps' managed functions can't run timers, so a scheduled GitHub Action calls a key-protected purge route.
- **Clean headers.** Headers added by Azure's front end (`x-ms-*`, `x-arr-*`, `x-forwarded-*`, and so on) are hidden so you see what the sender actually sent. The source IP comes from `x-forwarded-for`.

## Run it locally

Requires Node 20+.

```bash
npm run install:all
npm run dev
```

Then open http://localhost:4280. The dev script runs Azurite (the local Table Storage emulator), the Functions host, Vite, and the Static Web Apps CLI proxy together.

The first time, copy `api/local.settings.example.json` to `api/local.settings.json`.

## Use the CLI

```bash
npx github:mferraro23/hookpeek listen <endpoint-id> --to http://localhost:3000 --server https://<your-hookpeek-host>
```

Only requests that arrive after the CLI starts are forwarded. Each one is replayed with its original method, path, query, headers, and body.

## Deploy to Azure

You need the Azure CLI (`az`) and the GitHub CLI (`gh`).

```bash
az login
az group create -n hookpeek-rg -l eastus2

ADMIN_KEY=$(openssl rand -hex 32)
az deployment group create -g hookpeek-rg -f infra/main.bicep \
  -p adminKey=$ADMIN_KEY alertEmail=you@example.com

SWA=$(az deployment group show -g hookpeek-rg -n main --query properties.outputs.staticWebAppName.value -o tsv)
URL=$(az deployment group show -g hookpeek-rg -n main --query properties.outputs.url.value -o tsv)

gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --body "$(az staticwebapp secrets list -n $SWA --query properties.apiKey -o tsv)"
gh secret set HOOKPEEK_ADMIN_KEY --body "$ADMIN_KEY"
gh variable set HOOKPEEK_URL --body "$URL"

git push   # the Build & deploy workflow publishes the site
```

To use a custom domain such as `hookpeek.yourdomain.com`, add a CNAME pointing at the Static Web App's hostname, then run `az staticwebapp hostname set -n $SWA --hostname hookpeek.yourdomain.com`.

### Cost

| Service | Tier | Expected monthly cost |
| --- | --- | --- |
| Static Web Apps + managed Functions | Free | $0 |
| Table Storage (LRS) | Pay as you go | Cents at hobby traffic |
| GitHub Actions | Free for public repos | $0 |

The Bicep template adds a $5 monthly budget alert when you pass `alertEmail`.

## Limits and privacy

- Bodies are stored up to 256 KB. Larger bodies are kept truncated and flagged.
- 200 requests per endpoint. Endpoints and their data are deleted 7 days after creation.
- The sender's `Authorization` header can't be captured: Static Web Apps replaces it with its own internal token before the request reaches the Functions. hookpeek drops that token so it's never stored or replayed. Signature headers like `stripe-signature` and `x-hub-signature-256` come through fine.
- An endpoint's URL is its only credential (about 96 random bits). Anyone with the URL can see its requests, so don't send production secrets to it.

## Roadmap

- Live push over Azure SignalR (free tier) instead of polling
- Automatic forwarding rules with retries and backoff (a queue-triggered Function)
- Optional sign-in to claim endpoints and keep them longer
- Signature verification helpers for Stripe, GitHub, and Paystand
