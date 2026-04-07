# Cloud Storage Integration for Zavu

## Overview
This implementation adds a cloud storage fallback when P2P WebRTC connections fail, providing a cost-effective alternative to TURN servers.

## Cost Comparison

### TURN Server (Current Trystero fallback)
- **Cost**: $0.10-0.50 per GB relayed
- **Use case**: Real-time relay when P2P blocked
- **Pros**: Immediate transfer, no storage
- **Cons**: Ongoing bandwidth costs

### Cloud Storage Fallback (New implementation)
- **Storage**: $0.02-0.05 per GB/month
- **Egress**: $0.05-0.15 per GB (one-time)
- **Use case**: Upload when P2P fails, download anytime
- **Pros**: Potentially cheaper, files available 24/7
- **Cons**: Not real-time, requires cleanup

## Implementation Details

### Architecture
1. **Primary**: WebRTC P2P via Trystero
2. **Fallback**: Cloud storage upload after 10-second timeout
3. **Cleanup**: Automatic file deletion after 24 hours

### Supported Providers
- **Supabase** (recommended for simplicity)
- **AWS S3** (with presigned URLs)
- **Google Cloud Storage**
- **Azure Blob Storage**

### Configuration
```typescript
const cloudConfig: CloudStorageConfig = {
  provider: 'supabase',
  bucketName: 'your-bucket-name',
  region: 'us-east-1',
  apiKey: 'your-api-key' // if needed
};
```

## Cost Analysis Examples

### 100MB File Transfer
- **TURN**: ~$0.01-0.05
- **Cloud Storage**: ~$0.005-0.015

### 1GB File Transfer (10 users)
- **TURN**: ~$1.00-5.00 (relayed each time)
- **Cloud Storage**: ~$0.05-0.15 (one upload, multiple downloads)

### Heavy Usage (100GB/month)
- **TURN**: ~$10-50/month
- **Cloud Storage**: ~$2-7/month + storage costs

## Setup Instructions

### Supabase (Recommended)
1. Create Supabase project
2. Enable Storage API
3. Create bucket for file uploads
4. Add RLS policies for uploads
5. Configure API keys

### AWS S3
1. Create S3 bucket
2. Set up CORS policy
3. Create IAM user with upload permissions
4. Implement presigned URL endpoint

## Usage Flow

1. User selects files
2. App attempts P2P connection
3. If no connection after 10 seconds:
   - Upload files to cloud storage
   - Generate download link
   - Update UI with cloud link
4. Files automatically cleaned up after 24 hours

## Benefits

✅ **Cost Effective**: Cheaper than TURN for most use cases
✅ **Reliable**: Files always accessible via direct link
✅ **No Infrastructure**: Managed cloud services
✅ **Automatic Cleanup**: Prevents storage bloat
✅ **User Friendly**: Clear fallback indication

## Trade-offs

❌ **Not Real-time**: Upload takes time vs instant relay
❌ **Storage Required**: Temporary files need management
❌ **Complexity**: Additional integration work

## Recommendation

**Use cloud storage fallback if:**
- You transfer files larger than 50MB
- You have multiple recipients per file
- You want predictable costs
- Real-time transfer isn't critical

**Keep TURN if:**
- You need instant transfer
- Files are small (<10MB)
- You have minimal usage
- Real-time is essential
