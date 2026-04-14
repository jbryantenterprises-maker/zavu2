import { AuthService } from './auth';

export class PaymentService {
  static init() {
    // Checkout is created server-side in Pages Functions.
  }

  static async upgradeToPro(plan: 'monthly' | 'yearly' = 'monthly') {
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
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plan }),
      });

      console.log('Checkout request sent:', { plan, status: response.status });
      
      const result = await response.json() as { success: boolean; checkoutUrl?: string; error?: string };
      console.log('Checkout response:', result);
      
      if (!response.ok || !result.success || !result.checkoutUrl) {
        const errorMsg = result.error || `Checkout failed (HTTP ${response.status})`;
        console.error('Checkout API error:', errorMsg, result);
        throw new Error(errorMsg);
      }

      window.open(result.checkoutUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      console.error("Failed to trigger checkout", e);
      const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';
      console.error('Checkout error details:', errorMessage);
      alert(`Unable to start checkout right now. ${errorMessage}`);
    }
  }
}
