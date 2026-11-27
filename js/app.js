import * as store from "./store.js";
import { buildIndex, search, highlight } from "./search.js";
import { esc, rupee, inr, calcLine, calcQuote, lineGst, seriesLabel, productLabel, sizeOf, todayISO, fmtDate, fileBase, download, amountInWords } from "./common.js";
import { buildXlsx } from "./xlsx-export.js";
import { buildPdf } from "./pdf-export.js";
import { parsePriceList, diffPriceList, applyPriceList } from "./pricelist.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

let settings = store.getSettings();
let q = null;           // the quotation being edited
let selIdx = 0;         // highlighted search result
let lastResults = [];

// ================================================================ helpers

function toast(msg, err = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (err ? " err" : "");
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, err ? 5000 : 2200);
}

function newQuote() {
  settings = store.getSettings();
  return {
    id: "q" + Date.now(),
    number: settings.prefix + String(settings.nextNo).padStart(4, "0"),
    numbered: false,
    date: todayISO(),
    maker: settings.maker || "company",
    makerInfo: [...(settings.makerInfo?.[settings.maker || "company"] || ["", "", "", ""])],
    customer: "", mobile: "", address: "",
    type: "Retail",
    discount: 0,
    items: [],
    created: new Date().toISOString(),
  };
}

function itemFromProduct(p) {
  return {
    pid: p.id, code: p.code, series: seriesLabel(p), label: productLabel(p), size: sizeOf(p),
    mrp: p.mrp, qty: 1, disc: Number(q.discount) || 0, custom: false,
    image: p.image || "", collection: p.collection,
  };
}

function persist() {
  q.updated = new Date().toISOString();
  store.saveDraft(q);
  $("#saveState").textContent = "";
}

// ================================================================ tabs

$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  $$("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
  window.scrollTo({ top: 0, behavior: "instant" });
  if (b.dataset.tab === "saved") renderSaved();
  if (b.dataset.tab === "prices") renderPriceTab();
  if (b.dataset.tab === "settings") renderSettings();
});

// ================================================================ quotation form

function bindForm() {
  const fields = { fCustomer: "customer", fMobile: "mobile", fAddress: "address", fDate: "date", fNumber: "number" };
  for (const [id, key] of Object.entries(fields)) {
    $("#" + id).addEventListener("input", (e) => { q[key] = e.target.value; persist(); });
  }
  // "made by" details: kept on the quotation and remembered (per role) for the next one
  [1, 2, 3, 4].forEach((n) => $("#fBy" + n).addEventListener("input", (e) => {
    q.makerInfo[n - 1] = e.target.value;
    const s = store.getSettings();
    store.setSettings({ maker: q.maker, makerInfo: { ...s.makerInfo, [q.maker]: [...q.makerInfo] } });
    persist();
  }));
  $("#makerChoices").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-maker]");
    if (!b || b.dataset.maker === q.maker) return;
    q.maker = b.dataset.maker;
    const s = store.setSettings({ maker: q.maker });
    q.makerInfo = [...(s.makerInfo?.[q.maker] || ["", "", "", ""])];
    renderMaker();
    persist();
  });
  $("#typeChoices").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-type]");
    if (!b) return;
    q.type = b.dataset.type;
    renderType();
    persist();
  });
  $("#fDiscount").addEventListener("input", (e) => {
    const d = Math.min(100, Math.max(0, Number(e.target.value) || 0));
    q.discount = d;
    for (const it of q.items) if (!it.custom) it.disc = d;
    renderItems();
    persist();
  });
  $("#btnNew").addEventListener("click", () => {
    if (q.items.length && !confirm("Start a new quotation? Unsaved changes to the current one will be lost.")) return;
    q = newQuote();
    loadIntoForm();
    persist();
    $("#fCustomer").focus();
  });
}

function renderType() {
  $$("#typeChoices .type").forEach((b) => b.classList.toggle("active", b.dataset.type === q.type));
}

const MAKER_HINTS = {
  company: ["e.g. Mr. K. C. Patel", "e.g. Sales Manager", "e.g. 98250 12345", "e.g. name@kerovit.com"],
  dealer: ["e.g. Shree Sanitary Mart", "e.g. Shop 12, Ring Road, Surat", "e.g. Mr. Amit Shah", "e.g. 98250 12345"],
};

function renderMaker() {
  if (q.maker !== "dealer") q.maker = "company";
  if (!Array.isArray(q.makerInfo)) q.makerInfo = ["", "", "", ""];
  $$("#makerChoices .type").forEach((b) => b.classList.toggle("active", b.dataset.maker === q.maker));
  store.MAKER_FIELDS[q.maker].forEach((lbl, i) => {
    $("#lblBy" + (i + 1)).textContent = lbl;
    $("#fBy" + (i + 1)).value = q.makerInfo[i] || "";
    $("#fBy" + (i + 1)).placeholder = MAKER_HINTS[q.maker][i];
  });
}

// lines added before sizes were printed: take the size from the price list once it is loaded
function fillSizes() {
  const list = store.getProducts() || [];
  if (!list.length) return;
  for (const it of q.items) {
    if (it.size !== undefined || !it.pid) continue;
    const p = list.find((x) => x.id === it.pid);
    if (p) it.size = sizeOf(p);
  }
}

function loadIntoForm() {
  fillSizes();
  $("#fCustomer").value = q.customer || "";
  $("#fMobile").value = q.mobile || "";
  $("#fAddress").value = q.address || "";
  renderMaker();
  $("#fDate").value = q.date || todayISO();
  $("#fNumber").value = q.number || "";
  $("#fDiscount").value = q.discount || 0;
  renderType();
  renderItems();
}

// ================================================================ search

const searchBox = $("#search");
const resultsEl = $("#results");

function renderResults() {
  const val = searchBox.value;
  lastResults = search(val, 40);
  selIdx = 0;
  if (!val.trim()) { resultsEl.hidden = true; return; }
  if (!lastResults.length) {
    resultsEl.innerHTML = `<div class="res-none">No product found for “${esc(val)}”. Try the code or other words.</div>`;
    resultsEl.hidden = false;
    return;
  }
  resultsEl.innerHTML = lastResults.map((p, i) => `
    <div class="res${i === 0 ? " sel" : ""}" data-i="${i}">
      <img loading="lazy" src="${esc(store.imageURLSync(p))}" alt="" onerror="this.style.visibility='hidden'">
      <div>
        <div class="code">${highlight(p.code, val)}${p.alt_codes && p.alt_codes.length ? ` <span class="meta">/ ${esc(p.alt_codes.join(" / "))}</span>` : ""}</div>
        <div class="name">${p.kind === "set" ? `<span class="set-tag">SET</span>` : ""}${highlight(productLabel(p), val)}</div>
        <div class="meta">${esc(seriesLabel(p))}${p.flag ? ` · <span class="flag">⚠ ${esc(p.flag)}</span>` : ""}</div>
      </div>
      <div class="price">${rupee(p.mrp, 0)}</div>
    </div>`).join("");
  resultsEl.hidden = false;
}

function moveSel(d) {
  const els = $$(".res", resultsEl);
  if (!els.length) return;
  selIdx = (selIdx + d + els.length) % els.length;
  els.forEach((e, i) => e.classList.toggle("sel", i === selIdx));
  els[selIdx].scrollIntoView({ block: "nearest" });
}

function addProduct(p) {
  const existing = q.items.find((it) => it.pid === p.id);
  flashIndex = existing ? q.items.indexOf(existing) : q.items.length;
  if (existing) {
    existing.qty = (Number(existing.qty) || 0) + 1;
    toast(`${p.code}: quantity is now ${existing.qty}`);
  } else {
    q.items.push(itemFromProduct(p));
    toast(`Added ${p.code}`);
  }
  searchBox.value = "";
  resultsEl.hidden = true;
  renderItems();
  persist();
  searchBox.focus();
}

searchBox.addEventListener("input", renderResults);
searchBox.addEventListener("focus", () => { if (searchBox.value.trim()) renderResults(); });
searchBox.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); moveSel(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moveSel(-1); }
  else if (e.key === "Enter") { e.preventDefault(); if (lastResults[selIdx]) addProduct(lastResults[selIdx]); }
  else if (e.key === "Escape") { resultsEl.hidden = true; }
});
resultsEl.addEventListener("mousedown", (e) => {
  const r = e.target.closest(".res");
  if (r) { e.preventDefault(); addProduct(lastResults[Number(r.dataset.i)]); }
});
document.addEventListener("click", (e) => { if (!e.target.closest(".search-wrap")) resultsEl.hidden = true; });

// ================================================================ items table

let flashIndex = -1;          // line to highlight once (just added / quantity raised)
function renderItems() {
  const tb = $("#items tbody");
  tb.innerHTML = q.items.map((it, i) => {
    const { rate, total } = calcLine(it);
    return `<tr data-i="${i}"${i === flashIndex ? ' class="row-new"' : ""}>
      <td class="c-no">${i + 1}</td>
      <td class="c-series"><div class="series">${esc(it.series)}</div></td>
      <td class="c-code"><div class="code">${esc(it.code)}</div></td>
      <td class="c-prod">
        <input class="pname" data-k="label" value="${esc(it.label)}" title="Product name as printed (you can edit it)">
        <input class="psize" data-k="size" value="${esc(it.size || "")}" placeholder="Size (optional)" title="Size printed under the product name (you can edit it)">
      </td>
      <td class="c-img"><img class="thumb" src="${esc(store.imageURLSync({ image: it.image }))}" alt="" onerror="this.style.visibility='hidden'"></td>
      <td class="c-qty" data-label="Qty"><input class="num" data-k="qty" type="number" min="0" step="1" value="${esc(it.qty)}"></td>
      <td class="money c-mrp" data-label="MRP">${rupee(it.mrp)}</td>
      <td class="c-disc" data-label="Disc. %"><input class="num" data-k="disc" type="number" min="0" max="100" step="0.5" value="${esc(it.disc)}"
           title="${it.custom ? "Custom discount for this line" : "Follows the quotation discount"}"
           style="${it.custom ? "border-color:#b26a00" : ""}"></td>
      <td class="money c-rate" data-label="Rate After Disc.">${rupee(rate)}</td>
      <td class="money total c-total" data-label="Taxable Amt">${rupee(total)}</td>
      <td class="money c-gst" data-label="GST Amt">${rupee(lineGst(total, settings.gst))}</td>
      <td class="money total c-amt" data-label="Total Amount">${rupee(total + lineGst(total, settings.gst))}</td>
      <td class="c-act"><div class="act-wrap">
        <div class="mv"><button class="icon-btn" data-act="up" title="Move up">▲</button><button class="icon-btn" data-act="down" title="Move down">▼</button></div>
        <button class="icon-btn" data-act="del" title="Remove">✕</button></div></td>
    </tr>`;
  }).join("");
  flashIndex = -1;
  syncLevers();
  $("#emptyItems").hidden = q.items.length > 0;
  $("#itemCount").textContent = q.items.length ? `${q.items.length} product${q.items.length > 1 ? "s" : ""}` : "";
  renderTotals();
}

// ================================================================ levers: hide discount / show GST column
// State lives on the quotation (q.hideDisc, q.hideGst) so a saved quotation reopens the same way;
// the PDF reads the same two flags.

const LEVERS = { lvDisc: { key: "hideDisc", on: false, cols: ".c-disc" }, lvGst: { key: "hideGst", on: false, cols: ".c-gst, .c-amt" } };
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function syncLevers() {
  const tbl = $("#items");
  tbl.classList.toggle("no-disc", !!q.hideDisc);
  tbl.classList.toggle("no-gst", !!q.hideGst);
  for (const [id, L] of Object.entries(LEVERS)) {
    const btn = $("#" + id), shown = !!q[L.key] === L.on;   // "shown" = the column is visible
    btn.setAttribute("aria-checked", String(shown));
    const small = btn.querySelector("small");
    small.textContent = shown ? small.dataset.on : small.dataset.off;
  }
}

function sparks(btn) {
  const slot = btn.querySelector(".lever-slot");
  for (let i = 0; i < 10; i++) {
    const s = document.createElement("i");
    s.className = "spark";
    const a = (Math.PI * (i / 9)) + Math.PI, d = 18 + Math.random() * 22;   // fan upwards
    s.style.setProperty("--dx", `${Math.cos(a) * d}px`);
    s.style.setProperty("--dy", `${Math.sin(a) * d}px`);
    slot.appendChild(s);
    setTimeout(() => s.remove(), 700);
  }
}

function pullLever(id) {
  const L = LEVERS[id], btn = $("#" + id), tbl = $("#items");
  const willShow = !(!!q[L.key] === L.on);
  const swap = () => { q[L.key] = willShow ? L.on : !L.on; persist(); syncLevers(); renderTotals(); };
  btn.classList.remove("pulled"); void btn.offsetWidth; btn.classList.add("pulled");
  setTimeout(() => btn.classList.remove("pulled"), 900);
  if (reducedMotion()) return swap();
  sparks(btn);
  const card = btn.closest(".card");
  card.classList.remove("jolt"); void card.offsetWidth; card.classList.add("jolt");
  if (willShow) {
    swap();
    tbl.querySelectorAll(L.cols).forEach((c, i) => { c.style.animationDelay = `${Math.min(i, 12) * 30}ms`; c.classList.add("col-in"); });
    setTimeout(() => tbl.querySelectorAll(".col-in").forEach((c) => { c.classList.remove("col-in"); c.style.animationDelay = ""; }), 1100);
  } else {
    tbl.querySelectorAll(L.cols).forEach((c) => c.classList.add("col-out"));
    setTimeout(() => {
      tbl.querySelectorAll(".col-out").forEach((c) => c.classList.remove("col-out"));
      swap();
      if (id === "lvDisc") tbl.querySelectorAll(".c-rate").forEach((c) => {   // the rate after discount now speaks for itself: flash it
        c.classList.add("rate-flash"); setTimeout(() => c.classList.remove("rate-flash"), 1200);
      });
    }, 420);
  }
}
for (const id of Object.keys(LEVERS)) $("#" + id).addEventListener("click", () => pullLever(id));

function renderTotals() {
  const t = calcQuote(q, settings.gst);
  $("#tQty").textContent = t.qty;
  $("#tMrp").textContent = rupee(t.mrpTotal);
  $("#tSub").textContent = rupee(t.sub);
  $("#tGstLabel").textContent = `Total TAX (GST ${settings.gst}%)`;
  $("#tGst").textContent = rupee(t.gst);
  const g = $("#tGrand"), net = rupee(t.net, 0);
  if (g.textContent !== net && g.textContent) {   // short pulse so the change is noticed
    const box = g.closest(".grand");
    box.classList.remove("pulse"); void box.offsetWidth; box.classList.add("pulse");
  }
  g.textContent = net;
  $("#tWords").innerHTML = q.items.length ? `<b>Amount (In Words):</b> ${esc(amountInWords(t.net))}` : "";
}

$("#items").addEventListener("input", (e) => {
  const tr = e.target.closest("tr[data-i]");
  if (!tr || !e.target.dataset.k) return;
  const it = q.items[Number(tr.dataset.i)];
  const k = e.target.dataset.k;
  if (k === "label") it.label = e.target.value;
  if (k === "size") it.size = e.target.value;
  else {
    it[k] = e.target.value === "" ? "" : Number(e.target.value);
    if (k === "disc") { it.custom = Number(it.disc) !== Number(q.discount); e.target.style.borderColor = it.custom ? "#b26a00" : ""; }
    const { rate, total } = calcLine(it);
    tr.querySelector(".c-rate").textContent = rupee(rate);
    tr.querySelector(".c-total").textContent = rupee(total);
    tr.querySelector(".c-gst").textContent = rupee(lineGst(total, settings.gst));
    tr.querySelector(".c-amt").textContent = rupee(total + lineGst(total, settings.gst));
    renderTotals();
  }
  persist();
});
$("#items").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const i = Number(b.closest("tr").dataset.i);
  if (b.dataset.act === "del") q.items.splice(i, 1);
  if (b.dataset.act === "up" && i > 0) [q.items[i - 1], q.items[i]] = [q.items[i], q.items[i - 1]];
  if (b.dataset.act === "down" && i < q.items.length - 1) [q.items[i + 1], q.items[i]] = [q.items[i], q.items[i + 1]];
  renderItems();
  persist();
});

// ================================================================ save & export

function claimNumber() {
  if (q.numbered) return;
  settings = store.getSettings();
  if (q.number === settings.prefix + String(settings.nextNo).padStart(4, "0")) {
    settings = store.setSettings({ nextNo: settings.nextNo + 1 });
  }
  q.numbered = true;
}

async function saveQuote(silent) {
  claimNumber();
  const t = calcQuote(q, settings.gst);
  await store.putQuote({ ...q, grand: t.grand, gst: settings.gst });
  persist();
  $("#saveState").textContent = "Saved ✓";
  if (!silent) toast("Quotation saved");
}

function checkReady() {
  if (!q.items.length) { toast("Add at least one product first.", true); return false; }
  const bad = q.items.find((it) => !(Number(it.qty) > 0));
  if (bad) { toast(`Quantity missing for ${bad.code}.`, true); return false; }
  if (!q.customer.trim() && !confirm("Customer name is empty. Download anyway?")) return false;
  return true;
}

// ---- download progress panel (document being written → steps → green tick)
const dlUI = (() => {
  const el = $("#dl"), bar = $("#dlBar"), title = $("#dlTitle"), sub = $("#dlSub"), steps = $$("#dlSteps li");
  let closeT = null;
  const close = () => {
    clearTimeout(closeT);
    if (el.hidden) return;
    el.classList.add("out");
    setTimeout(() => { el.hidden = true; el.classList.remove("out"); }, 280);
  };
  el.addEventListener("click", () => { if (!el.classList.contains("working")) close(); });
  return {
    open(ext) {
      clearTimeout(closeT);
      el.className = "dl working"; el.hidden = false;
      const pdf = ext === ".pdf";
      $("#dlBadge").textContent = pdf ? "PDF" : "XLSX";
      $("#dlBadge").className = "dl-badge" + (pdf ? "" : " xls");
      this.step(0, 6, "Preparing your quotation", [q.number, q.customer].filter(Boolean).join(" · "));
    },
    step(n, pct, t, s) {
      steps.forEach((li, i) => { li.className = i < n ? "ok" : i === n ? "on" : ""; });
      bar.style.width = pct + "%";
      if (t !== undefined) title.textContent = t;
      if (s !== undefined) sub.textContent = s;
    },
    done(name) {
      el.className = "dl done";
      steps.forEach((li) => { li.className = "ok"; });
      bar.style.width = "100%";
      title.textContent = "Quotation ready";
      sub.textContent = name;
      closeT = setTimeout(close, 1900);
    },
    fail(msg) {
      el.className = "dl err";
      title.textContent = "Could not create the file";
      sub.textContent = msg;
      closeT = setTimeout(close, 3500);
    },
  };
})();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exportWith(btn, fn, ext) {
  if (!checkReady()) return;
  const old = btn.textContent;
  const kind = ext === ".pdf" ? "PDF" : "Excel";
  btn.disabled = true;
  const t0 = performance.now();
  try {
    btn.textContent = "Preparing…";
    btn.classList.add("busy");
    dlUI.open(ext);
    fillSizes();
    await saveQuote(true);
    const n = q.items.length;
    dlUI.step(1, 14, "Adding product photos", n ? `Photo 1 of ${n}` : "");
    const blob = await fn(q, { ...settings, terms: settings.terms }, (i, total) => {
      btn.textContent = `Photos ${i + 1}/${total}…`;
      dlUI.step(1, 14 + Math.round(72 * (i + 1) / total), "Adding product photos", `Photo ${i + 1} of ${total}`);
    });
    dlUI.step(2, 94, `Creating the ${kind} file`, fileBase(q) + ext);
    await sleep(Math.max(0, 1100 - (performance.now() - t0)));   // long enough to see the steps
    download(blob, fileBase(q) + ext);
    dlUI.done(fileBase(q) + ext);
  } catch (err) {
    console.error(err);
    dlUI.fail(err.message);
    toast("Could not create the file: " + err.message, true);
  } finally {
    btn.disabled = false;
    btn.classList.remove("busy");
    btn.textContent = old;
  }
}

$("#btnXlsx").addEventListener("click", (e) => exportWith(e.currentTarget, buildXlsx, ".xlsx"));
$("#btnPdf").addEventListener("click", (e) => exportWith(e.currentTarget, buildPdf, ".pdf"));
$("#btnSave").addEventListener("click", () => saveQuote(false));

// ================================================================ saved quotations

async function renderSaved() {
  const all = (await store.listQuotes()).sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
  const f = $("#savedFilter").value.trim().toLowerCase();
  const list = all.filter((x) => !f || [x.number, x.customer, x.mobile, x.address, ...(x.makerInfo || [])].join(" ").toLowerCase().includes(f));
  $("#savedTable tbody").innerHTML = list.map((x) => `<tr data-id="${esc(x.id)}">
      <td data-sub="${esc(` · ${fmtDate(x.date)} · ${x.type} · ${x.items.length} item${x.items.length === 1 ? "" : "s"}`)}"><b>${esc(x.number)}</b></td><td>${esc(fmtDate(x.date))}</td>
      <td>${esc(x.customer || "—")}${x.maker === "dealer" ? ` <span class="muted" style="font-size:11px">(by ${esc(x.makerInfo?.[0] || "dealer")})</span>` : ""}<div class="muted" style="font-size:12px">${esc(x.mobile || "")}</div></td>
      <td>${esc(x.type)}</td><td class="r">${x.items.length}</td><td class="r"><b>${rupee(x.grand || 0)}</b></td>
      <td style="white-space:nowrap">
        <button class="btn" data-act="open">Open</button>
        <button class="btn ghost" data-act="copy" title="New quotation with the same products">Copy</button>
        <button class="icon-btn" data-act="del" title="Delete">✕</button></td></tr>`).join("");
  $("#savedEmpty").hidden = list.length > 0;
}
$("#savedFilter").addEventListener("input", renderSaved);
$("#savedTable").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const id = b.closest("tr").dataset.id;
  const x = await store.getQuote(id);
  if (!x) return;
  if (b.dataset.act === "del") {
    if (confirm(`Delete quotation ${x.number} (${x.customer || "no name"})? This cannot be undone.`)) {
      await store.deleteQuote(id);
      renderSaved();
    }
    return;
  }
  if (b.dataset.act === "open") q = x;
  if (b.dataset.act === "copy") {
    q = { ...newQuote(), type: x.type, discount: x.discount, hideDisc: x.hideDisc, hideGst: x.hideGst, items: x.items.map((it) => ({ ...it })) };
  }
  loadIntoForm();
  persist();
  $('#tabs button[data-tab="quote"]').click();
});

// ================================================================ price list tab

function renderPLSummary() {
  const meta = store.getMeta();
  const names = { KLASSIC: "Klassic", AURUM: "Aurum", VANITY: "Vanity" };
  $("#plSummary").innerHTML = Object.entries(meta.lists).map(([c, l]) => `<div class="pl-box">
      <b>${names[c]}</b><span>${esc(l.name || "—")} · ${l.count} products</span>
      ${l.updated ? `<div class="upd">Updated ${esc(new Date(l.updated).toLocaleDateString("en-IN"))}</div>` : `<div class="muted" style="font-size:12px">Built-in</div>`}
    </div>`).join("");
  const lists = Object.values(meta.lists).map((l) => l.name).filter(Boolean);
  $("#priceListBadge").textContent = `${store.getProducts().length} products · price lists: ${[...new Set(lists)].join(", ")}`;
}

let plShown = 100;
function renderPLTable() {
  const f = $("#plFilter").value;
  const list = f.trim() ? search(f, 400) : store.getProducts();
  const shown = list.slice(0, plShown);
  $("#plTable tbody").innerHTML = shown.map((p) => `<tr data-id="${esc(p.id)}">
      <td><img class="thumb" loading="lazy" src="${esc(store.imageURLSync(p))}" alt="" onerror="this.style.visibility='hidden'"></td>
      <td><b>${esc(p.code)}</b></td>
      <td>${esc(productLabel(p))}<div class="muted" style="font-size:12px">${esc(seriesLabel(p))}</div>
        ${p.flag ? `<div class="flag">⚠ ${esc(p.flag)}</div>` : ""}</td>
      <td>${esc(p.collection)}<div class="muted" style="font-size:12px">${esc(p.price_list || "")}</div></td>
      <td class="r"><span class="mrp-edit" title="Click to change">${rupee(p.mrp, 0)}</span></td></tr>`).join("");
  $("#plMore").innerHTML = list.length > shown.length
    ? `Showing ${shown.length} of ${list.length}. <button class="btn ghost" id="plMoreBtn">Show more</button>` : `${list.length} products`;
}
$("#plFilter").addEventListener("input", () => { plShown = 100; renderPLTable(); });
$("#plMore").addEventListener("click", (e) => { if (e.target.id === "plMoreBtn") { plShown += 200; renderPLTable(); } });
$("#plTable").addEventListener("click", async (e) => {
  if (!e.target.classList.contains("mrp-edit")) return;
  const id = e.target.closest("tr").dataset.id;
  const list = store.getProducts();
  const p = list.find((x) => x.id === id);
  const v = prompt(`New MRP for ${p.code} – ${productLabel(p)}\n(current ₹${inr(p.mrp, 0)})`, p.mrp);
  if (v === null) return;
  const n = Number(String(v).replace(/[,₹\s]/g, ""));
  if (!(n > 0)) { toast("Please enter a valid price.", true); return; }
  p.mrp = n;
  p.flag = "";
  await store.saveProducts(list, store.getMeta());
  buildIndex(list);
  renderPLTable();
  toast(`${p.code} MRP set to ${rupee(n, 0)}`);
});

function renderPriceTab() {
  renderPLSummary();
  renderPLTable();
}

// ---- upload a new price-list PDF
let pending = null;
$("#upFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const coll = $("#upColl").value;
  const prog = $("#upProgress");
  const bar = $(".bar", prog), lbl = $("span", prog);
  prog.hidden = false;
  $("#upResult").innerHTML = "";
  try {
    const parsed = await parsePriceList(file, coll, (done, total, msg) => {
      bar.style.width = `${Math.round((done / total) * 100)}%`;
      lbl.textContent = msg || `Reading page ${done} of ${total}…`;
    });
    const name = $("#upName").value.trim() || parsed.guessName || file.name.replace(/\.pdf$/i, "");
    pending = { coll, name, parsed, diff: diffPriceList(store.getProducts(), coll, parsed.products) };
    renderDiff();
  } catch (err) {
    console.error(err);
    $("#upResult").innerHTML = `<p class="flag">Could not read this PDF: ${esc(err.message)}</p>`;
  } finally {
    prog.hidden = true;
  }
});

function renderDiff() {
  const { diff, parsed, name, coll } = pending;
  const rowsChanged = diff.changed.map((d) => `<tr><td><b>${esc(d.old.code)}</b></td><td>${esc(productLabel(d.old))}</td>
      <td class="r">${rupee(d.old.mrp, 0)}</td><td class="r ${d.new.mrp > d.old.mrp ? "chg-up" : "chg-down"}">${rupee(d.new.mrp, 0)}</td></tr>`).join("");
  const rowsNew = diff.added.map((p) => `<tr><td><b>${esc(p.code)}</b></td><td>${esc(productLabel(p))}</td><td></td><td class="r">${rupee(p.mrp, 0)}</td></tr>`).join("");
  const rowsGone = diff.missing.map((p) => `<tr><td><b>${esc(p.code)}</b></td><td>${esc(productLabel(p))}</td><td class="r">${rupee(p.mrp, 0)}</td><td></td></tr>`).join("");
  const problems = parsed.problems.length
    ? `<details><summary class="flag">⚠ ${parsed.problems.length} page(s) need a manual check</summary><ul>${parsed.problems.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details>` : "";
  $("#upResult").innerHTML = `
    <p><b>${parsed.products.length}</b> prices found in the PDF (${parsed.pages} pages) for <b>${esc(coll)}</b>, price list “${esc(name)}”.</p>
    <div class="diff-stats">
      <span class="stat">${diff.same} unchanged</span>
      <span class="stat up">${diff.changed.length} price changes</span>
      <span class="stat new">${diff.added.length} new products</span>
      <span class="stat gone">${diff.missing.length} not in new list</span>
    </div>
    ${problems}
    ${diff.changed.length ? `<h3>Price changes</h3><div class="diff-table"><table class="list"><thead><tr><th>Code</th><th>Product</th><th class="r">Old MRP</th><th class="r">New MRP</th></tr></thead><tbody>${rowsChanged}</tbody></table></div>` : ""}
    ${diff.added.length ? `<h3>New products</h3><div class="diff-table"><table class="list"><thead><tr><th>Code</th><th>Product</th><th></th><th class="r">MRP</th></tr></thead><tbody>${rowsNew}</tbody></table></div>` : ""}
    ${diff.missing.length ? `<h3>Not found in the new PDF</h3><p class="hint">These may be discontinued. Tick the box below to remove them; otherwise they keep their old price.</p><div class="diff-table"><table class="list"><thead><tr><th>Code</th><th>Product</th><th class="r">Old MRP</th><th></th></tr></thead><tbody>${rowsGone}</tbody></table></div>
      <label class="check"><input type="checkbox" id="dropMissing"> Remove the ${diff.missing.length} products not found in the new PDF</label>` : ""}
    <div class="actions" style="margin-top:12px">
      <button class="btn primary" id="btnApply">Apply update</button>
      <button class="btn" id="btnCancelUp">Cancel</button>
    </div>`;
}

$("#upResult").addEventListener("click", async (e) => {
  if (e.target.id === "btnCancelUp") { pending = null; $("#upResult").innerHTML = ""; return; }
  if (e.target.id !== "btnApply" || !pending) return;
  e.target.disabled = true;
  e.target.textContent = "Saving…";
  const drop = $("#dropMissing") && $("#dropMissing").checked;
  const { list, meta } = await applyPriceList(store.getProducts(), store.getMeta(), pending, { dropMissing: drop });
  await store.saveProducts(list, meta);
  await store.warmImageCache(list);
  buildIndex(list);
  pending = null;
  $("#upResult").innerHTML = `<p style="color:var(--ok);font-weight:600">✓ Price list updated. New quotations use the new prices.</p>`;
  renderPriceTab();
});

// ---- backup
$("#btnExportDb").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(store.getProducts(), null, 1)], { type: "application/json" });
  download(blob, "products.json");
  if (store.getProducts().some((p) => (p.image || "").startsWith("idb:"))) {
    toast("Note: photos of newly added products stay in this browser only.");
  }
});
$("#importDb").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const list = JSON.parse(await f.text());
    if (!Array.isArray(list) || !list.length || !list[0].code) throw new Error("not a product database");
    await store.saveProducts(list, null);
    buildIndex(list);
    renderPriceTab();
    toast(`Loaded ${list.length} products`);
  } catch (err) { toast("Could not load: " + err.message, true); }
});
$("#btnResetDb").addEventListener("click", async () => {
  if (!confirm("Go back to the built-in price list? Price updates made in this browser will be removed.")) return;
  const list = await store.resetProducts();
  buildIndex(list);
  renderPriceTab();
  toast("Built-in price list restored");
});

// ================================================================ settings

function renderSettings() {
  settings = store.getSettings();
  $("#sGst").value = settings.gst;
  $("#sNextNo").value = settings.nextNo;
  $("#sPrefix").value = settings.prefix;
  $("#sKeepRows").checked = settings.keepRows;
  $("#sTerms").value = settings.terms.join("\n");
  $("#sClosing").value = settings.closing;
}
function saveSettingsForm() {
  settings = store.setSettings({
    gst: Number($("#sGst").value) || 0,
    nextNo: Math.max(1, Number($("#sNextNo").value) || 1),
    prefix: $("#sPrefix").value,
    keepRows: $("#sKeepRows").checked,
    terms: $("#sTerms").value.split("\n").map((s) => s.trimEnd()).filter((s) => s.trim()),
    closing: $("#sClosing").value.trim() || store.DEFAULT_CLOSING,
  });
  renderTotals();
}
["#sGst", "#sNextNo", "#sPrefix", "#sKeepRows", "#sTerms", "#sClosing"].forEach((s) => $(s).addEventListener("change", saveSettingsForm));
$("#btnResetTerms").addEventListener("click", () => { $("#sTerms").value = store.DEFAULT_TERMS.join("\n"); saveSettingsForm(); });

// ================================================================ start

async function loadData() {
  const list = await store.loadProducts();
  await store.warmImageCache(list);
  buildIndex(list);
  renderPLSummary();
  if (store.dbUpgraded) toast("Price list updated: WC / basin sets now show the full set price first.");
}

/** show the password screen until the price list can be decrypted */
function unlock() {
  return new Promise((resolve) => {
    const lock = $("#lock");
    lock.hidden = false;
    $("#lockPw").focus();
    $("#lockForm").onsubmit = async (e) => {
      e.preventDefault();
      const btn = $("#lockForm button");
      btn.disabled = true;
      $("#lockErr").hidden = true;
      store.setPassword($("#lockPw").value, $("#lockRemember").checked);
      try {
        await loadData();
        lock.hidden = true;
        resolve();
      } catch (err) {
        if (!(err instanceof store.LockedError)) console.error(err);
        store.setPassword("", false);
        $("#lockErr").hidden = false;
        $("#lockPw").select();
      } finally { btn.disabled = false; }
    };
  });
}

async function init() {
  bindForm();
  try {
    await loadData();
  } catch (err) {
    if (err instanceof store.LockedError) { store.setPassword("", false); await unlock(); }
    else { console.error(err); toast("Could not load the product list: " + err.message, true); }
  }
  q = store.loadDraft() || newQuote();
  loadIntoForm();
  searchBox.focus();
}
init();

$("#btnExportEnc").addEventListener("click", async () => {
  let pw = store.getPassword();
  if (!pw) {
    pw = prompt("Password to encrypt the price list with (the website will ask for it):") || "";
    if (pw.length < 8) { toast("Please use a password of at least 8 characters.", true); return; }
  }
  const blob = new Blob([await store.encryptDb(store.getProducts(), pw)], { type: "application/json" });
  download(blob, "products.enc");
  toast("Downloaded products.enc – upload it to data/ in the GitHub repository");
});

// for debugging / automated checks
window.__kq = { get q() { return q; }, store, buildXlsx, buildPdf, search };

// header gets a soft shadow once the page is scrolled
window.addEventListener("scroll", () => document.body.classList.toggle("scrolled", window.scrollY > 4), { passive: true });
