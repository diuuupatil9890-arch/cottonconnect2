const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const main = $("#main");

const CATS = ["Raw Cotton", "Processed Cotton", "Cotton Bales", "Others"];
const COLORS = ["#1f7ae0", "#25a85a", "#f39a3d", "#7b57e0"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATES = ["Maharashtra", "Gujarat", "Telangana", "Andhra Pradesh", "Karnataka", "Madhya Pradesh", "Rajasthan", "Punjab", "Haryana", "Tamil Nadu", "Odisha", "Other"];
const NAV = [["dashboard", "🏠", "Dashboard"], ["suppliers", "🏭", "Suppliers"], ["customers", "👥", "Customers"], ["purchases", "🛒", "Purchase"],
             ["sales", "🧾", "Sales"], ["stock", "📦", "Stock"], ["reports", "📊", "Reports"], ["settings", "⚙️", "Settings"]];
const state = { user: null, view: "dashboard" };

const inr = n => "₹ " + Math.round(n).toLocaleString("en-IN");
const num = n => Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const dmy = iso => iso.split("-").reverse().join("-");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

// ---------- helpers ----------
async function api(url, opt = {}) {
  try {
    const res = await fetch(url, {
      method: opt.method || "GET", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: opt.body ? JSON.stringify(opt.body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, data };
  } catch { return { ok: false, status: 0, data: {} }; }
}
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}
function field(n, label, o = {}) {
  const id = o.id || n;
  const ctl = o.opts
    ? `<select id="${id}" name="${n}">${o.opts.map(x => Array.isArray(x) ? `<option value="${x[0]}">${esc(x[1])}</option>` : `<option${x === o.v ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>`
    : `<input id="${id}" name="${n}" type="${o.t || "text"}" ${o.a || ""} value="${esc(o.v ?? "")}">`;
  return `<div class="f ${o.full ? "full" : ""}"><label for="${id}">${label}${o.opt ? " <i>(optional)</i>" : ""}</label>${ctl}<small></small></div>`;
}
const collect = f => Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, String(v).trim()]));
function clearErrs(f) {
  $$(".f.bad", f).forEach(b => { b.classList.remove("bad"); $("small", b).textContent = ""; });
  $(".form-err", f).textContent = "";
}
function showErrs(f, errs) {
  Object.entries(errs).forEach(([k, m]) => {
    const box = f.elements[k]?.closest(".f");
    if (box) { box.classList.add("bad"); $("small", box).textContent = m; }
  });
  $(".form-err", f).textContent = "Some fields need attention. They are marked in red.";
  const first = $(".f.bad input, .f.bad select", f);
  first?.scrollIntoView({ behavior: "smooth", block: "center" });
  first?.focus({ preventScroll: true });
}
// One pipeline for every form: pre-check, POST, show field errors or continue
function wire(f, url, onOk, pre) {
  f.addEventListener("input", e => {
    const b = e.target.closest(".f");
    if (b) { b.classList.remove("bad"); $("small", b).textContent = ""; }
    $(".form-err", f).textContent = "";
  });
  f.addEventListener("submit", async ev => {
    ev.preventDefault();
    clearErrs(f);
    const d = collect(f), pe = pre ? pre(d) : {};
    if (Object.keys(pe).length) return showErrs(f, pe);
    const btn = $(".go", f), label = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Please wait...";
    const r = await api(url, { method: "POST", body: d });
    btn.disabled = false;
    btn.textContent = label;
    if (r.ok) return onOk(r.data, d);
    if (r.data.errors) return showErrs(f, r.data.errors);
    $(".form-err", f).textContent = r.status ? `The server returned an error (${r.status}). Check the terminal running app.py.` : "Could not reach the server. Check that app.py is running.";
  });
}

// ---------- auth screen ----------
$("#state").innerHTML = `<option value="">Select state</option>` + STATES.map(s => `<option>${s}</option>`).join("");
$$(".tabs button").forEach(b => b.addEventListener("click", () => {
  const reg = b.dataset.tab === "reg";
  $$(".tabs button").forEach(x => x.setAttribute("aria-selected", x === b));
  $("#reg").hidden = !reg;
  $("#login").hidden = reg;
}));
$$(".peek").forEach(b => b.addEventListener("click", () => {
  const i = b.parentElement.querySelector("input"), show = i.type === "password";
  i.type = show ? "text" : "password";
  b.textContent = show ? "Hide" : "Show";
}));
$("#mobile").addEventListener("input", e => (e.target.value = e.target.value.replace(/\D/g, "")));
$("#gstin").addEventListener("input", e => (e.target.value = e.target.value.toUpperCase()));
$("#password").addEventListener("input", e => {
  const v = e.target.value;
  const score = (v.length >= 8) + (/[A-Z]/.test(v) && /[a-z]/.test(v)) + /\d/.test(v) + (/[^A-Za-z0-9]/.test(v) || v.length >= 12);
  const bar = $(".meter span");
  bar.style.width = (v ? score * 25 : 0) + "%";
  bar.style.background = ["#c62828", "#c62828", "#f39a3d", "#25a85a", "#25a85a"][score];
});
wire($("#reg"), "/api/register", d => enter(d.user, "Account created. Welcome to CottonConnect."),
  d => (d.terms ? {} : { terms: "Accept the terms to continue." }));
wire($("#login"), "/api/login", d => enter(d.user, `Welcome back, ${d.user.full_name}.`),
  d => ({ ...(d.identifier ? {} : { identifier: "Enter your mobile number or email." }), ...(d.password ? {} : { password: "Enter your password." }) }));

// ---------- app shell ----------
function enter(u, msg) {
  state.user = u;
  $("#auth").hidden = true;
  $("#app").hidden = false;
  $("#uName").textContent = u.full_name;
  $("#avatar").textContent = u.full_name.trim()[0].toUpperCase();
  $("#nav").innerHTML = NAV.map(([v, i, l]) => `<button type="button" data-go="${v}"><span aria-hidden="true">${i}</span>${l}</button>`).join("")
    + `<div class="tag">Better Cotton<br>Better Tomorrow</div>`;
  go("dashboard");
  if (msg) toast(msg);
}
async function go(v, focusForm) {
  state.view = v;
  $$("#nav button").forEach(b => (b.dataset.go === v ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  $(".um").removeAttribute("open");
  main.innerHTML = `<p class="muted">Loading...</p>`;
  await VIEWS[v]();
  window.scrollTo(0, 0);
  if (focusForm) $("form input, form select", main)?.focus();
}
function tick() {
  const n = new Date();
  $("#clkDate").textContent = n.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  $("#clkTime").textContent = n.toLocaleDateString("en-US", { weekday: "long" }) + ", " + n.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}
setInterval(tick, 30000);
tick();

// Global click handling for navigation, delete, demo data, logout, CSV, print
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-go],[data-del],#demo,#logout,#csv,#print");
  if (!t) return;
  if (t.dataset.go) return go(t.dataset.go, t.dataset.focus === "1");
  if (t.id === "logout") { await api("/api/logout", { method: "POST" }); return location.reload(); }
  if (t.id === "print") return window.print();
  if (t.id === "csv") return downloadCsv();
  if (t.id === "demo") {
    const r = await api("/api/demo", { method: "POST" });
    toast(r.ok ? "Sample data added." : r.data.error || "Could not add sample data.");
    return go(state.view);
  }
  if (t.dataset.del) {
    if (!confirm("Delete this record?")) return;
    const r = await api(`/api/e/${t.dataset.ent}/${t.dataset.id}`, { method: "DELETE" });
    toast(r.ok ? "Deleted." : r.data.error || "Could not delete.");
    return go(state.view);
  }
});

// ---------- charts ----------
function lineChart(p, s, n) {
  const W = 640, H = 250, L = 62, R = 14, T = 14, B = 30, pw = W - L - R, ph = H - T - B;
  const pv = p.slice(0, n), sv = s.slice(0, n);
  const mx = Math.max(1, ...pv, ...sv), mag = 10 ** Math.floor(Math.log10(mx)), step = mag / 2;
  const max = Math.ceil(mx / step) * step;
  const x = i => L + (n === 1 ? pw / 2 : i * pw / (n - 1)), y = v => T + ph - v / max * ph;
  const grid = [0, 1, 2, 3, 4].map(i => {
    const v = max * i / 4;
    return `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e6ecf5"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v).toLocaleString("en-IN")}</text>`;
  }).join("");
  const labels = pv.map((_, i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${MON[i]}</text>`).join("");
  const line = (a, c, name) => `<polyline fill="none" stroke="${c}" stroke-width="2.5" points="${a.map((v, i) => x(i) + "," + y(v)).join(" ")}"/>`
    + a.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="#fff" stroke="${c}" stroke-width="2.5"><title>${name}, ${MON[i]}: ${inr(v)}</title></circle>`).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly purchases and sales in rupees">${grid}${labels}${line(pv, "#1f7ae0", "Purchase")}${line(sv, "#25a85a", "Sales")}</svg>`;
}
function donut(st) {
  const tot = st.reduce((t, c) => t + c.available, 0), R = 62, C = 2 * Math.PI * R;
  let off = 0;
  const segs = st.map((c, i) => {
    const len = tot ? c.available / tot * C : 0;
    const el = `<circle r="${R}" cx="90" cy="90" fill="none" stroke="${COLORS[i]}" stroke-width="26" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"><title>${c.category}: ${num(c.available)} kg</title></circle>`;
    off += len;
    return el;
  }).join("");
  return `<div class="donut"><svg viewBox="0 0 180 180" role="img" aria-label="Stock distribution by cotton type"><circle r="${R}" cx="90" cy="90" fill="none" stroke="#e6ecf5" stroke-width="26"/>${segs}
    <text x="90" y="88" text-anchor="middle" style="font:700 15px var(--font);fill:#13233f">${num(tot)} kg</text><text x="90" y="106" text-anchor="middle">Total Stock</text></svg>
    <ul>${st.map((c, i) => `<li><span><i class="dot" style="background:${COLORS[i]}"></i>${c.category}</span><b>${tot ? Math.round(c.available / tot * 100) : 0}%</b></li>`).join("")}</ul></div>`;
}

// ---------- tables ----------
const pad = (p, id) => `${p}-${String(id).padStart(3, "0")}`;
function txTable(items, pre, who, del, ent) {
  if (!items.length) return `<p class="empty">Nothing recorded yet.</p>`;
  return `<div class="tw"><table><thead><tr><th>ID</th><th>${who}</th><th>Date</th>${del ? "<th>Type</th>" : ""}<th class="r">Quantity (kg)</th><th class="r">Rate (₹/kg)</th><th class="r">Total Amount (₹)</th>${del ? "<th></th>" : ""}</tr></thead><tbody>`
    + items.map(r => `<tr><td>${pad(pre, r.id)}</td><td>${esc(r.party)}</td><td>${dmy(r.date)}</td>${del ? `<td>${esc(r.category)}</td>` : ""}<td class="r">${num(r.qty_kg)}</td><td class="r">${r.rate.toFixed(2)}</td><td class="r">${num(r.total)}</td>${del ? `<td class="r"><button class="del" data-del="1" data-ent="${ent}" data-id="${r.id}">Delete</button></td>` : ""}</tr>`).join("")
    + `</tbody></table></div>`;
}

// ---------- views ----------
const VIEWS = {
  async dashboard() {
    const r = await api("/api/summary");
    if (r.status === 401) return location.reload();
    const d = r.data;
    const empty = !d.suppliers && !d.customers && !d.recent_purchases.length && !d.recent_sales.length;
    const chg = p => (p == null ? "" : `<em class="${p < 0 ? "dn" : "up"}">${p < 0 ? "↓" : "↑"} ${Math.abs(p)}%</em>`);
    const card = (c, ico, label, val, sub, extra = "") => `<div class="stat ${c}"><span class="ico" aria-hidden="true">${ico}</span><div><small>${label}</small><b>${val}</b><p>${sub}${extra}</p></div></div>`;
    main.innerHTML = `<div class="dgrid"><div>
      <section class="banner">
        <h2>Welcome to CottonConnect</h2><p>Manage your cotton business efficiently</p>
        ${empty ? `<button class="mini" id="demo" type="button">Load sample data</button>` : ""}
        <svg class="bolls" viewBox="0 0 340 120" aria-hidden="true"><use href="#boll" x="140" y="10" width="70" height="70"/><use href="#boll" x="200" y="36" width="90" height="90"/><use href="#boll" x="270" y="8" width="64" height="64"/><use href="#boll" x="60" y="60" width="56" height="56"/></svg>
        <div class="field"></div>
      </section>
      <div class="stats4">
        ${card("c1", "🛒", "Total Purchases", inr(d.purchases_month), "This Month", chg(d.purchases_pct))}
        ${card("c2", "💰", "Total Sales", inr(d.sales_month), "This Month", chg(d.sales_pct))}
        ${card("c3", "📦", "Total Stock", num(d.stock_kg) + " kg", "Available")}
        ${card("c4", "👥", "Total Suppliers", d.suppliers, "Active")}
      </div>
      <div class="charts">
        <div class="card"><h3>Purchase &amp; Sales Overview</h3><div class="legend"><span><i class="dot" style="background:#1f7ae0"></i>Purchase</span><span><i class="dot" style="background:#25a85a"></i>Sales</span></div>${lineChart(d.monthly_purchases, d.monthly_sales, d.month)}</div>
        <div class="card"><h3>Stock Distribution</h3>${donut(d.stock)}</div>
      </div></div>
      <aside class="card quick"><h3>Quick Actions</h3>
        <button class="qa b" data-go="suppliers" data-focus="1">Add Supplier</button>
        <button class="qa g" data-go="customers" data-focus="1">Add Customer</button>
        <button class="qa p" data-go="purchases" data-focus="1">New Purchase</button>
        <button class="qa o" data-go="sales" data-focus="1">New Sale</button>
        <button class="qa s" data-go="reports">View Reports</button></aside></div>
      <div class="tables">
        <div class="card"><div class="head"><h3>Recent Purchases</h3><button class="link" data-go="purchases">View All</button></div>${txTable(d.recent_purchases, "P", "Supplier")}</div>
        <div class="card"><div class="head"><h3>Recent Sales</h3><button class="link" data-go="sales">View All</button></div>${txTable(d.recent_sales, "S", "Customer")}</div>
      </div>`;
  },

  suppliers: () => partyView("suppliers", "Suppliers", "supplier"),
  customers: () => partyView("customers", "Customers", "customer"),
  purchases: () => txnView("purchases"),
  sales: () => txnView("sales"),

  async stock() {
    const d = (await api("/api/summary")).data;
    const max = Math.max(1, ...d.stock.map(c => c.purchased));
    main.innerHTML = `<h2 class="ptitle">Stock</h2><div class="card"><div class="tw"><table>
      <thead><tr><th>Cotton type</th><th class="r">Purchased (kg)</th><th class="r">Sold (kg)</th><th class="r">Available (kg)</th><th>Level</th></tr></thead><tbody>
      ${d.stock.map((c, i) => `<tr><td><i class="dot" style="background:${COLORS[i]}"></i>${c.category}</td><td class="r">${num(c.purchased)}</td><td class="r">${num(c.sold)}</td><td class="r"><b>${num(c.available)}</b></td><td><div class="bar"><span style="width:${c.available / max * 100}%;background:${COLORS[i]}"></span></div></td></tr>`).join("")}
      </tbody><tfoot><tr><td>Total</td><td class="r">${num(d.stock.reduce((t, c) => t + c.purchased, 0))}</td><td class="r">${num(d.stock.reduce((t, c) => t + c.sold, 0))}</td><td class="r">${num(d.stock_kg)}</td><td></td></tr></tfoot></table></div></div>`;
  },

  async reports() {
    const d = (await api("/api/summary")).data;
    state.report = d;
    let tp = 0, ts = 0;
    const body = MON.slice(0, d.month).map((m, i) => {
      const p = d.monthly_purchases[i], s = d.monthly_sales[i], pl = s - p;
      tp += p; ts += s;
      return `<tr><td>${m} ${d.year}</td><td class="r">${num(p)}</td><td class="r">${num(s)}</td><td class="r ${pl < 0 ? "neg" : "pos"}">${pl < 0 ? "-" : ""}${num(Math.abs(pl))}</td></tr>`;
    }).join("");
    main.innerHTML = `<h2 class="ptitle">Reports</h2><div class="actions" style="margin-bottom:14px"><button class="btn" id="csv" type="button">Download CSV</button><button class="btn alt" id="print" type="button">Print</button></div>
      <div class="card"><h3>Monthly profit and loss, ${d.year} (₹)</h3><div class="tw"><table><thead><tr><th>Month</th><th class="r">Purchases</th><th class="r">Sales</th><th class="r">Profit / Loss</th></tr></thead><tbody>${body}</tbody>
      <tfoot><tr><td>Total</td><td class="r">${num(tp)}</td><td class="r">${num(ts)}</td><td class="r ${ts - tp < 0 ? "neg" : "pos"}">${ts - tp < 0 ? "-" : ""}${num(Math.abs(ts - tp))}</td></tr></tfoot></table></div></div>`;
  },

  async settings() {
    const u = (await api("/api/me")).data.user;
    main.innerHTML = `<h2 class="ptitle">Settings</h2><div class="split">
      <form class="card" id="pf" novalidate><h3>Business profile</h3>
        ${field("full_name", "Full name", { id: "s_full_name", v: u.full_name })}${field("business_name", "Business name", { id: "s_business", v: u.business_name })}${field("city", "City", { id: "s_city", v: u.city })}${field("state", "State", { id: "s_state", opts: STATES, v: u.state })}
        <button class="go" type="submit">Save profile</button><p class="form-err" role="alert"></p></form>
      <div><form class="card" id="pw" novalidate><h3>Change password</h3>
        ${field("current", "Current password", { t: "password" })}${field("new", "New password", { t: "password" })}
        <button class="go" type="submit">Update password</button><p class="form-err" role="alert"></p></form>
      <div class="card" style="margin-top:16px"><h3>Sample data</h3><p class="muted" style="margin-bottom:12px">Fill an empty account with example suppliers, customers, purchases and sales.</p><button class="btn" id="demo" type="button">Load sample data</button></div></div></div>`;
    wire($("#pf"), "/api/profile", () => { toast("Profile saved."); $("#uName").textContent = $("#s_full_name").value.trim(); });
    wire($("#pw"), "/api/password", () => { toast("Password updated."); $("#pw").reset(); });
  },
};

async function partyView(ent, label, one) {
  const items = (await api(`/api/e/${ent}`)).data.items || [];
  main.innerHTML = `<h2 class="ptitle">${label}</h2><div class="split">
    <form class="card" id="pf" novalidate><h3>Add ${one}</h3>
      ${field("name", "Name")}${field("phone", "Phone", { opt: 1, a: 'inputmode="numeric" maxlength="10"' })}${field("city", "City", { id: "p_city", opt: 1 })}
      <button class="go" type="submit">Add ${one}</button><p class="form-err" role="alert"></p></form>
    <div class="card"><h3>All ${label.toLowerCase()} (${items.length})</h3>${items.length ? `<div class="tw"><table><thead><tr><th>Name</th><th>Phone</th><th>City</th><th></th></tr></thead><tbody>
      ${items.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.phone || "")}</td><td>${esc(i.city || "")}</td><td class="r"><button class="del" data-del="1" data-ent="${ent}" data-id="${i.id}">Delete</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="empty">No ${label.toLowerCase()} yet. Add the first one using the form.</p>`}</div></div>`;
  $("#phone").addEventListener("input", e => (e.target.value = e.target.value.replace(/\D/g, "")));
  wire($("#pf"), `/api/e/${ent}`, () => { toast(`${one[0].toUpperCase() + one.slice(1)} added.`); go(ent); });
}

async function txnView(ent) {
  const c = { purchases: { t: "Purchase", party: "suppliers", who: "Supplier", pre: "P" }, sales: { t: "Sale", party: "customers", who: "Customer", pre: "S" } }[ent];
  const [parties, items] = (await Promise.all([api(`/api/e/${c.party}`), api(`/api/e/${ent}`)])).map(r => r.data.items || []);
  main.innerHTML = `<h2 class="ptitle">${c.t === "Sale" ? "Sales" : "Purchase"}</h2><div class="split">
    <form class="card" id="tf" novalidate><h3>New ${c.t.toLowerCase()}</h3>
      ${parties.length ? field("party_id", c.who, { opts: [["", `Select ${c.who.toLowerCase()}`], ...parties.map(p => [p.id, p.name])] })
        : `<p class="muted" style="margin-bottom:12px">Add a ${c.who.toLowerCase()} first.</p><button type="button" class="btn alt" style="margin-bottom:12px" data-go="${c.party}" data-focus="1">Add ${c.who.toLowerCase()}</button>`}
      ${field("date", "Date", { t: "date", v: today() })}${field("category", "Cotton type", { opts: CATS })}
      ${field("qty_kg", "Quantity (kg)", { t: "number", a: 'min="0" step="any"' })}${field("rate", "Rate (₹ per kg)", { t: "number", a: 'min="0" step="any"' })}
      <p class="tot">Total: <span id="tot">₹ 0</span></p>
      <button class="go" type="submit"${parties.length ? "" : " disabled"}>Save ${c.t.toLowerCase()}</button><p class="form-err" role="alert"></p></form>
    <div class="card"><h3>All ${c.t === "Sale" ? "sales" : "purchases"} (${items.length})</h3>${txTable(items, c.pre, c.who, true, ent)}</div></div>`;
  const f = $("#tf"), upd = () => ($("#tot").textContent = inr((+f.qty_kg.value || 0) * (+f.rate.value || 0)));
  f.qty_kg.addEventListener("input", upd);
  f.rate.addEventListener("input", upd);
  wire(f, `/api/e/${ent}`, () => { toast(`${c.t} saved.`); go(ent); });
}

function downloadCsv() {
  const d = state.report;
  const lines = [["Month", "Purchases", "Sales", "Profit/Loss"]];
  MON.slice(0, d.month).forEach((m, i) => lines.push([`${m} ${d.year}`, Math.round(d.monthly_purchases[i]), Math.round(d.monthly_sales[i]), Math.round(d.monthly_sales[i] - d.monthly_purchases[i])]));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.map(l => l.join(",")).join("\n")], { type: "text/csv" }));
  a.download = `cottonconnect-report-${d.year}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- start ----------
api("/api/me").then(r => { if (r.ok) enter(r.data.user); });
