// CheapVPN configuration.
// extpayId: the extension ID you register at https://extensionpay.com
// proPrice: shown in the popup only. The real price is whatever you set in the ExtensionPay dashboard.
const APP_CONFIG = {
  extpayId: "cheapvpn",
  proPrice: "$2.99",
  // Server health/speed check endpoints (Cloudflare's public speed test).
  // /__down?bytes=N returns N bytes; /meta returns the exit IP and country.
  probeBase: "https://speed.cloudflare.com",
  speedTestBytes: 2_000_000,
};
