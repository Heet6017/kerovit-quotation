// Data layer: product database (built-in JSON + local updates), photos, settings, saved quotations.

const DB_NAME = "kerovit-quotation";
const DB_VER = 1;
let _db = null;

function idb() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
      if (!db.objectStoreNames.contains("quotes")) db.createObjectStore("quotes", { keyPath: "id" });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((r) => { out = r; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const kvGet = (k) => tx("kv", "readonly", (s) => reqP(s.get(k)));
export const kvSet = (k, v) => tx("kv", "readwrite", (s) => { s.put(v, k); });
export const kvDel = (k) => tx("kv", "readwrite", (s) => { s.delete(k); });

// ---------------------------------------------------------------- products

export const COLLECTIONS = {
  KLASSIC: "Klassic",
  AURUM: "Aurum",
  VANITY: "Vanity",
};

let products = [];
let meta = null;      // { lists: {KLASSIC: {name, updated, count}, ...}, source: "built-in" | "local" }

export function getProducts() { return products; }
export function getMeta() { return meta; }

function defaultMeta(list) {
  const lists = {};
  for (const c of Object.keys(COLLECTIONS)) {
    const p = list.find((x) => x.collection === c);
    lists[c] = { name: p ? p.price_list : "", updated: null, count: list.filter((x) => x.collection === c).length };
  }
  return { lists, source: "built-in" };
}

// ---------------------------------------------------------------- encrypted price list
// The published site only has data/products.enc (AES-GCM, key from the password via PBKDF2).
const PW_KEY = "kq.pw";
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64e = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

async function aesKey(password, salt, iter) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export class LockedError extends Error {}

export function getPassword() { try { return localStorage.getItem(PW_KEY) || sessionStorage.getItem(PW_KEY) || ""; } catch { return ""; } }
export function setPassword(pw, remember) {
  try {
    localStorage.removeItem(PW_KEY); sessionStorage.removeItem(PW_KEY);
    if (pw) (remember ? localStorage : sessionStorage).setItem(PW_KEY, pw);
  } catch {}
}

async function decryptDb(env, password) {
  const key = await aesKey(password, b64d(env.salt), env.iter);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(env.iv) }, key, b64d(env.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch { throw new LockedError("wrong password"); }
}

/** encrypted copy of a product list, in the same format as tools/encrypt_db.py */
export async function encryptDb(list, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const iter = 310000;
  const key = await aesKey(password, salt, iter);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(list))));
  return JSON.stringify({ v: 1, kdf: "PBKDF2-SHA256", iter, salt: b64e(salt), iv: b64e(iv), data: b64e(ct) });
}

async function loadBuiltIn() {
  const enc = await fetch("data/products.enc", { cache: "no-cache" });
  if (enc.ok) {
    const pw = getPassword();
    if (!pw) throw new LockedError("password needed");
    return decryptDb(await enc.json(), pw);
  }
  const r = await fetch("data/products.json", { cache: "no-cache" });   // local development copy
  if (!r.ok) throw new Error("Could not load the price list");
  return r.json();
}

export async function loadProducts() {
  let local = null;
  try { local = await kvGet("products"); } catch (e) { console.warn("IndexedDB unavailable", e); }
  if (local && Array.isArray(local.products) && local.products.length) {
    products = local.products;
    meta = local.meta || defaultMeta(products);
    meta.source = "local";
  } else {
    products = await loadBuiltIn();
    meta = defaultMeta(products);
  }
  return products;
}

export async function saveProducts(list, newMeta) {
  products = list;
  meta = newMeta || meta || defaultMeta(list);
  for (const c of Object.keys(COLLECTIONS)) {
    if (meta.lists[c]) meta.lists[c].count = list.filter((x) => x.collection === c).length;
  }
  meta.source = "local";
  await kvSet("products", { products: list, meta });
}

export async function resetProducts() {
  await kvDel("products");
  return loadProducts();
}

// ---------------------------------------------------------------- photos
// Built-in photos are files in images/products/. Photos of products added by a price-list
// update are stored in IndexedDB and referenced as "idb:<key>".

const urlCache = new Map();

export async function putImage(key, blob) {
  await tx("images", "readwrite", (s) => { s.put(blob, key); });
  return "idb:" + key;
}

export async function imageURL(p) {
  if (!p || !p.image) return "";
  if (!p.image.startsWith("idb:")) return p.image;
  if (urlCache.has(p.image)) return urlCache.get(p.image);
  const blob = await tx("images", "readonly", (s) => reqP(s.get(p.image.slice(4))));
  const url = blob ? URL.createObjectURL(blob) : "";
  urlCache.set(p.image, url);
  return url;
}

export function imageURLSync(p) {
  if (!p || !p.image) return "";
  if (!p.image.startsWith("idb:")) return p.image;
  return urlCache.get(p.image) || "";
}

export async function imageBlob(p) {
  if (!p || !p.image) return null;
  if (p.image.startsWith("idb:")) return tx("images", "readonly", (s) => reqP(s.get(p.image.slice(4))));
  const r = await fetch(p.image);
  return r.ok ? r.blob() : null;
}

export async function warmImageCache(list) {
  for (const p of list) if (p.image && p.image.startsWith("idb:")) await imageURL(p);
}

// ---------------------------------------------------------------- settings

export const DEFAULT_TERMS = [
  "1. Prices are based on the prevailing October 2026 price list and are subject to change as applicable.",
  "2. GST will be charged extra as applicable.",
  "3. Quotation validity is subject to the date and terms mentioned above.",
  "4. Delivery is subject to product availability and confirmed order/payment terms.",
  "5. Transportation/freight charges, if applicable, will be charged extra.",
  "6. Special approval/project prices are applicable only to the approved quantity and project.",
  "7. Payment terms shall be as mutually agreed and confirmed in the purchase order.",
  "8. Goods once sold are not returnable/exchangeable except as per applicable company policy.",
  "9. Any transit damage, shortage or discrepancy should be reported promptly after receipt.",
  "10. Warranty is governed by the company's prevailing warranty terms and conditions.",
  "11. Product images are for identification/reference; actual product appearance may vary slightly.",
];

const SETTINGS_KEY = "kq.settings";
export const DEFAULT_CLOSING = "Thank you for considering Kerovit. We look forward to helping you create Bathrooms You Desire.";
const OLD_CLOSINGS = ["Thank you for choosing Kerovit. We truly appreciate your trust in us and look forward to serving you."];
const DEFAULT_SETTINGS = { gst: 18, nextNo: 1, prefix: "KQ/", keepRows: false, terms: DEFAULT_TERMS, closing: DEFAULT_CLOSING };

export function getSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (!s.closing || OLD_CLOSINGS.includes(s.closing)) delete s.closing;   // old default -> new default
    return { ...DEFAULT_SETTINGS, ...s, terms: Array.isArray(s.terms) && s.terms.length ? s.terms : DEFAULT_TERMS };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function setSettings(patch) {
  const s = { ...getSettings(), ...patch };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
  return s;
}

// ---------------------------------------------------------------- quotations

export const listQuotes = () => tx("quotes", "readonly", (s) => reqP(s.getAll()));
export const getQuote = (id) => tx("quotes", "readonly", (s) => reqP(s.get(id)));
export const putQuote = (q) => tx("quotes", "readwrite", (s) => { s.put(q); });
export const deleteQuote = (id) => tx("quotes", "readwrite", (s) => { s.delete(id); });

const DRAFT_KEY = "kq.draft";
export function saveDraft(q) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(q)); } catch {} }
export function loadDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; } }
