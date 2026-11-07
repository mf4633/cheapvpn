const $ = (id) => document.getElementById(id);
const DEFAULTS = {
  enabled: false, servers: [], activeId: null, bypass: ["localhost", "127.0.0.1", "<local>"],
  routing: "all", rules: [], pro: false, health: {}, checking: false,
};
let showUpsell = false;

async function load() {
  return { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
}
const set = (obj) => chrome.storage.local.set(obj);

async function render() {
  const s = await load();
  const rulesMode = s.pro && s.routing === "rules";

  // Servers
  const sel = $("serverSelect");
  sel.innerHTML = "";
  if (!s.servers.length) sel.add(new Option("No servers - add one below", ""));
  for (const srv of s.servers) {
    sel.add(new Option(`${srv.name} (${srv.scheme}://${srv.host}:${srv.port})`, srv.id, false, srv.id === s.activeId));
  }
  $("serverHeading").textContent = rulesMode ? "Servers" : "Server";

  // Routing mode + Pro
  $("proBadge").hidden = !s.pro;
  document.querySelectorAll(".seg button").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === (rulesMode ? "rules" : "all")));
  $("upsell").hidden = s.pro || !showUpsell;
  document.querySelector("#upsell .price").textContent = APP_CONFIG.proPrice;
  $("rulesPanel").hidden = !rulesMode;
  $("bypassDetails").hidden = rulesMode;

  // Rules
  const list = $("rulesList");
  list.innerHTML = "";
  if (!s.rules.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No rules yet - add a site below";
    list.append(li);
  }
  for (const r of s.rules) {
    const srv = s.servers.find((x) => x.id === r.serverId);
    const li = document.createElement("li");
    const pat = Object.assign(document.createElement("span"), { className: "pat", textContent: r.pattern });
    const via = Object.assign(document.createElement("span"), { className: "via", textContent: "via " + (srv ? srv.name : "?") });
    const del = Object.assign(document.createElement("button"), { textContent: "×", title: "Remove rule" });
    del.onclick = async () => { await set({ rules: (await load()).rules.filter((x) => x.id !== r.id) }); render(); };
    li.append(pat, via, del);
    list.append(li);
  }
  const rs = $("ruleServer");
  rs.innerHTML = "";
  for (const srv of s.servers) rs.add(new Option(srv.name, srv.id));

  // Health
  const hl = $("healthList");
  hl.innerHTML = "";
  if (!s.servers.length) {
    hl.append(Object.assign(document.createElement("li"), { className: "empty", textContent: "Add a server to test it" }));
  }
  for (const srv of s.servers) {
    const h = s.health[srv.id];
    const li = document.createElement("li");
    if (srv.id === s.activeId) li.className = "active";
    const testing = s.checking && testingIds.includes(srv.id) && (!h || h.testedAt < testStartedAt);
    const dot = Object.assign(document.createElement("span"), { className: "dot " + (testing ? "testing" : h?.status || "") });
    const name = Object.assign(document.createElement("span"), { className: "hname", textContent: srv.name, title: srv.name });
    const metric = Object.assign(document.createElement("span"), { className: "metric" });
    const sub = Object.assign(document.createElement("span"), { className: "sub" });
    if (testing) {
      metric.textContent = "Testing...";
    } else if (!h) {
      metric.textContent = "Not tested";
    } else if (h.status === "down") {
      metric.textContent = "Down";
      sub.textContent = h.error + " · " + ago(h.testedAt);
      sub.className = "sub err";
    } else {
      metric.textContent = `${h.latencyMs} ms` + (h.mbps != null ? ` · ${h.mbps} Mbps` : "");
      sub.textContent = [h.country && flag(h.country) + " " + h.country, h.ip, ago(h.testedAt)].filter(Boolean).join(" · ");
    }
    li.append(dot, name, metric);
    if (sub.textContent) li.append(sub);
    hl.append(li);
  }
  $("testAllBtn").disabled = s.checking || !s.servers.length;
  $("testAllBtn").textContent = s.checking ? "Testing..." : "Test all";
  $("fastestBtn").disabled = s.checking || !fastest(s);

  // Toggle + status
  const canEnable = rulesMode ? s.servers.length > 0 : !!s.activeId;
  $("toggle").checked = s.enabled;
  $("toggle").disabled = !s.servers.length;
  const active = s.servers.find((x) => x.id === s.activeId);
  let status = "Disconnected", on = false;
  if (s.enabled && rulesMode) {
    on = true;
    status = s.rules.length ? `On for ${s.rules.length} site rule${s.rules.length > 1 ? "s" : ""}` : "On, but no site rules yet";
  } else if (s.enabled && active && canEnable) {
    on = true;
    status = `Connected via ${active.name}`;
  }
  $("status").textContent = status;
  $("status").className = "status" + (on ? " on" : "");
}

let testingIds = [];
let testStartedAt = 0;

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
function flag(cc) {
  return /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "";
}
// Fastest healthy server: lowest latency, ties broken by higher speed.
function fastest(s) {
  return s.servers
    .map((srv) => ({ srv, h: s.health[srv.id] }))
    .filter(({ h }) => h && h.status !== "down")
    .sort((a, b) => a.h.latencyMs - b.h.latencyMs || (b.h.mbps || 0) - (a.h.mbps || 0))[0]?.srv || null;
}

$("testAllBtn").addEventListener("click", async () => {
  const s = await load();
  if (!s.pro) { showUpsell = true; return render(); }
  testingIds = s.servers.map((x) => x.id);
  testStartedAt = Date.now();
  chrome.runtime.sendMessage({ type: "checkServers", ids: testingIds }).then(render).catch(() => {});
  render();
});

$("fastestBtn").addEventListener("click", async () => {
  const s = await load();
  if (!s.pro) { showUpsell = true; return render(); }
  const f = fastest(s);
  if (f) await set({ activeId: f.id });
  render();
});

document.querySelectorAll(".seg button").forEach((b) =>
  b.addEventListener("click", async () => {
    const s = await load();
    if (b.dataset.mode === "rules" && !s.pro) {
      showUpsell = true;
    } else {
      showUpsell = false;
      await set({ routing: b.dataset.mode });
    }
    render();
  }));

$("buyBtn").addEventListener("click", async () => {
  try { await ExtPay(APP_CONFIG.extpayId).openPaymentPage(); }
  catch { $("payMsg").textContent = "Couldn't open the payment page. Check your connection."; }
});
$("restoreBtn").addEventListener("click", async () => {
  try { await ExtPay(APP_CONFIG.extpayId).openLoginPage(); }
  catch { $("payMsg").textContent = "Couldn't open the login page. Check your connection."; }
});

$("toggle").addEventListener("change", async (e) => {
  const s = await load();
  const activeId = s.activeId || s.servers[0]?.id || null;
  await set({ enabled: e.target.checked && !!activeId, activeId });
  render();
});

$("serverSelect").addEventListener("change", async (e) => {
  await set({ activeId: e.target.value || null });
  render();
});

$("deleteBtn").addEventListener("click", async () => {
  const s = await load();
  const id = $("serverSelect").value;
  const servers = s.servers.filter((x) => x.id !== id);
  const activeId = s.activeId === id ? servers[0]?.id || null : s.activeId;
  const rules = s.rules.filter((r) => r.serverId !== id);
  const health = { ...s.health };
  delete health[id];
  await set({ servers, activeId, rules, health, enabled: s.enabled && !!activeId });
  render();
});

$("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const s = await load();
  const srv = {
    id: crypto.randomUUID(),
    name: $("name").value.trim(),
    scheme: $("scheme").value,
    host: $("host").value.trim(),
    port: Number($("port").value),
    username: $("username").value.trim(),
    password: $("password").value,
  };
  await set({ servers: [...s.servers, srv], activeId: s.activeId || srv.id });
  e.target.reset();
  render();
});

$("ruleForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const s = await load();
  const pattern = $("rulePattern").value.trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, "").replace(/[/:].*$/, ""); // accept pasted URLs
  if (!pattern || !$("ruleServer").value) return;
  await set({ rules: [...s.rules, { id: crypto.randomUUID(), pattern, serverId: $("ruleServer").value }] });
  $("rulePattern").value = "";
  render();
});

$("saveBypass").addEventListener("click", async () => {
  const bypass = $("bypass").value.split("\n").map((l) => l.trim()).filter(Boolean);
  await set({ bypass });
  render();
});

$("checkIp").addEventListener("click", async () => {
  $("ip").textContent = "Checking...";
  try {
    const r = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
    $("ip").textContent = "Your IP: " + (await r.json()).ip;
  } catch {
    $("ip").textContent = "Couldn't reach the IP service (is the proxy working?)";
  }
});

// Fill the bypass box once (not on every render, so edits aren't overwritten).
load().then((s) => { $("bypass").value = s.bypass.join("\n"); });
chrome.storage.onChanged.addListener(render);
chrome.runtime.sendMessage({ type: "refreshPro" }).catch(() => {});
render();
