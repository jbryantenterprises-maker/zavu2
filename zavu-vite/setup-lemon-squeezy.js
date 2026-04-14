#!/usr/bin/env node

/**
 * Lemon Squeezy Setup Script for Xavu
 * 
 * The Lemon Squeezy API doesn't support creating products/variants programmatically.
 * This script fetches your existing products and outputs their IDs for your .env file.
 * 
 * Usage:
 * 1. Create product "Xavu Pro" manually at https://app.lemonsqueezy.com/products
 * 2. Add variants (Monthly $9, Yearly $89) in the dashboard
 * 3. Get your API key from https://app.lemonsqueezy.com/settings/api
 * 4. Run: node setup-lemon-squeezy.js YOUR_API_KEY
 * 5. Copy the output IDs to your .env file
 */

const API_KEY = process.argv[2];

if (!API_KEY) {
  console.error('Error: Please provide your Lemon Squeezy API key');
  console.error('Usage: node setup-lemon-squeezy.js YOUR_API_KEY');
  process.exit(1);
}

const API_BASE = 'https://api.lemonsqueezy.com/v1';

// Helper function to make API requests
async function apiRequest(endpoint, method = 'GET', body = null) {
  const headers = {
    'Accept': 'application/vnd.api+json',
    'Content-Type': 'application/vnd.api+json',
    'Authorization': `Bearer ${API_KEY}`,
  };

  const options = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE}${endpoint}`, options);
  const data = await response.json();

  if (!response.ok) {
    console.error(`API Error (${response.status}):`, data);
    throw new Error(data.errors?.[0]?.detail || 'API request failed');
  }

  return data;
}

async function getStoreId() {
  console.log('Fetching your store information...');
  const response = await apiRequest('/stores');
  
  if (!response.data || response.data.length === 0) {
    throw new Error('No stores found. Please create a store in Lemon Squeezy first.');
  }

  const store = response.data[0];
  console.log(`✓ Found store: ${store.attributes.name} (ID: ${store.id})\n`);
  return store.id;
}

async function listProducts() {
  console.log('Fetching your products...');
  const response = await apiRequest('/products');
  
  if (!response.data || response.data.length === 0) {
    console.log('No products found.\n');
    return [];
  }

  console.log('\n📦 Your Products:\n');
  for (const product of response.data) {
    console.log(`  ${product.id}: ${product.attributes.name}`);
    
    // Fetch variants for this product
    const variantsResponse = await apiRequest(`/variants?filter[product_id]=${product.id}`);
    if (variantsResponse.data && variantsResponse.data.length > 0) {
      for (const variant of variantsResponse.data) {
        const price = variant.attributes.price / 100;
        const interval = variant.attributes.interval;
        console.log(`    └── ${variant.id}: ${variant.attributes.name} - $${price}${interval ? `/${interval}` : ''}`);
      }
    }
  }
  
  return response.data;
}

function printInstructions() {
  console.log('\n' + '='.repeat(60));
  console.log('📋 MANUAL SETUP REQUIRED');
  console.log('='.repeat(60));
  console.log('\nThe Lemon Squeezy API does not support creating products programmatically.');
  console.log('\nPlease complete these steps manually:\n');
  console.log('1. Go to https://app.lemonsqueezy.com/products');
  console.log('2. Click "Create Product"');
  console.log('3. Fill in:');
  console.log('   - Name: "Xavu Pro"');
  console.log('   - Description: Secure encrypted cloud storage with unlimited files');
  console.log('4. Create variants:');
  console.log('   - Monthly: $9.00 / month');
  console.log('   - Yearly: $89.00 / year (saves 18%)');
  console.log('5. Save the product');
  console.log('\n6. Run this script again to get the Product ID and Variant ID');
  console.log('\n7. Add to your .env file:');
  console.log('   VITE_LEMON_SQUEEZY_STORE_ID="[from above]"');
  console.log('   VITE_LEMON_SQUEEZY_PRO_VARIANT_ID="[variant-id]"');
  console.log('   VITE_LEMON_SQUEEZY_API_KEY="your-api-key"');
}

function printWebhookInstructions() {
  console.log('\n⚠️  WEBHOOK SETUP REQUIRED');
  console.log('\nFor Pro status to work, you need to set up webhooks:');
  console.log('1. Go to https://app.lemonsqueezy.com/settings/webhooks');
  console.log('2. Create a new webhook with URL: https://your-domain.com/api/webhook');
  console.log('3. Subscribe to: order_created, subscription_updated, subscription_cancelled');
  console.log('4. Copy the webhook signing secret to your Cloudflare Functions env vars');
  console.log('\nNote: You\'ll need to create a webhook handler in functions/api/webhook.ts');
}

async function main() {
  console.log('🍋 Lemon Squeezy Setup for Xavu Pro\n');
  console.log('API Key:', API_KEY.substring(0, 8) + '...\n');

  try {
    // Get store ID
    const storeId = await getStoreId();

    // List existing products
    const products = await listProducts();

    if (products.length === 0) {
      printInstructions();
    } else {
      console.log('\n' + '='.repeat(60));
      console.log('✅ Copy these to your .env file:');
      console.log('='.repeat(60));
      console.log(`\nVITE_LEMON_SQUEEZY_STORE_ID="${storeId}"`);
      console.log('VITE_LEMON_SQUEEZY_API_KEY="' + API_KEY + '"');
      console.log('\n# Use one of the variant IDs above for:');
      console.log('VITE_LEMON_SQUEEZY_PRO_VARIANT_ID="[variant-id-from-above]"');
      
      printWebhookInstructions();
    }

    console.log('\n🎉 Ready to start selling Xavu Pro!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
