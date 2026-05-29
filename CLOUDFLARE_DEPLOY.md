# Deploying to Cloudflare Workers

## Prerequisites

- Node.js ≥ 18 and `bun` installed
- A Cloudflare account (free tier works)
- Your Supabase project credentials

## 1. Install dependencies

```bash
bun install
```

## 2. Authenticate with Cloudflare

```bash
bunx wrangler login
```

## 3. Set secrets

Run these once — Cloudflare encrypts and stores them server-side:

```bash
bunx wrangler secret put SUPABASE_URL
# paste: https://<your-project-id>.supabase.co

bunx wrangler secret put SUPABASE_PUBLISHABLE_KEY
# paste: sb_publishable_...

bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# paste: eyJ...  (from Supabase → Settings → API → service_role key)
```

## 4. Build and deploy

```bash
bun run build
bunx wrangler deploy
```

Your app will be live at `https://dashboardwash.<your-account>.workers.dev`.

## 5. Custom domain (optional)

In the Cloudflare dashboard → Workers & Pages → your worker → Settings → Domains & Routes,
add a custom domain or route.

Update `INGEST_URL` in any downloaded ESP32 sketches to point to your new domain.

## Local development

```bash
cp .dev.vars.example .dev.vars
# fill in your real credentials in .dev.vars
bunx wrangler dev
```

## Supabase: apply migrations

If you haven't applied the latest migrations to your Supabase project:

```bash
# Install Supabase CLI if needed
# https://supabase.com/docs/guides/cli

supabase link --project-ref <your-project-id>
supabase db push
```

The key migration (`20260522054228`) adds `readings` to the `supabase_realtime` publication
and sets `REPLICA IDENTITY FULL` — required for live dashboard updates.

## Re-flash ESP32 after deploy

After setting your custom domain, go to **Admin → Download Sketch** for each site,
re-download the `.ino` file (it now contains the correct endpoint URL), and re-flash.

Changes in the new sketch:
- Per-meter debounce: 50 ms for wash relays, 25 ms for hall-effect flow sensors
- Chemical-low transitions push immediately (within ~1 s) instead of waiting 15 s
- Periodic send interval: 15 s (down from 30 s)
