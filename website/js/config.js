/* Chartolj! website – runtime configuration (NO secrets here; this file is public).
   Everything business-critical (prices, subscription state) must come from the backend. */
window.CT_CONFIG = {
  // Existing Chartolj! application (the uploaded index.html, unchanged, served from /app/)
  appUrl: 'app/index.html',

  // Public contact address shown on the contact page. Leave '' until the company address is approved.
  contactEmail: '',

  // Pricing is NOT hardcoded. Either set the numbers below after management approval,
  // or point pricingEndpoint to a backend that returns {"monthly":number,"yearly":number,"currency":"HUF"}.
  // While values are null the Premium page shows "pricing coming soon" instead of inventing prices.
  pricing: { monthly: null, yearly: null, currency: 'HUF' },
  pricingEndpoint: '',

  // Market data providers actually used by the site (all public, key-less endpoints).
  // Crypto: Binance public market-data API. FX: Frankfurter (ECB reference rates, daily, NOT real time).
  // Everything else is shown as clearly marked DEMO until a licensed provider is integrated server-side.
  providers: {
    crypto: 'https://api.binance.com/api/v3',
    fx: 'https://api.frankfurter.app'
  }
};
