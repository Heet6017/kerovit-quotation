// Visual layer: theme switch, sliding tab highlight, scroll line, ripples, photo loading state,
// count-up totals and step ticks. It only reads and decorates the page; quotation data is untouched.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const root = document.documentElement;

// ---------------------------------------------------------------- light / dark
function setTheme(t) {
  root.setAttribute("data-theme", t);
  try { localStorage.setItem("kq.theme", t); } catch {}
  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = t === "dark" ? "#0b131d" : "#1f4e78";
  requestAnimationFrame(placeIndicator);
}
setTheme(root.getAttribute("data-theme") === "dark" ? "dark" : "light");

$("#themeBtn")?.addEventListener("click", (e) => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  // circular reveal from the button where the browser supports view transitions
  if (!document.startViewTransition || reduced()) { setTheme(next); return; }
  const r = e.currentTarget.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const vt = document.startViewTransition(() => setTheme(next));
  vt.ready.then(() => {
    root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
      { duration: 520, easing: "cubic-bezier(.22,.61,.36,1)", pseudoElement: "::view-transition-new(root)" });
  }).catch(() => {});
});
// follow the device setting while the user has not chosen one
window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", (m) => {
  let saved = null;
  try { saved = localStorage.getItem("kq.theme"); } catch {}
  if (!saved) setTheme(m.matches ? "dark" : "light");
});

// ---------------------------------------------------------------- sliding tab highlight
const tabs = $("#tabs");
const ind = document.createElement("span");
ind.className = "tab-ind";
tabs.prepend(ind);
tabs.classList.add("has-ind");
function placeIndicator() {
  const b = $("button.active", tabs);
  if (!b) return;
  ind.style.width = b.offsetWidth + "px";
  ind.style.height = b.offsetHeight + "px";
  ind.style.transform = `translate(${b.offsetLeft}px, ${b.offsetTop}px)`;
}
tabs.addEventListener("click", () => requestAnimationFrame(placeIndicator));
new MutationObserver(() => requestAnimationFrame(placeIndicator)).observe(tabs, { subtree: true, attributes: true, attributeFilter: ["class"] });
window.addEventListener("resize", placeIndicator);
// first placement without sliding in from the corner
ind.style.transition = "none";
requestAnimationFrame(() => { placeIndicator(); requestAnimationFrame(() => { ind.style.transition = ""; }); });
document.fonts?.ready.then(placeIndicator);

// ---------------------------------------------------------------- scroll progress line
const line = $(".scroll-line");
function onScroll() {
  const max = document.documentElement.scrollHeight - innerHeight;
  line?.style.setProperty("--scroll", max > 0 ? Math.min(1, scrollY / max).toFixed(4) : 0);
}
window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll);
onScroll();

// ---------------------------------------------------------------- ripple on press
document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest(".btn, .type, .tabs button, .theme-btn");
  if (!el || el.disabled || reduced()) return;
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement("span");
  s.className = "ripple";
  s.style.width = s.style.height = size + "px";
  s.style.left = e.clientX - r.left - size / 2 + "px";
  s.style.top = e.clientY - r.top - size / 2 + "px";
  el.appendChild(s);
  setTimeout(() => s.remove(), 600);
});

// ---------------------------------------------------------------- product photos: stop the shimmer once loaded
const markLoaded = (img) => img.classList.add("loaded");
document.addEventListener("load", (e) => { if (e.target.tagName === "IMG") markLoaded(e.target); }, true);
document.addEventListener("error", (e) => { if (e.target.tagName === "IMG") markLoaded(e.target); }, true);
const scanImgs = () => $$("img.thumb:not(.loaded), .res img:not(.loaded)").forEach((i) => { if (i.complete || !i.getAttribute("src")) markLoaded(i); });
new MutationObserver(scanImgs).observe(document.body, { childList: true, subtree: true });
scanImgs();

// ---------------------------------------------------------------- totals count up to their new value
const fmt = (v, dec) => v.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec });
function countUp(el) {
  let busy = false, last = el.textContent;
  new MutationObserver(() => {
    if (busy) return;
    const target = el.textContent;
    const from = parseFloat(last.replace(/[^\d.]/g, "")) || 0, to = parseFloat(target.replace(/[^\d.]/g, ""));
    last = target;
    if (!isFinite(to) || from === to || reduced()) return;
    const prefix = target.match(/^[^\d]*/)[0], dec = (target.split(".")[1] || "").length;
    const t0 = performance.now(), dur = 520;
    busy = true;
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = k < 1 ? prefix + fmt(from + (to - from) * e, dec) : target;
      if (k < 1) requestAnimationFrame(step); else busy = false;
    };
    requestAnimationFrame(step);
  }).observe(el, { childList: true, characterData: true, subtree: true });
}
["#tQty", "#tMrp", "#tSub", "#tGst", "#tGrand"].forEach((s) => { const el = $(s); if (el) countUp(el); });

// ---------------------------------------------------------------- installable app (offline helper)
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// ---------------------------------------------------------------- Android app download count (Settings)
// GitHub counts every download of the APK from the release; read it when Settings is opened.
let statsAt = 0;
async function loadApkStats() {
  const el = $("#apkStats");
  if (!el || Date.now() - statsAt < 60000) return;
  statsAt = Date.now();
  try {
    const res = await fetch("https://api.github.com/repos/Heet6017/kerovit-quotation/releases?per_page=100", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status);
    let total = 0, latest = null;
    for (const r of await res.json()) for (const a of r.assets || []) if (a.name.endsWith(".apk")) {
      total += a.download_count;
      if (!latest) latest = { v: r.tag_name, n: a.download_count };
    }
    el.textContent = `Downloads: ${total.toLocaleString("en-IN")} in total` +
      (latest && latest.n !== total ? ` (${latest.n.toLocaleString("en-IN")} of ${latest.v})` : "") +
      ". Counted by GitHub since 22 Nov 2026; one person downloading twice counts twice.";
  } catch {
    statsAt = 0;
    el.textContent = "Downloads: can't load the count right now (needs internet).";
  }
}
$('#tabs button[data-tab="settings"]')?.addEventListener("click", loadApkStats);

// ---------------------------------------------------------------- step numbers turn into ticks
const steps = $$("#tab-quote .steps > .card");
function updateSteps() {
  if (steps.length < 4) return;
  const named = !!$("#fCustomer")?.value.trim();
  const items = $$("#items tbody tr").length > 0;
  const saved = /saved/i.test($("#saveState")?.textContent || "");
  const done = [named, named && !!$("#typeChoices .type.active"), items, items && saved];
  steps.forEach((c, i) => c.classList.toggle("step-done", done[i]));
}
document.addEventListener("input", updateSteps);
document.addEventListener("click", () => setTimeout(updateSteps, 0));
new MutationObserver(updateSteps).observe($("#items tbody"), { childList: true });
const st = $("#saveState");
if (st) new MutationObserver(updateSteps).observe(st, { childList: true, characterData: true, subtree: true });
setTimeout(updateSteps, 300);
