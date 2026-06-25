import { AuthService } from './auth';
import { Logger } from './logger';

type PaymentResult = { success: true } | { success: false; error: string };

export class PaymentService {
  private static checkoutInProgress = false;
  private static billingPortalInProgress = false;

  static async openBillingPortal(): Promise<PaymentResult> {
    if (this.billingPortalInProgress) {
      return { success: false, error: 'Billing portal is already opening.' };
    }

    const user = AuthService.getUser();
    if (!user) {
      return { success: false, error: 'Please sign in first to manage billing.' };
    }

    this.billingPortalInProgress = true;
    try {
      const idToken = await AuthService.getIdToken();
      if (!idToken) {
        this.billingPortalInProgress = false;
        return { success: false, error: 'Please sign in again to continue.' };
      }

      const response = await fetch('/api/billing-portal', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
        },
      });

      const result = await response.json() as { success: boolean; url?: string; error?: string };
      if (!response.ok || !result.success || !result.url) {
        this.billingPortalInProgress = false;
        throw new Error(result.error || `Billing portal failed (HTTP ${response.status})`);
      }

      window.location.assign(result.url);
      // Note: Flag will remain true since we're navigating away, but reset it for safety
      setTimeout(() => { this.billingPortalInProgress = false; }, 1000);
      return { success: true };
    } catch (e) {
      Logger.error("Failed to open billing portal", e);
      const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';
      this.billingPortalInProgress = false;
      return { success: false, error: `Unable to open billing portal right now. ${errorMessage}` };
    }
  }

  static async upgradeToPro(plan: 'monthly' | 'yearly' = 'monthly'): Promise<PaymentResult> {
    if (this.checkoutInProgress) {
      return { success: false, error: 'Checkout is already starting.' };
    }

    const user = AuthService.getUser();
    if (!user) {
      return { success: false, error: 'Please sign in first to upgrade to Pro.' };
    }

    this.checkoutInProgress = true;
    try {
      const idToken = await AuthService.getIdToken();
      if (!idToken) {
        this.checkoutInProgress = false;
        return { success: false, error: 'Please sign in again to continue.' };
      }

      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ plan }),
      });
      
      const result = await response.json() as { success: boolean; checkoutUrl?: string; error?: string };
      
      if (!response.ok || !result.success || !result.checkoutUrl) {
        const errorMsg = result.error || `Checkout failed (HTTP ${response.status})`;
        Logger.error('Checkout API error', errorMsg, result);
        this.checkoutInProgress = false;
        throw new Error(errorMsg);
      }

      window.location.assign(result.checkoutUrl);
      // Note: Flag will remain true since we're navigating away, but reset it for safety
      setTimeout(() => { this.checkoutInProgress = false; }, 1000);
      return { success: true };
    } catch (e) {
      Logger.error("Failed to trigger checkout", e);
      const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';
      this.checkoutInProgress = false;
      return { success: false, error: `Unable to start checkout right now. ${errorMessage}` };
    }
  }
}
