# Cloud Storage Integration for Zavu (Cloudflare R2 via Pages Functions)

## Overview
Zavu Pro users can create 7-day permanent download links by uploading files to Cloudflare R2. Uploads are handled by **Cloudflare Pages Functions** — lightweight serverless functions that deploy automatically with your Pages site.

## Architecture

```
Browser  →  POST /api/upload (file + Firebase JWT)  →  Pages Function  →  R2 Bucket
Browser  ←  { downloadUrl: "/api/download/..." }    ←  Pages Function

Anyone   →  GET /api/download/FILE?token=...        →  Pages Function  →  R2 Bucket  → file stream
```

- **No R2 credentials in the browser** — the Pages Function holds them server-side
- **R2 egress through Workers is FREE** — no bandwidth charges for downloads
- **HMAC-signed download URLs** — tamper-proof, auto-expire after 7 days

## Setup Instructions

### 1. Create an R2 Bucket
1. Go to [Cloudflare Dashboard → R2](https://dash.cloudflare.com/?to=/:account/r2)
2. Click **Create Bucket**, name it `zavu-uploads`
3. Add a lifecycle rule: **Delete objects after 7 days**

### 2. Set Environment Variables
In the Cloudflare Dashboard under your Pages project → **Settings → Environment Variables**, add:

| Variable | Value | Where |
|----------|-------|-------|
| `FIREBASE_PROJECT_ID` | Your Firebase project ID | Production + Preview |
| `DOWNLOAD_SIGNING_SECRET` | Random 64-char hex string | Production + Preview |

Generate a signing secret:
```bash
openssl rand -hex 32
```

The R2 bucket binding (`ZAVU_BUCKET`) is configured in `wrangler.toml` and picked up automatically.

### 3. Deploy
Just `git push` — Cloudflare Pages automatically detects the `functions/` directory and deploys the serverless functions alongside your static site.

### 4. Set Up R2 Lifecycle Rules (Important!)
To auto-delete files after 7 days and prevent storage cost growth:
1. Go to your R2 bucket → **Settings → Object lifecycle rules**
2. Add a rule: **Delete objects after 7 days**

## Files

| File | Purpose |
|------|---------|
| `functions/_middleware.ts` | CORS handling for API routes |
| `functions/api/_auth.ts` | Firebase JWT verification + HMAC token signing |
| `functions/api/upload.ts` | `POST /api/upload` — authenticated file upload to R2 |
| `functions/api/download/[id].ts` | `GET /api/download/:id` — signed file download from R2 |
| `src/cloud-storage.ts` | Frontend client — calls `/api/upload` with Firebase JWT |
| `wrangler.toml` | R2 bucket binding configuration |

## Security

- ✅ R2 credentials never leave the server
- ✅ Firebase JWT verified on every upload
- ✅ Pro status checked server-side via JWT custom claims
- ✅ Download URLs are HMAC-signed with constant-time comparison
- ✅ Download links auto-expire after 7 days
- ✅ Files auto-deleted via R2 lifecycle rules

## Cost Estimate

| Usage | Storage | Egress | Workers | Total/month |
|-------|---------|--------|---------|-------------|
| 10 GB, 50 downloads | ~$0.15 | $0 (free) | $0 (free tier) | ~$0.15 |
| 100 GB, 500 downloads | ~$1.50 | $0 (free) | $0 (free tier) | ~$1.50 |
| 1 TB, 5K downloads | ~$15.00 | $0 (free) | ~$2.50 | ~$17.50 |

*R2 egress through Workers is completely free. Worker invocations: 100K/day free.*
