import { AuthService } from './auth';

export class PaymentService {
  static init() {
    // Checkout is created server-side in Pages Functions.
  }

  static async upgradeToPro() {
    const user = AuthService.getUser();
    if (!user) {
      alert("Please sign in first to upgrade to Pro.");
      return;
    }

    try {
      const idToken = await AuthService.getIdToken();
      if (!idToken) {
        alert("Please sign in again to continue.");
        return;
      }

      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
        },
      });

      const result = await response.json() as { success: boolean; checkoutUrl?: string; error?: string };
      if (!response.ok || !result.success || !result.checkoutUrl) {
        throw new Error(result.error || `Checkout failed (HTTP ${response.status})`);
      }

      window.open(result.checkoutUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      console.error("Failed to trigger checkout", e);
      alert("Unable to start checkout right now.");
    }
  }
}
