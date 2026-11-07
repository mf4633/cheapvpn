// CheapVPN background service worker: keeps chrome.proxy in sync with stored state
// and checks the user's Pro status with ExtensionPay.
importScripts("config.js", "ExtPay.js");

const extpay = ExtPay(APP_CONFIG.extpayId);
extpay.startBackground();
// ExtPay's docs say to recreate the instance inside service worker callbacks.
const pay = () => ExtPay(APP_CONFIG.extpayId);

const DEFAULTS = {
  enabled: false,
  servers: [],
  activeId: null,
  bypass: ["localhost", "127.0.0.1", "<local>"],
  routing: "all", // "all" | "rules" (Pro)
  rules: [], // [{ id, pattern, serverId }]
  pro: false, // cached ExtensionPay paid status
};

async function getState() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}

function proxyToken(s) {
  const hp = `${s.host}:${Number(s.port)}`;
  return { socks5: `SOCKS5 ${hp}`, socks4: `SOCKS ${hp}`, http: `PROXY ${hp}`, https: `HTTPS ${hp}` }[s.scheme];
}

// Builds a PAC script: hosts that match a rule go through that rule's server,
// everything else connects directly. A pattern without "*" also matches subdomains.
// probe: optional { host, token } that forces the health-check host through one server.
// fallback: what unmatched hosts return ("DIRECT" in rules mode).
function buildPac(rules, servers, probe = null, fallback = "DIRECT") {
  const entries = [];
  if (probe) entries.push(["=" + probe.host, probe.token]);
  for (const r of rules) {
    const s = servers.find((x) => x.id === r.serverId);
    if (s) entries.push([r.pattern.trim().toLowerCase(), proxyToken(s)]);
  }
  return `var RULES = ${JSON.stringify(entries)};
function FindProxyForURL(url, host) {
  host = host.toLowerCase();
  for (var i = 0; i < RULES.length; i++) {
    var p = RULES[i][0];
    var hit = p.charAt(0) === "=" ? host === p.slice(1)
      : p.indexOf("*") >= 0
      ? shExpMatch(host, p) || (p.indexOf("*.") === 0 && host === p.slice(2))
      : host === p || host.slice(-(p.length + 1)) === "." + p;
    if (hit) return RULES[i][1];
  }
  return ${JSON.stringify(fallback)};
}`;
}

function effectiveRouting(state) {
  return state.routing === "rules" && state.pro ? "rules" : "all";
}

// Server being health-checked right now (null when idle).
let probe = null;

// Serialize proxy updates so a storage-triggered update can't land on top of a probe.
let applyChain = Promise.resolve();
function apply() {
  applyChain = applyChain.then(applyNow, applyNow);
  return applyChain;
}

async function applyNow() {
  const state = await getState();
  const routing = effectiveRouting(state);
  const server = state.servers.find((s) => s.id === state.activeId);

  if (probe) {
    // During a check, only the probe host goes through the server under test.
    // Everything else keeps its current route (fail closed: in all-sites mode
    // other traffic still goes through the active server, never direct).
    const fallback = state.enabled && routing === "all" && server ? proxyToken(server) : "DIRECT";
    const rules = state.enabled && routing === "rules" ? state.rules : [];
    await chrome.proxy.settings.set({
      scope: "regular",
      value: { mode: "pac_script", pacScript: { data: buildPac(rules, state.servers, probe, fallback) } },
    });
  } else if (state.enabled && routing === "rules") {
    await chrome.proxy.settings.set({
      scope: "regular",
      value: { mode: "pac_script", pacScript: { data: buildPac(state.rules, state.servers) } },
    });
    setBadge(true);
  } else if (state.enabled && server) {
    await chrome.proxy.settings.set({
      scope: "regular",
      value: {
        mode: "fixed_servers",
        rules: {
          singleProxy: { scheme: server.scheme, host: server.host, port: Number(server.port) },
          bypassList: state.bypass,
        },
      },
    });
    setBadge(true);
  } else {
    await chrome.proxy.settings.clear({ scope: "regular" });
    setBadge(false);
  }
}

function setBadge(on) {
  chrome.action.setBadgeText({ text: on ? "ON" : "" });
  if (on) chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
}

async function refreshPro() {
  try {
    const user = await pay().getUser();
    await chrome.storage.local.set({ pro: !!user.paid });
  } catch (e) {
    // Offline or ExtensionPay unreachable: keep the cached status.
    console.warn("Could not check Pro status:", e);
  }
}

// ---- Server health & speed check (Pro) ----

async function timedFetch(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const res = await fetch(url, { cache: "no-store", signal: ctrl.signal, credentials: "omit" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const body = await res.arrayBuffer();
    return { ms: performance.now() - t0, bytes: body.byteLength, body };
  } finally {
    clearTimeout(timer);
  }
}

async function checkServer(server) {
  const base = APP_CONFIG.probeBase.replace(/\/$/, "");
  probe = { host: new URL(base).hostname.toLowerCase(), token: proxyToken(server) };
  await apply();
  // Let Chrome pick up the new PAC script before probing.
  await new Promise((r) => setTimeout(r, 150));
  const result = { testedAt: Date.now() };
  try {
    // First request includes connecting to the proxy (and TLS); counts as "connect".
    result.connectMs = Math.round((await timedFetch(`${base}/__down?bytes=0&r=${Math.random()}`, 10000)).ms);
    const pings = [];
    for (let i = 0; i < 3; i++) pings.push((await timedFetch(`${base}/__down?bytes=0&r=${Math.random()}`, 8000)).ms);
    pings.sort((a, b) => a - b);
    result.latencyMs = Math.round(pings[1]);
    try {
      const { ms, bytes } = await timedFetch(`${base}/__down?bytes=${APP_CONFIG.speedTestBytes}&r=${Math.random()}`, 20000);
      result.mbps = Math.round(((bytes * 8) / (ms / 1000) / 1e6) * 10) / 10;
    } catch {
      result.mbps = null; // too slow to finish in time; latency is still valid
    }
    try {
      const { body } = await timedFetch(`${base}/meta?r=${Math.random()}`, 8000);
      const meta = JSON.parse(new TextDecoder().decode(body));
      result.ip = meta.clientIp || null;
      result.country = meta.country || null;
    } catch {
      result.ip = result.country = null; // exit info is optional
    }
    result.status = result.latencyMs > 800 ? "slow" : "ok";
  } catch (e) {
    result.status = "down";
    result.error = e.name === "AbortError" ? "Timed out" : "Can't connect";
  } finally {
    probe = null;
  }
  return result;
}

let checking = false;
async function checkServers(ids) {
  if (checking) return { busy: true };
  const state = await getState();
  if (!state.pro) return { needsPro: true };
  checking = true;
  try {
    await chrome.storage.local.set({ checking: true });
    for (const id of ids) {
      const server = state.servers.find((s) => s.id === id);
      if (!server) continue;
      const result = await checkServer(server);
      const { health = {} } = await chrome.storage.local.get("health");
      health[id] = result;
      await chrome.storage.local.set({ health });
    }
  } finally {
    probe = null;
    checking = false;
    await chrome.storage.local.set({ checking: false });
    await apply();
  }
  return { ok: true };
}

extpay.onPaid.addListener(() => chrome.storage.local.set({ pro: true }));

// Supply username/password when a proxy asks (HTTP/HTTPS proxies only;
// Chrome does not support SOCKS authentication). Matches the server that asked,
// so it works with per-site rules that use several servers.
chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    if (!details.isProxy) return callback({});
    getState().then((state) => {
      const c = details.challenger || {};
      const s =
        state.servers.find((x) => x.host === c.host && Number(x.port) === c.port) ||
        state.servers.find((x) => x.id === state.activeId);
      if ((state.enabled || probe) && s && s.username) {
        callback({ authCredentials: { username: s.username, password: s.password || "" } });
      } else {
        callback({});
      }
    });
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"]
);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "checkServers") {
    checkServers(msg.ids).then(sendResponse);
    return true;
  }
  if (msg?.type === "refreshPro") {
    refreshPro().then(() => sendResponse({ ok: true }));
    return true;
  }
});

chrome.proxy.onProxyError.addListener((err) => console.warn("Proxy error:", err));
chrome.storage.onChanged.addListener(apply);
chrome.runtime.onStartup.addListener(() => { chrome.storage.local.set({ checking: false }); apply(); refreshPro(); });
chrome.runtime.onInstalled.addListener(() => { apply(); refreshPro(); });
