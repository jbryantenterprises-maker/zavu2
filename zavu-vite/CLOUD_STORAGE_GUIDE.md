# Cloud Storage Integration for Xavu (Cloudflare R2 via Pages Functions)

## Overview
Xavu Pro users can create 7-day permanent download links by uploading files to Cloudflare R2. Uploads are handled as **presigned multipart uploads**: Pages Functions authenticate and sign each part, but the encrypted part bytes go directly from the browser to R2.

## Architecture

```text
Browser  →  POST /api/upload                  →  create multipart session
Browser  →  POST /api/upload/sign-part       →  get presigned R2 URL for part 1
Browser  →  PUT  presigned R2 URL            →  upload encrypted part 1 directly to R2
Browser  →  POST /api/upload/sign-part       →  get presigned R2 URL for part 2
Browser  →  PUT  presigned R2 URL            →  upload encrypted part 2 directly to R2
Browser  →  POST /api/upload/complete        →  finalize upload + get signed download URL

Anyone   →  GET /api/download/FILE?token=... →  Pages Function  →  R2 Bucket  → file stream
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
| `MAX_CLOUD_UPLOAD_BYTES` | Optional total-file cap. Default supports very large multipart uploads. | Production + Preview |
| `MAX_CLOUD_UPLOAD_PART_BYTES` | Multipart part-size cap. Default is safe and can be increased as needed. | Production + Preview |
| `R2_ACCOUNT_ID` | Cloudflare account ID for the R2 S3 API endpoint | Production + Preview |
| `R2_ACCESS_KEY_ID` | R2 API token access key ID for presigning | Production + Preview |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret for presigning | Production + Preview |
| `R2_BUCKET_NAME` | Bucket name, for example `zavu-uploads` | Production + Preview |
| `CLEANUP_API_TOKEN` | Random secret for `/api/cleanup-expired` | Production + Preview |
| `STRIPE_SECRET_KEY` | Stripe secret API key | Production + Preview |
| `STRIPE_MONTHLY_PRICE_ID` | Stripe monthly subscription price ID | Production + Preview |
| `STRIPE_YEARLY_PRICE_ID` | Stripe yearly subscription price ID | Production + Preview |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | Production + Preview |
| `FIREBASE_SERVICE_ACCOUNT_KEY` | Firebase service account JSON for custom-claim updates | Production + Preview |

Generate a signing secret:
```bash
openssl rand -hex 32
```

The R2 bucket binding (`ZAVU_BUCKET`) is configured in `wrangler.toml` and picked up automatically.

### R2 Bucket CORS
Because upload parts go directly from the browser to R2, configure bucket CORS to allow your app origins and expose the `ETag` header.

At minimum, allow:
- `PUT`
- `GET`
- `HEAD`

And expose:
- `ETag`

An example policy is included in [r2-cors.example.json](/Users/jacobbryant/Documents/zavu2/zavu2/zavu-vite/r2-cors.example.json).
Replace the placeholder origins with your actual custom domain and Pages domain.

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
| `functions/api/upload.ts` | `POST /api/upload` — authenticated multipart upload session creation |
| `functions/api/upload/sign-part.ts` | `POST /api/upload/sign-part` — authenticated presigned URL generation for multipart part upload |
| `functions/api/upload/complete.ts` | `POST /api/upload/complete` — finalize multipart upload + get download URL |
| `functions/api/upload/abort.ts` | `POST /api/upload/abort` — abort failed multipart uploads |
| `functions/api/download/[id].ts` | `GET /api/download/:id` — signed file download from R2 |
| `functions/api/delete.ts` | `POST /api/delete` — authenticated owner delete for uploaded files |
| `functions/api/cleanup-expired.ts` | `POST /api/cleanup-expired` — token-protected batch cleanup endpoint |
| `functions/api/checkout.ts` | `POST /api/checkout` — authenticated Stripe Checkout session creation |
| `functions/api/billing-portal.ts` | `POST /api/billing-portal` — authenticated Stripe billing portal session creation |
| `functions/api/webhook.ts` | `POST /api/webhook` — Stripe webhook verification + Firebase Pro claim updates |
| `src/cloud-storage.ts` | Frontend client — calls `/api/upload` with Firebase JWT |
| `wrangler.toml` | R2 bucket binding configuration |

## Security

- ✅ R2 credentials never leave the server
- ✅ Firebase JWT verified on every upload
- ✅ Pro status checked server-side via JWT custom claims
- ✅ Multipart uploads support very large files
- ✅ Encrypted upload bytes go directly to R2
- ✅ Per-part and total cloud upload limits enforced server-side
- ✅ Download URLs are HMAC-signed with constant-time comparison
- ✅ Download links auto-expire after 7 days
- ✅ Files can be deleted by the owner via authenticated API
- ✅ Expired files can be cleaned via R2 lifecycle rules or `/api/cleanup-expired`

## Cleanup

Automatic deletion should still be handled by an R2 lifecycle rule.
`/api/cleanup-expired` exists as a backup path for scheduled maintenance from an external scheduler because Pages Functions do not provide native cron triggers.

Example cleanup call:
```bash
curl -X POST \
  -H "X-Cleanup-Token: $CLEANUP_API_TOKEN" \
  "https://your-domain.example/api/cleanup-expired?limit=250"
```

## Stripe Checklist

1. Create one monthly recurring price and one yearly recurring price in Stripe.
2. Add `STRIPE_SECRET_KEY`, `STRIPE_MONTHLY_PRICE_ID`, `STRIPE_YEARLY_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, and `FIREBASE_SERVICE_ACCOUNT_KEY` to Cloudflare Pages environment variables.
3. Configure a Stripe webhook endpoint at `https://your-domain.example/api/webhook`.
4. Subscribe the webhook to `checkout.session.completed`, `customer.subscription.updated`, and `customer.subscription.deleted`.
5. Run a Stripe test checkout and confirm the Firebase user receives the `pro` custom claim.
6. Sign in as that same user and verify `Manage Billing` opens a Stripe billing portal session.

## Cost Estimate

| Usage | Storage | Egress | Workers | Total/month |
|-------|---------|--------|---------|-------------|
| 10 GB, 50 downloads | ~$0.15 | $0 (free) | $0 (free tier) | ~$0.15 |
| 100 GB, 500 downloads | ~$1.50 | $0 (free) | $0 (free tier) | ~$1.50 |
| 1 TB, 5K downloads | ~$15.00 | $0 (free) | ~$2.50 | ~$17.50 |

*R2 egress through Workers is completely free. Worker invocations: 100K/day free.*
