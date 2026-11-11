/**
 * Ledgerbay build identity. Capacitor appId / Android applicationId / iOS bundle
 * must stay in sync with APP_ID below (also set in capacitor.config.json).
 * Variants: "dev" (tests + demo), "store" (empty first run), "personal" (auto-seed if empty).
 */
window.LEDGERBAY_BUILD = Object.freeze({
  APP_ID: "in.ledgerbay.app",
  APP_NAME: "Ledgerbay",
  VERSION: "1.13.22",
  VERSION_CODE: 175,
  VARIANT: "store", // overwritten per packaged build: store | personal | dev
  SW_CACHE: "ledgerbay-v21-22"
});
