import { lemonSqueezySetup } from '@lemonsqueezy/lemonsqueezy.js';
import { AuthService } from './auth';

export class PaymentService {
  static init() {
    // Basic init of Lemon Squeezy integration
    lemonSqueezySetup({
      apiKey: import.meta.env.VITE_LEMON_SQUEEZY_API_KEY || '',
      onError: (error) => console.error("Lemon Squeezy error: ", error)   
    });
  }

  static async upgradeToPro() {
    const user = AuthService.getUser();
    if (!user) {
      alert("Please sign in first to upgrade to Pro.");
      return;
    }

    const storeId = import.meta.env.VITE_LEMON_SQUEEZY_STORE_ID;
    const variantId = import.meta.env.VITE_LEMON_SQUEEZY_PRO_VARIANT_ID;

    
    // In a real application, consider creating the checkout server-side or 
    // relying on the LemonSqueezy's frontend script for generic overlays
    // We pass the user's UID to `checkoutData.custom.user_id` so the webhook knows who paid.
    
    try {
      /* 
       * Note: createCheckout typically requires a server-side API call unless you use 
       * a direct product link with the LemonSqueezy.js snippet logic. 
       * Assuming you have a checkout link: https://your-store.lemonsqueezy.com/checkout/buy/VARIANT_ID
       */
      
      const checkoutUrl = `https://${storeId}.lemonsqueezy.com/checkout/buy/${variantId}?checkout[custom][user_id]=${user.uid}`;
      
      // Lemon.js overlay opens the link. For this to work, Lemon.js must be in the DOM.
      // E.g., <script src="https://app.lemonsqueezy.com/js/lemon.js" defer></script>
      if (window.LemonSqueezy) {
        window.LemonSqueezy.Url.Open(checkoutUrl);
      } else {
        window.open(checkoutUrl, '_blank');
      }

      // For testing exclusively - mocking upgrade (DEV only):
      if (import.meta.env.DEV && storeId === "YOUR_STORE_ID") {
         console.warn("MOCKING PRO UPGRADE (dev only)!");
         localStorage.setItem(`zavu_pro_${user.uid}`, "true");
         alert("Mock Pro Upgrade Successful! Please refresh.");
         window.location.reload();
      }

    } catch (e) {
      console.error("Failed to trigger checkout", e);
    }
  }
}

// Add LemonSqueezy types mapping into window
declare global {
  interface Window {
    LemonSqueezy: any;
  }
}
