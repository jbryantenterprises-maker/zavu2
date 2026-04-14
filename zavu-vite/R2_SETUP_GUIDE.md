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
VITE_FIREBASE_API_KEY=AIzaSyA-IyYzeScsO25IXf9kxJcyUxGKWWRIuqs
VITE_FIREBASE_AUTH_DOMAIN=xavu-58a12.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=xavu-58a12
VITE_FIREBASE_STORAGE_BUCKET=xavu-58a12.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=980279924297
VITE_FIREBASE_APP_ID=1:980279924297:web:418c0f20861c0d9d4cd198
VITE_LEMON_SQUEEZY_API_KEY=eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiI5NGQ1OWNlZi1kYmI4LTRlYTUtYjE3OC1kMjU0MGZjZDY5MTkiLCJqdGkiOiI3ODhkYzIxM2QzODgyYjExMzk5ZjBmYzAzMjk4MzQyZDljNmQwMmVmZGVmNTljMjhmYjFmYjlmNGVmNThkZGJmYjZhYjQwMGVjMDg1OTVkYiIsImlhdCI6MTc3NjE4MTc5Ny42NTkxNCwibmJmIjoxNzc2MTgxNzk3LjY1OTE0MiwiZXhwIjoxNzkxOTM2MDAwLjAyOTkwNywic3ViIjoiNjgwNTgwMCIsInNjb3BlcyI6W119.u1xEFxKAlHc7FaOSPjxyZmM92eV8oBIX6Z372X0p2GT_pYPtbuXKheeiQ22KmyjaJ6xfdDY7dQu3FeWQ-rK-mGEfa7M77v42uoMuFvob-fVWt3_Q8QNtOvTgWz1XgAiaGpCabSUpmlBmmwEX3zJ7SI26AIfLx6OLyeMo2tqNKiTfdEjZf9qyshtxgmh1TGLxZyoHFVka7jNiBHADKcOI5bTuLhi1GRpu0M-cw5biz9h97W4-18L4uw-hkcK0juA1ixbNk2FbH5IdJQ_qKRL2nJ9ZFqwgZMrMN70ZkORvG56p1UHjh9xc0UY3W5n4QeQIP6224Twcn9tQI0nDdJlsrOipKvscsM-pyL4XOyU5IZ-AvTs97rrSsKCTQnTUDSzJnRQuDakcrXjRnVSRkEc4agB1cW9jQXawd4K8a9DWZ3ONlCY2wpKfxgEnEANyf28b5_yNx-VBZQuNX9V502K5AWGgSJm6ktJ5JPnGn2Jr8UVZ8EMQ-lMwtYxL2meH7zqbEe_daP0wm1sFkukRNegR8R4wOrW2QpKpU2PJILqIlOsilGvLU-sZycKSJ0GpqhyOvYckvl2DdH62mV35Zpq7YiLcpA_jZU-g67gVvG1DOhfkNFyePqpeFcTvIMm2GkCBtAIGKstFn9DtutAabSkujJPjJIhsgkXLB45woNomveI
VITE_LEMON_SQUEEZY_STORE_ID=331412
VITE_LEMON_SQUEEZY_PRO_VARIANT_ID=974258
ALLOWED_ORIGINS=https://xavu.app,https://www.xavu.app
```

### Secret Variables (server-side):
```
FIREBASE_PROJECT_ID=xavu-58a12
DOWNLOAD_SIGNING_SECRET=9d1f85d8e8bdddabd7528135bfa580aba7c3c01a038f9b0b9aecd312c5b53c0a
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
