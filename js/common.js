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

/**
 * Quotation totals:
 *  qty      Total Quantity
 *  mrpTotal Total MRP (MRP × qty, before discount)
 *  sub      Total Taxable Amt (after discount)
 *  gst      Total TAX
 *  grand    taxable + tax;  net = grand rounded to the rupee (Net Amt)
 */
export function calcQuote(q, gstPct) {
  let sub = 0, qty = 0, mrpTotal = 0;
  for (const it of q.items) {
    sub += calcLine(it).total;
    qty += Number(it.qty) || 0;
    mrpTotal += (Number(it.mrp) || 0) * (Number(it.qty) || 0);
  }
  sub = round2(sub);
  const gst = round2(sub * gstPct / 100);
  const grand = round2(sub + gst);
  return { sub, gst, grand, qty, mrpTotal: round2(mrpTotal), net: Math.round(grand) };
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function words99(n) { return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? " " + ONES[n % 10] : ""}`; }
function words999(n) {
  const h = Math.floor(n / 100), r = n % 100;
  return [h ? ONES[h] + " Hundred" : "", r ? words99(r) : ""].filter(Boolean).join(" ");
}

/** 108967 -> "One Lakh Eight Thousand Nine Hundred Sixty Seven Rupees Only" (Indian numbering) */
export function amountInWords(amount) {
  let n = Math.round(Number(amount) || 0);
  if (n === 0) return "Zero Rupees Only";
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push((crore > 99 ? words999(crore) : words99(crore)) + " Crore");
  if (lakh) parts.push(words99(lakh) + " Lakh");
  if (thousand) parts.push(words99(thousand) + " Thousand");
  if (n) parts.push(words999(n));
  return parts.join(" ") + " Rupees Only";
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
