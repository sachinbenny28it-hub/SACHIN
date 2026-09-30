/** RevenueCat Web Billing using the official @revenuecat/purchases-js SDK. */
window.SachinBilling = (() => {
  let purchases = null;
  let initPromise = null;

  async function init(appUserId) {
    if (purchases) return purchases;
    if (initPromise) return initPromise;
    initPromise = (async () => {
      let config;
      try {
        const response = await fetch('/api/config');
        config = await response.json();
      } catch {
        return null;
      }

      const apiKey = config.revenueCatWebBillingKey;
      const sdk = window.Purchases;
      const PurchasesClass = sdk?.Purchases || sdk;
      if (!apiKey || !PurchasesClass || typeof PurchasesClass.configure !== 'function') return null;

      try {
        purchases = PurchasesClass.configure({ apiKey, appUserId });
        return purchases;
      } catch (error) {
        console.error('[SACHIN Billing] RevenueCat could not initialize.', error);
        return null;
      }
    })();
    return initPromise;
  }

  function setPaywallStatus(message) {
    const status = document.getElementById('paywallStatus');
    if (status) status.textContent = message;
  }

  async function presentPaywall() {
    if (!purchases) {
      alert('SACHIN Pro checkout is not configured for this deployment yet. Add a RevenueCat Web Billing public key and configure a SACHIN Pro offering to enable purchases.');
      return;
    }

    const root = document.getElementById('paywallRoot');
    root.innerHTML = `
      <div class="paywall-scrim">
        <section class="paywall-panel" role="dialog" aria-modal="true" aria-labelledby="paywallTitle">
          <button class="paywall-close" id="paywallClose" aria-label="Close paywall">×</button>
          <h2 id="paywallTitle">SACHIN Pro</h2>
          <p>More room for the things you choose to share, richer personalization, and more voice time.</p>
          <div id="paywallContainer"></div>
          <p id="paywallStatus" class="paywall-status" aria-live="polite"></p>
        </section>
      </div>`;
    root.classList.remove('hidden');
    document.getElementById('paywallClose').onclick = closePaywall;

    try {
      const offerings = await purchases.getOfferings();
      if (!offerings.current || !offerings.current.availablePackages.length) {
        setPaywallStatus('There is no active SACHIN Pro offering yet. Finish the products and offering setup in RevenueCat, then try again.');
        return;
      }
      const result = await purchases.presentPaywall({
        htmlTarget: document.getElementById('paywallContainer'),
        offering: offerings.current
      });
      const entitlement = result?.customerInfo?.entitlements?.active?.sachin_pro;
      if (entitlement) {
        setPaywallStatus('Purchase received. SACHIN is waiting for RevenueCat to confirm your Pro entitlement.');
        await window.SACHINRefreshAccount?.();
      }
    } catch (error) {
      console.error('[SACHIN Billing] RevenueCat checkout error.', error);
      setPaywallStatus('I couldn’t load the checkout right now. Your account has not been charged. Please try again in a little while.');
    }
  }

  function closePaywall() {
    const root = document.getElementById('paywallRoot');
    root?.classList.add('hidden');
    if (root) root.replaceChildren();
  }

  async function isPro() {
    if (!purchases) return false;
    try {
      const info = await purchases.getCustomerInfo();
      return !!info.entitlements.active.sachin_pro;
    } catch {
      return false;
    }
  }

  return { init, presentPaywall, isPro, closePaywall };
})();
