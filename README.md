# hookpeek

Catch, inspect, replay, and forward webhooks.

Create an endpoint, point Stripe, GitHub, Paystand, or anything else at it, and watch requests arrive live. From there you can inspect headers, query, and body, copy any request as cURL, replay it to another URL, or forward new requests to `localhost` with a one-line CLI.

It runs entirely on Azure's free and near-free tiers. **Live at [hookpeek.dev](https://hookpeek.dev).**

## Why it exists

When a service like Stripe or Paystand sends your app a webhook, you can't see what it sent unless your code logs it. hookpeek gives you a URL to send it to instead. It records every request exactly as it arrived, shows it in a dashboard, and lets you resend it to another server (**replay**) or to your own machine (**the CLI**).

## How it works

```
 Stripe / GitHub / curl                         Your browser (dashboard)
          │ POST /api/h/{id}/stripe                      │ polls GET /api/... every 2s
          ▼                                              ▼
 ┌─────────────────── Azure Static Web Apps (Free) ───────────────────┐
 │  /           → React app (static files from web/dist)              │
 │  /api/*      → managed Azure Functions (TypeScript, api/)          │
 └─────────────────────────────────┬──────────────────────────────────┘
                                   ▼
                        Azure Table Storage
                 "endpoints" table   "requests" table
                                   ▲
 hookpeek CLI on your machine ─────┘ polls for new requests, then re-sends
         └──► http://localhost:3000     each one to your local server
```

Static Web Apps does most of the work. One free service hosts the website and runs the API functions on the same domain, so there's no server to manage and no cross-origin (CORS) setup between frontend and backend. Table Storage holds the data because it's one of the cheapest databases Azure offers.

### Following a webhook through the code

**1. A webhook arrives.** Static Web Apps routes everything under `/api/` to the Functions. [`capture.ts`](api/src/functions/capture.ts) registers two routes, `h/{id}` and `h/{id}/{*rest}`, so both `/api/h/abc` and `/api/h/abc/stripe/events` are caught. The capture function then:

1. Checks that the endpoint exists and hasn't expired. If not, it returns 404 or 410.
2. Reads the raw body bytes and caps them at 256 KB.
3. Cleans the headers (step 2 below).
4. Saves one row to the `requests` table.
5. On about 1 in 10 captures, deletes everything past the newest 200 requests for that endpoint.

**2. Headers are cleaned** ([`http.ts`](api/src/lib/http.ts)). Azure's front end adds its own headers (`x-ms-*`, `x-forwarded-*`, and others) that describe Azure's internal hop, not what the sender sent, so they're removed. Azure also replaces the sender's `Authorization` header with its own short-lived internal token. `isPlatformToken` detects that token and drops it, so it's never shown or replayed.

**3. The request is stored** ([`storage.ts`](api/src/lib/storage.ts)):

- **Newest-first row keys.** Table Storage only returns rows sorted ascending by key. Each request id is an *inverted* timestamp plus a random suffix:

  ```ts
  `${9999999999999 - Date.now()}-${random}`   // later time → smaller number → sorts first
  ```

  The natural sort order is therefore newest-first. "Give me anything newer than what I have" is a single range query: `RowKey lt '<newest id I have>'`.
- **Chunked bodies.** A Table Storage text property holds at most about 32,000 characters, so a body of up to 256 KB is split across `body0`, `body1`, and so on, then joined back together when read.
- **Binary-safe.** Bytes that aren't valid UTF-8 (an image, for example) are stored as base64, so they come back byte-for-byte identical.

**4. The dashboard shows it.** [`Dashboard.tsx`](web/src/components/Dashboard.tsx) asks every 2 seconds for requests newer than the latest one it has, and skips the call while the browser tab is hidden. New rows are added to the top of the list with a brief highlight. The list call fetches only summary fields, so 50 rows don't download 50 bodies.

Clicking a row loads the full request in [`RequestDetail.tsx`](web/src/components/RequestDetail.tsx). `parseBody` in [`lib.ts`](web/src/lib.ts) chooses how to show the body: pretty-printed JSON, a table for form data, plain text, or base64.

**5. Replay** (`replayRequest` in [`requests.ts`](api/src/functions/requests.ts)). The server re-sends the stored method, headers, and body to a URL you choose. It returns the response status, the time taken, and the first 4 KB of the response body.

Replay is the riskiest feature, because it makes the *server* call any URL a user types in. Without a guard, someone could aim it at addresses that are only reachable from inside Azure, such as the cloud metadata service at `169.254.169.254`. This attack is called server-side request forgery (SSRF).

[`ssrf.ts`](api/src/lib/ssrf.ts) guards against it. It resolves the target hostname and refuses the replay if any resulting address is loopback, private, link-local, CGNAT, or multicast. Redirects aren't followed, so a public URL can't bounce the request somewhere private.

**6. Forward to localhost** ([`cli/hookpeek.mjs`](cli/hookpeek.mjs)). The cloud can't reach your machine's `localhost`, so the CLI works the other way around. It runs on your machine, asks hookpeek every 1.5 seconds for new requests, and re-sends each one to your local server. Your machine makes every connection, so you don't need a tunnel or an open port. The CLI uses no dependencies beyond Node's built-in `fetch`, so `npx github:mferraro23/hookpeek` runs it straight from this repo.

### What each part does

| File | What it does |
| --- | --- |
| [`api/src/functions/capture.ts`](api/src/functions/capture.ts) | Receives webhooks on any method and path, and stores them. |
| [`api/src/functions/endpoints.ts`](api/src/functions/endpoints.ts) | Creates an endpoint (random 16-character id, 7-day expiry) and looks one up. |
| [`api/src/functions/requests.ts`](api/src/functions/requests.ts) | Lists, reads, clears, and replays captured requests. |
| [`api/src/functions/maintenance.ts`](api/src/functions/maintenance.ts) | Purges expired endpoints. Requires an admin key, compared in constant time. |
| [`api/src/lib/storage.ts`](api/src/lib/storage.ts) | Table clients, id generation, row-key ordering, body chunking, and limits. |
| [`api/src/lib/http.ts`](api/src/lib/http.ts) | Response helpers, header cleaning, source IP, and body encoding. |
| [`api/src/lib/ssrf.ts`](api/src/lib/ssrf.ts) | Blocks replay to private and internal addresses. |
| [`web/src/App.tsx`](web/src/App.tsx) | Two-route router: `/` (landing page) and `/e/{id}` (dashboard). |
| [`web/src/api.ts`](web/src/api.ts) | Typed client for the API. |
| [`web/src/components/`](web/src/components) | Landing page, dashboard, request detail, and shared UI pieces. |
| [`web/public/staticwebapp.config.json`](web/public/staticwebapp.config.json) | Serves `index.html` for page routes, so `/e/{id}` works on a refresh, and sets the Node version and security headers. |
| [`cli/hookpeek.mjs`](cli/hookpeek.mjs) | Forwards new requests to a local server. |
| [`infra/main.bicep`](infra/main.bicep) | The Azure setup as code: storage account, Static Web App, app settings, and budget alert. |
| [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) | Builds the API, web app, and CLI on every push and PR, and deploys from `main`. |
| [`.github/workflows/purge.yml`](.github/workflows/purge.yml) | Calls the purge route once a day. |

### Design decisions

- **Polling instead of WebSockets.** A request every 2 seconds is simple, cheap, and pauses in background tabs. Pushing over Azure SignalR is on the roadmap.
- **Cleanup runs on GitHub Actions.** Static Web Apps' managed Functions can't run on a timer, so a scheduled GitHub Actions workflow calls a key-protected purge route. That makes GitHub the free scheduler.
- **Bounded storage keeps the bill near $0.** Every endpoint is capped (200 requests, 256 KB bodies, 7 days), so a stranger can't fill the storage account.
- **The endpoint id is the credential.** Ids carry about 96 random bits, which is too many to guess. That allows anonymous use with no sign-up, at the cost that anyone holding a URL can read its requests.

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

### Known weak spots

- **DNS rebinding.** The SSRF check resolves the hostname, and then `fetch` resolves it again. A hostile DNS server could return a public IP the first time and a private one the second. The fix is to connect to the exact IP that was checked.
- **No rate limiting.** Endpoint creation isn't throttled. The 7-day expiry bounds the damage but doesn't prevent abuse.
- **The prune is approximate.** Pruning runs on about 1 in 10 writes, so an endpoint can briefly hold slightly more than 200 requests.

## Roadmap

- Live push over Azure SignalR (free tier) instead of polling
- Automatic forwarding rules with retries and backoff (a queue-triggered Function)
- Optional sign-in to claim endpoints and keep them longer
- Signature verification helpers for Stripe, GitHub, and Paystand
- Pin replay connections to the IP address that passed the SSRF check
- Rate limiting on endpoint creation
