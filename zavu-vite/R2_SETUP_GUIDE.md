# R2 Setup Guide for Xavu

## Overview
This guide explains how to set up Cloudflare R2 for Xavu's permanent file storage feature.

## Prerequisites
- Cloudflare account with R2 enabled
- Xavu Pages project deployed
- Custom domain (xavu.app) configured

## Step 1: Create R2 Bucket
1. Go to Cloudflare Dashboard > R2 Object Storage
2. Click "Create bucket"
3. **Bucket name:** `zavu-uploads`
4. Choose nearest region
5. Click "Create bucket"

## Step 2: Configure CORS
1. Go to your R2 bucket > Settings > CORS
2. Copy and paste the contents of `r2-cors-policy.json`
3. Click "Save"

## Step 3: Set Up R2 Binding in Pages
1. Go to Pages project > Settings > Environment variables
2. Add **R2 binding**:
   - **Variable name:** `ZAVU_BUCKET`
   - **Binding type:** R2 Bucket
   - **Bucket name:** `zavu-uploads`

## Step 4: Environment Variables
Add these to your Pages environment variables:

### Text Variables (client-side):
```
VITE_FIREBASE_API_KEY=your-firebase-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your-messaging-sender-id
VITE_FIREBASE_APP_ID=your-firebase-app-id
ALLOWED_ORIGINS=https://xavu.app,https://www.xavu.app
```

### Secret Variables (server-side):
```
FIREBASE_PROJECT_ID=your-project-id
DOWNLOAD_SIGNING_SECRET=generate-a-random-secret
STRIPE_SECRET_KEY=sk_live_or_test_...
STRIPE_MONTHLY_PRICE_ID=price_...
STRIPE_YEARLY_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
```

## Step 5: Deploy
1. Trigger a new deployment from the Cloudflare dashboard
2. Or push a small change to GitHub

## Verification
After deployment, test:
- Firebase authentication works
- Pro users can upload files
- 7-day permanent download links work
- Direct browser-to-R2 uploads function

## Files Reference
- `r2-cors-policy.json` - CORS configuration for R2 bucket
- `wrangler.toml` - R2 binding configuration
- `functions/api/upload/` - Upload API endpoints
- `CLOUD_STORAGE_GUIDE.md` - Technical implementation details

## Troubleshooting
- **CORS errors:** Double-check the CORS policy format
- **R2 binding errors:** Ensure bucket name matches `wrangler.toml`
- **Auth issues:** Verify all environment variables are set correctly
- **Upload failures:** Check browser console for specific error messages
