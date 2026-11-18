// Shared helpers: money formatting, product labels, quotation maths.
import { COLLECTIONS } from "./store.js";

export const round2 = (n) => Math.round((Number(n) || 0) * 100 + Number.EPSILON) / 100;

/** Indian grouping: 1,02,300.00 */
export function inr(n, decimals = 2) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export const rupee = (n, d = 2) => "₹" + inr(n, d);

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** "Collection / Series" column text */
export function seriesLabel(p) {
  const coll = COLLECTIONS[p.collection] || p.collection || "";
  let s = p.series || "";
  if (p.collection === "KLASSIC" && p.category === "Sanitaryware") s = p.sub_category || p.series;
  if (p.collection === "VANITY") s = p.series || "Vanity";
  if (!s || s.toLowerCase() === coll.toLowerCase()) return coll;
  return `${coll} / ${s}`;
}

/** "Product Name" column text: name + option + finish */
export function productLabel(p) {
  let s = p.name || "";
  if (p.variant && !s.toLowerCase().includes(p.variant.toLowerCase())) s += ` – ${p.variant}`;
  if (p.finish && !s.toLowerCase().includes(p.finish.toLowerCase())) s += ` (${p.finish})`;
  return s.trim();
}

export function codeLabel(p) {
  return p.code;
}

export function calcLine(it) {
  const rate = round2(it.mrp * (1 - (Number(it.disc) || 0) / 100));
  const total = round2(rate * (Number(it.qty) || 0));
  return { rate, total };
}

export function calcQuote(q, gstPct) {
  let sub = 0;
  for (const it of q.items) sub += calcLine(it).total;
  sub = round2(sub);
  const gst = round2(sub * gstPct / 100);
  return { sub, gst, grand: round2(sub + gst) };
}

export function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
  return `${String(d).padStart(2, "0")}-${mon}-${y}`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fileBase(q) {
  const who = (q.customer || "Customer").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "Customer";
  const no = (q.number || "").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-|-$/g, "");
  return `Quotation_${no ? no + "_" : ""}${who}_${fmtDate(q.date)}`;
}

export function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/** Load an image URL and return a JPEG (or PNG) at most maxPx on the long side. */
export async function loadImageScaled(url, maxPx, type = "image/jpeg", quality = 0.92, crop = null) {
  if (!url) return null;
  const img = await new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error("image load failed: " + url));
    im.src = url;
  }).catch(() => null);
  if (!img) return null;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (crop) { // fractions l,t,r,b
    sx = sw * crop.l; sy = sh * crop.t;
    sw = sw * (1 - crop.l - crop.r); sh = sh * (1 - crop.t - crop.b);
  }
  const k = Math.min(1, maxPx / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  if (type === "image/jpeg") { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); }
  g.imageSmoothingQuality = "high";
  g.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const blob = await new Promise((r) => c.toBlob(r, type, quality));
  const dataURL = c.toDataURL(type, quality);
  return { blob, dataURL, w, h };
}
