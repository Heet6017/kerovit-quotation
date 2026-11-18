// Price-list reader: a browser (pdf.js) port of tools/extract.py.
// Reads a Kerovit price-list PDF, finds every product code with its price, compares with the
// current database and (on Apply) updates prices, adds new products with their photos.
import { putImage } from "./store.js";

const pdfjs = window.pdfjsLib;
pdfjs.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";

const FINISH = {
  CP: "Chrome", RG: "Rose Gold", CG: "Champagne Gold", GM: "Gunmetal", CRG: "Chrome & Rose Gold",
  MBRG: "Matte Black & Rose Gold", CGL: "Chrome & Gold", GW: "Glossy White", MW: "Matte White",
  GB: "Glossy Black", MB: "Matte Black", MBK: "Matte Black", MG: "Matte Light Grey", MC: "Matte Brown",
  DGY: "Matte Dark Grey", LGY: "Matte Light Grey",
};

const CODE = String.raw`[A-Z]{2,}[A-Z0-9\-]*\d[A-Z0-9\-\.]*`;
const CODE_LINE = new RegExp(String.raw`^\s*(${CODE}\*?(\s*/\s*(?:${CODE}|\d{2})\*?)*)\s*(\([^)]*\)\s*\*?)?\s*$`);
const NUM = String.raw`\d{1,3}(?:,\d{2,4})+|\d{3,6}`;
const RUPEE = "[`₹]";
// a price is "₹ 1,234" – or "Per Piece 1,234" where the ₹ glyph didn't come through
const PMARK = `(?:${RUPEE}|Per Piece(?=\\s*\\d))`;
const PRICE_IN_G = () => new RegExp(`${PMARK}\\s*(${NUM})`, "g");
const PRICE_IN = new RegExp(`${PMARK}\\s*(${NUM})`);
const HEADER = new RegExp(String.raw`^(?<name>[A-Z0-9][A-Z0-9 ()"'”’\.\-&]*?)\s+-\s+(?<codes>[A-Z]{1,}[A-Z0-9\-]*\s*\*?(\s*/\s*[A-Z]{1,}[A-Z0-9\-]*\s*\*?)*)\s*(?<col>White)?\s*$`, "u");
const SPEC = /^(Open\s+)?(P-Trap|S-Trap|Size|Cistern\s*:|Twin Flush)/i;

const toInt = (s) => parseInt(String(s).replace(/,/g, ""), 10);
const suspicious = (v) => /,\d{4}/.test(v);
const pyTitle = (s) => String(s).toLowerCase().replace(/(^|[^A-Za-z])([a-z])/g, (_, a, b) => a + b.toUpperCase());
const isUpper = (s) => /[A-Za-z]/.test(s) && s === s.toUpperCase();
function isTitle(t) {
  const letters = [...t].filter((c) => /[A-Za-z]/.test(c));
  return letters.length > 0 && letters.filter((c) => c === c.toUpperCase()).length >= 0.7 * letters.length;
}
function clean(t) {
  t = String(t).replace(/\s+/g, " ").trim().replace(/^[ \-,]+|[ \-,]+$/g, "");
  return t.replace(/Compatable/g, "Compatible").replace(/Avaliable/g, "Available");
}
function splitCodes(t) { return t.split("/").map((c) => c.trim().replace(/\*+$/, "").trim()).filter(Boolean); }
function expandCodes(t) {
  const out = [];
  for (const p of splitCodes(t)) {
    if (/^\d{2}$/.test(p) && out.length) out.push(out[out.length - 1].slice(0, -2) + p);
    else out.push(p);
  }
  return out;
}
function codePart(t) {
  const m = t.match(/^\s*(.*?)\s*\(([^)]*)\)\s*\*?\s*$/);
  return m ? [m[1], pyTitle(m[2])] : [t, ""];
}
function finishOf(code) {
  const m = code.match(/-([A-Z]+)$/);
  return m ? FINISH[m[1]] || "" : "";
}

// ---------------------------------------------------------------- geometry
const R = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const rw = (r) => r.x1 - r.x0, rh = (r) => r.y1 - r.y0;
const runion = (a, b) => R(Math.min(a.x0, b.x0), Math.min(a.y0, b.y0), Math.max(a.x1, b.x1), Math.max(a.y1, b.y1));
const mul = (m1, m2) => [
  m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

async function readPage(page) {
  const vp = page.getViewport({ scale: 1 });
  const W = vp.width, H = vp.height;
  const ops = await page.getOperatorList();
  const tc = await page.getTextContent();

  // --- images (to locate product photos)
  const O = pdfjs.OPS;
  const imgOps = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintJpegXObject].filter((x) => x !== undefined));
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const imgs = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i], a = ops.argsArray[i];
    if (fn === O.save) stack.push(ctm.slice());
    else if (fn === O.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === O.transform) ctm = mul(ctm, a);
    else if (fn === O.paintFormXObjectBegin) { stack.push(ctm.slice()); if (a && a[0]) ctm = mul(ctm, a[0]); }
    else if (fn === O.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (imgOps.has(fn)) {
      const m = mul(vp.transform, ctm);
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => apply(m, x, y));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      imgs.push(R(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)));
    }
  }

  // --- text items -> lines (like PyMuPDF "lines")
  const items = [];
  for (const it0 of tc.items) {
    // the ₹ glyph comes through as a control / private-use character in these PDFs
    const raw = it0.str || "";
    const str = /^[\u0000-\u001f-]+$/.test(raw.trim()) && raw.trim().length === 1 ? "₹"
      : raw.replace(/[\u0000-\u001f-](?=\s*\d)/g, "₹").replace(/[\u0000-\u001f-]/g, "");
    const it = { ...it0, str };
    if (!it.str || !it.str.trim()) continue;
    const t = mul(vp.transform, it.transform);
    const size = Math.round(Math.hypot(t[2], t[3]) * 10) / 10;
    let fname = "";
    try { const f = page.commonObjs.get(it.fontName); fname = (f && (f.name || f.loadedName)) || ""; } catch { fname = ""; }
    fname = fname.replace(/^[A-Z]{6}\+/, "");
    const x0 = t[4], base = t[5];
    items.push({ str: it.str, x0, x1: x0 + it.width, base, size, font: fname });
  }
  // 1) rows: items whose baselines are within a small tolerance; 2) inside a row, join left→right,
  // starting a new line where there is a wide horizontal gap (separate columns)
  items.sort((a, b) => a.base - b.base || a.x0 - b.x0);
  const rowsOfItems = [];
  for (const it of items) {
    const r = rowsOfItems[rowsOfItems.length - 1];
    // compare with the previous item (not the row's first) so small baseline drifts stay together
    if (r && Math.abs(r.base - it.base) < Math.max(1.2, it.size * 0.3)) { r.items.push(it); r.base = it.base; }
    else rowsOfItems.push({ base: it.base, items: [it] });
  }
  const groups = [];
  for (const r of rowsOfItems) {
    r.items.sort((a, b) => a.x0 - b.x0);
    let g = null;
    for (const it of r.items) {
      if (g && it.x0 - g.x1 < Math.max(g.size, it.size) * 1.2) {
        // a glyph printed twice on top of itself (e.g. "1,230" + "0" over the last digit) – keep one copy
        if (it.x0 < g.x1 - 0.5 && g.str.trimEnd().endsWith(it.str.trim())) continue;
        if (it.x0 - g.x1 > it.size * 0.15 && !g.str.endsWith(" ") && !it.str.startsWith(" ")) g.str += " ";
        g.str += it.str; g.x1 = Math.max(g.x1, it.x1);
        if (!g.alnum && /[A-Za-z0-9]/.test(it.str)) g.alnum = it;
      } else {
        g = { ...it, first: it, alnum: /[A-Za-z0-9]/.test(it.str) ? it : null };
        groups.push(g);
      }
    }
  }
  const L = [];
  for (const g of groups) {
    const t = g.str.replace(/\s+/g, " ").trim();
    if (!t || g.x0 < 0 || g.x0 > W) continue;
    const f = g.alnum || g.first;
    L.push({
      t, x0: g.x0, x1: g.x1, y0: f.base - f.size * 0.95, y1: f.base + f.size * 0.25,
      size: f.size, font: f.font, bold: /Bold|Medium|SemiBold/.test(f.font),
    });
  }
  L.sort((a, b) => Math.round(a.y0) - Math.round(b.y0) || a.x0 - b.x0);
  const text = L.map((l) => l.t).join("\n");
  return { L, W, H, imgs, text };
}

function productImages(pg) {
  const { W, H } = pg;
  const out = [];
  for (const r0 of pg.imgs) {
    const r = R(Math.max(0, r0.x0), Math.max(0, r0.y0), Math.min(W, r0.x1), Math.min(H, r0.y1));
    if (rw(r) < 4 || rh(r) < 4 || rw(r) > W - 20) continue;
    if (rw(r) * rh(r) > 0.25 * W * H) continue;
    if (Math.abs(rw(r) - rh(r)) < 4 && rw(r) < 45) continue;
    out.push(r);
  }
  return out;
}
function unionIn(rects, x0, y0, x1, y1) {
  let out = null;
  for (const r of rects) {
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
    if (x0 <= cx && cx <= x1 && y0 <= cy && cy <= y1) out = out ? runion(out, r) : { ...r };
  }
  return out;
}
function nearestImg(rects, x, y, limit = 200) {
  let best = limit, out = null;
  for (const r of rects) {
    if (rh(r) > 400) continue;
    const d = Math.hypot((r.x0 + r.x1) / 2 - x, (r.y0 + r.y1) / 2 - y);
    if (d < best) { best = d; out = r; }
  }
  return out;
}

// ---------------------------------------------------------------- generic pages (code anchors)
function genericPage(pg, coll, st) {
  const { L, H } = pg;
  for (const l of L) {
    if (coll === "KLASSIC") {
      if (l.size === 15 && l.y0 < 110) st.series = pyTitle(l.t);
      if (l.size === 12 && l.y0 < 45 && !l.bold) st.category = pyTitle(l.t);
    } else {
      if (l.size >= 20 && l.y0 < 80) st.category = pyTitle(l.t);
      if (l.size >= 14 && l.size < 20 && l.y0 > 80 && l.y0 < 120) st.series = pyTitle(l.t);
    }
  }
  const codes = L.filter((l) => CODE_LINE.test(l.t) && l.bold && l.size >= (coll === "KLASSIC" ? 7 : 8.5));
  const prices = [];
  for (const l of L) {
    let t = l.t;
    if (coll === "KLASSIC") {
      if (/^Per Piece$/i.test(t)) {
        const nxt = L.filter((k) => k.y0 - l.y0 > 0 && k.y0 - l.y0 < 10 && Math.abs(k.x0 - l.x0) < 10);
        if (nxt.length) t = "Per Piece " + nxt[0].t;
      }
      const m = t.match(new RegExp(`Per Piece\\s*${RUPEE}?\\s*((?:${NUM})(?:\\s*/\\s*(?:${NUM}))*)`, "i"));
      if (m) prices.push({ ...l, vals: m[1].split(/\s*\/\s*/).map(toInt), flag: suspicious(m[1]) });
    } else {
      const m = t.match(new RegExp(`^${RUPEE}?\\s*(${NUM})$`));
      if (m && l.bold && l.size >= 8.5 && l.y0 < H - 60) prices.push({ ...l, vals: [toInt(m[1])], flag: suspicious(m[1]) });
    }
  }
  const pairs = [];
  prices.forEach((p, pi) => codes.forEach((c, ci) => {
    const dy = p.y0 - c.y0, dx = p.x0 - c.x0;
    let cost;
    if (Math.abs(dy) < 4 && dx > 0) cost = dx * 0.05;
    else if (Math.abs(dy) < 24 && dx > 150 && coll === "AURUM") cost = 20 + Math.abs(dy);
    else if (dy > 0 && dy < 90 && Math.abs(dx) < 25) cost = dy;
    else return;
    pairs.push([cost, pi, ci]);
  }));
  pairs.sort((a, b) => a[0] - b[0]);
  const usedP = new Set(), usedC = new Set(), link = new Map();
  for (const [, pi, ci] of pairs) {
    if (usedP.has(pi) || usedC.has(ci)) continue;
    usedP.add(pi); usedC.add(ci); link.set(ci, pi);
  }
  const imgs = productImages(pg);
  const items = [], problems = [];
  if (prices.length !== usedP.size) problems.push(`${prices.length - usedP.size} price(s) not linked to a code`);
  codes.forEach((c, ci) => {
    if (!link.has(ci)) { problems.push(`code ${c.t} has no price`); return; }
    const p = prices[link.get(ci)];
    let nameLines = [], lastY = c.y1;
    for (const l of L) {
      if (l.y0 <= c.y0 + 1 || Math.abs(l.x0 - c.x0) > 3) continue;
      if (l.y0 - lastY > 16) break;
      if (CODE_LINE.test(l.t) && l.bold) { lastY = l.y1; continue; }
      if (new RegExp(`Per Piece|^${RUPEE}?\\s*(${NUM})$`).test(l.t)) {
        if (coll === "KLASSIC") break;
        lastY = l.y1; continue;
      }
      nameLines.push(l); lastY = l.y1;
    }
    if (coll === "KLASSIC") {
      const extra = L.filter((l) => Math.abs(l.x0 - c.x0) <= 3 && l.y0 > c.y1 && l.y0 < p.y0 && !nameLines.includes(l) && !CODE_LINE.test(l.t));
      if (extra.length) nameLines = [...new Set([...nameLines, ...extra])].sort((a, b) => a.y0 - b.y0);
    }
    let name = clean(nameLines.map((l) => l.t).join(" "));
    let details = "";
    const hm = name.match(/(Height\s*[:\-]?\s*\d+\s*mm)/i);
    if (hm) { details = hm[1]; name = clean(name.replace(hm[1], "")); }
    let img;
    if (coll === "KLASSIC") {
      const top = Math.max(...prices.filter((q) => Math.abs(q.x0 - c.x0) < 20 && q.y1 < c.y0).map((q) => q.y1), c.y0 - 170);
      img = unionIn(imgs, c.x0 - 15, top, c.x0 + 150, c.y0);
    } else {
      const col = codes.filter((o) => Math.abs(o.x0 - c.x0) < 20).sort((a, b) => a.y0 - b.y0);
      const i = col.indexOf(c);
      let a = i, b = i;
      while (a > 0 && col[a].y0 - col[a - 1].y0 < 20) a--;
      while (b < col.length - 1 && col[b + 1].y0 - col[b].y0 < 20) b++;
      const top = a > 0 ? (col[a - 1].y0 + col[a].y0) / 2 + 10 : col[a].y0 - 120;
      const bot = b < col.length - 1 ? (col[b + 1].y0 + col[b].y0) / 2 + 10 : col[b].y0 + 120;
      img = unionIn(imgs, 0, top, c.x0 - 2, bot);
    }
    if (!img) img = nearestImg(imgs, c.x0, c.y0);
    const [ctext, extraName] = codePart(c.t);
    if (extraName) name = clean(`${name} (${extraName})`);
    let codelist = expandCodes(ctext);
    const flag = p.flag ? "Price looks mis-printed in PDF - verify" : "";
    if (p.vals.length > 1 && codelist.length === p.vals.length) {
      let sizes = name.match(/\d+\s*["”]\s*-\s*[\dX\. ]+mm/g) || [];
      let base = clean(name.replace(/\d+\s*["”]\s*-\s*[\dX\. ]+mm\)?/g, ""));
      if (!sizes.length) {
        const m2 = name.match(/(\d+(?:\.\d+)?["”](?:\s*\/\s*\d+(?:\.\d+)?["”])+)/);
        if (m2) {
          sizes = m2[1].split("/").map((s) => s.trim());
          base = clean(clean(name.replace(m2[1], "")).replace(/\bPer Piece\b.*$/, ""));
        }
      }
      codelist.forEach((cd, i) => items.push({
        code: cd, alt_codes: [], name: base, details: sizes[i] || "",
        variant: sizes[i] ? sizes[i].split("-")[0].trim() : "", mrp: p.vals[i], img, flag,
      }));
      return;
    }
    if (coll === "AURUM" && codelist.length > 1) codelist = [codelist[codelist.length - 1], ...codelist.slice(0, -1)];
    p.vals.forEach((val, vi) => items.push({
      code: codelist[0], alt_codes: codelist.slice(1), name, details,
      variant: p.vals.length === 1 ? "" : `Option ${vi + 1}`, mrp: val, img, flag,
    }));
  });
  return { items, problems, n: prices.length };
}

// ---------------------------------------------------------------- Klassic sanitaryware blocks
function klassicBlocksPage(pg, st) {
  const { L, W, H } = pg;
  for (const l of L) if (l.size >= 14 && !l.bold && l.y0 < 140 && isTitle(l.t)) st.series = pyTitle(l.t);
  const heads = [];
  for (const l of L) {
    if (l.bold && l.size <= 8 && HEADER.test(l.t)) heads.push(l);
    else if (l.bold && l.size <= 8 && CODE_LINE.test(l.t)) {
      const above = L.filter((k) => k !== l && l.y0 - k.y0 > 0 && l.y0 - k.y0 < 16 && Math.abs(k.x0 - l.x0) < 8);
      if (!above.length) heads.push(l);
    }
  }
  const titles = L.filter((l) => l.size >= 14 && !l.bold && isTitle(l.t));
  const allTokens = L.filter((l) => l.size <= 8).reduce((a, l) => a + (l.t.match(PRICE_IN_G()) || []).length, 0);
  const items = [], problems = [];
  let assigned = 0;
  const imgs = productImages(pg);
  for (const h of heads) {
    const m = h.t.match(HEADER);
    let pname, codes;
    if (m) { pname = pyTitle(m.groups.name.trim()); codes = splitCodes(m.groups.codes); }
    else { pname = ""; codes = expandCodes(h.t); }
    const right = Math.min(...heads.filter((o) => o.x0 > h.x0 + 100).map((o) => o.x0), W + 10) - 10;
    const below = Math.min(...heads.concat(titles).filter((o) => o !== h && o.y0 > h.y0 + 5 && o.x0 < right &&
      (titles.includes(o) || Math.abs(o.x0 - h.x0) < 60)).map((o) => o.y0), H - 12);
    let sub = st.series;
    for (const t of titles) if (t.y0 < h.y0 && Math.abs(t.x0 - 30) < 30) sub = pyTitle(t.t);
    const blk = L.filter((l) => l !== h && l.y0 > h.y0 + 2 && l.y0 < below && l.x0 >= h.x0 - 4 && l.x0 < right &&
      l.size <= 8 && !l.t.startsWith("* Products") && !/^\d{1,3}$/.test(l.t));
    const rows = [];
    for (const l of [...blk].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
      if (rows.length && Math.abs(rows[rows.length - 1].y0 - l.y0) < 2.5) rows[rows.length - 1].parts.push(l);
      else rows.push({ y0: l.y0, parts: [l] });
    }
    const textRows = rows.map((r) => r.parts.sort((a, b) => a.x0 - b.x0).map((p) => p.t).join(" ")).filter((t) => t.trim() !== "White");
    const opts = [];
    let pending = [], curCode = codes[0];
    const segs = [];
    for (const txt of textRows) {
      const pieces = txt.split(new RegExp(`(${PMARK}\\s*(?:${NUM}))`));
      if (pieces.length <= 3) { segs.push(txt); continue; }
      for (let i = 0; i < pieces.length - 1; i += 2) segs.push((pieces[i] + pieces[i + 1]).trim());
      if (pieces[pieces.length - 1].trim()) segs.push(pieces[pieces.length - 1].trim());
    }
    for (let txt of segs) {
      let rowCode = null;
      const mc = txt.match(new RegExp(`^(?:Also available\\s+)?(${CODE})(\\s*:\\s*|\\s*$|\\s+(?=[A-Z][a-z]))(.*)$`));
      if (mc && !/^KS\d+E?$|^KSPKP|^KSMV|^KS0/.test(mc[1])) {
        const rest = mc[3];
        if (txt.startsWith("Also") || !rest) {
          curCode = mc[1];
          txt = rest;
          if (!txt) { pending = []; continue; }
        } else if (PRICE_IN.test(rest)) { rowCode = mc[1]; txt = rest; }
      }
      const ps = txt.match(PRICE_IN_G()) || [];
      let label = clean(txt.replace(PRICE_IN_G(), ""));
      if (!ps.length) { pending.push(label); continue; }
      const val = ps[0].match(new RegExp(NUM))[0];
      label = clean(label.replace(/\b(White\s+)?(Per Piece|per piece)\b/gi, ""));
      if (/^White$/i.test(label)) label = "";
      if (rowCode) label = clean(`${rowCode}: ${label}`);
      opts.push({ label, before: pending, price: toInt(val), code: rowCode || curCode, flag: suspicious(val) });
      pending = [];
    }
    if (pending.length && opts.length) opts[opts.length - 1].after = pending;
    assigned += opts.length;
    const prevBottom = Math.max(...heads.concat(titles).filter((o) => o.y0 < h.y0 - 20 && Math.abs(o.x0 - h.x0) < 60).map((o) => o.y0), h.y0 - 260);
    const top = Math.max(prevBottom + 20, h.y0 - 260);
    const img = unionIn(imgs, h.x0 - 20, top, Math.min(h.x0 + 145, right), h.y0);
    if (!opts.length) problems.push(`${h.t}: no price found`);
    items.push({ head: h.t, name: pname, codes, sub, rows: textRows, opts, img });
  }
  if (assigned !== allTokens) problems.push(`price tokens on page ${allTokens}, assigned ${assigned}`);
  return { items, problems, n: allTokens };
}

function tablePage(pg, st) {
  const { L } = pg;
  for (const l of L) if (l.size >= 14 && l.y0 < 140) st.series = pyTitle(l.t);
  const out = [];
  for (const c of L.filter((l) => CODE_LINE.test(l.t) && l.bold && l.x0 < 150)) {
    const row = L.filter((l) => Math.abs(l.y0 - c.y0) < 4 && l !== c);
    const price = row.filter((l) => PRICE_IN.test(l.t));
    const desc = row.filter((l) => !price.includes(l)).map((l) => l.t);
    if (price.length) out.push({ code: c.t.replace(/\*$/, ""), name: clean(desc.join(" ")), mrp: toInt(price[0].t.match(PRICE_IN)[1]) });
  }
  return out;
}

function vanityPage(pg) {
  const { L, W } = pg;
  const codes = L.filter((l) => /^KAJ\d{4}(-[A-Z]+)?\*?$/.test(l.t));
  const out = [];
  for (const c of codes) {
    const above = L.filter((l) => c.y0 - l.y0 > 3 && c.y0 - l.y0 < 30 && Math.abs(l.x0 - c.x0) < 6 && isUpper(l.t)).sort((a, b) => (c.y0 - a.y0) - (c.y0 - b.y0));
    const name = above.length ? pyTitle(above[0].t) : "";
    const near = L.filter((l) => l.y0 - c.y0 > -2 && l.y0 - c.y0 < 140 && l.x0 - c.x0 > -5 && l.x0 - c.x0 < 260 && l !== c);
    const prices = L.filter((l) => new RegExp(`^${RUPEE}?\\s*(${NUM})$`).test(l.t) && l.y0 > c.y0)
      .sort((a, b) => ((a.y0 - c.y0) + Math.abs(a.x0 - c.x0) * 0.5) - ((b.y0 - c.y0) + Math.abs(b.x0 - c.x0) * 0.5));
    if (!prices.length) continue;
    const valAfter = (label) => {
      for (const l of L) {
        if (l.t.startsWith(label) && l.y0 - c.y0 > -5 && l.y0 - c.y0 < 140 && l.x0 - c.x0 > -5 && l.x0 - c.x0 < 260) {
          const rest = l.t.slice(label.length).replace(/^[\s:]+|[\s:]+$/g, "");
          if (rest) return rest;
          const b = L.filter((k) => k.y0 - l.y0 > 0 && k.y0 - l.y0 < 14 && Math.abs(k.x0 - l.x0) < 4);
          if (b.length) return b[0].t;
        }
      }
      return "";
    };
    const cab = valAfter("Cabinet Size"), mir = valAfter("Cabinet Mirror Size");
    const feat = near.find((l) => l.t.includes("Technology") || l.t.includes("LED"));
    out.push({ code: c.t.replace(/\*$/, ""), name, cab, mir, feat: feat ? feat.t : "", mrp: toInt(prices[0].t.match(new RegExp(NUM))[0]), c });
  }
  return out.map((it) => {
    const H = pg.H;
    const img = out.length === 1 ? R(40, 520, W - 40, it.c.y0 - 25 > 600 ? it.c.y0 - 25 : H - 40)
      : R(it.c.x0 < W / 2 ? 40 : W / 2, 520, it.c.x0 < W / 2 ? W / 2 : W - 40, it.c.y0 - 22);
    return { ...it, img };
  });
}

/** for troubleshooting a page: the text lines the reader sees */
export async function debugPage(url, pn) {
  const doc = await pdfjs.getDocument({ url, isEvalSupported: false }).promise;
  return readPage(await doc.getPage(pn));
}

// ---------------------------------------------------------------- whole document

export async function parsePriceList(file, coll, onProgress = () => {}) {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const products = [], problems = [];
  const st = { series: "", category: coll === "KLASSIC" ? "Faucet" : coll === "VANITY" ? "Vanity" : "" };
  const add = (pn, o) => products.push({
    collection: coll, category: o.category, sub_category: o.sub, series: o.series, code: o.code,
    alt_codes: o.alt_codes || [], name: o.name, variant: o.variant || "", details: o.details || "",
    finish: o.finish || "", colour: o.colour || "", mrp: o.mrp, unit: "Piece", page: pn,
    flag: o.flag || "", _crop: o.img ? { page: pn, rect: o.img } : null,
  });
  for (let pn = 1; pn <= doc.numPages; pn++) {
    onProgress(pn, doc.numPages);
    const page = await doc.getPage(pn);
    const pg = await readPage(page);
    page.cleanup();
    if (/GREEN PRO|certified by GREEN/i.test(pg.text)) continue;
    if (coll === "VANITY") {
      for (const it of vanityPage(pg)) {
        const details = [it.cab && `Cabinet ${it.cab}`, it.mir && `Mirror ${it.mir}`, it.feat].filter(Boolean).join("; ");
        add(pn, { category: "Vanity", sub: "Vanity", series: it.name, code: it.code, name: `${it.name} Vanity Set`.trim(),
          mrp: it.mrp, details, img: it.img, flag: it.name ? "" : "Name not found - check" });
      }
      continue;
    }
    if (coll === "KLASSIC" && pg.L.some((l) => HEADER.test(l.t) && l.bold && l.size <= 8)) {
      st.category = "Sanitaryware";
      const { items, problems: pr } = klassicBlocksPage(pg, st);
      for (const it of items) {
        const opts = it.opts;
        const trapVaries = opts.slice(1).some((o) => o.before.join(" ").includes("Trap"));
        let desc = [];
        if (opts.length) {
          const b0 = opts[0].before;
          let k = b0.findIndex((x) => /^(with|Box Rim)\b/i.test(x));
          if (k < 0) k = b0.length;
          desc = b0.slice(0, k).filter((x) => !(trapVaries && x.includes("Trap")));
        }
        opts.forEach((o, oi) => {
          const before = o.before.filter((x) => !desc.includes(x) && !(SPEC.test(x) && !(trapVaries && x.includes("Trap"))));
          const variant = oi === 0 && !o.before.length && o.label ? o.label : clean([...before, ...(o.label ? [o.label] : [])].join(" "));
          const nm = it.name ? `${it.name} ${it.sub}`.trim() : (desc[0] || it.sub);
          add(pn, {
            category: "Sanitaryware", series: it.name || it.sub, sub: it.sub, code: o.code, name: nm, mrp: o.price, img: it.img,
            alt_codes: o.code === it.codes[0] ? it.codes.filter((c) => c !== o.code) : [],
            variant: clean(variant).replace(/`/g, "₹"),
            details: desc.join("; ") || it.rows.filter((r) => SPEC.test(r) && !PRICE_IN.test(r)).map(clean).join("; "),
            flag: o.flag ? "Price looks mis-printed in PDF - verify" : "",
            colour: it.head.includes("White") || it.rows.join(" ").includes("White") ? "White" : "",
          });
        });
      }
      pr.forEach((x) => problems.push(`Page ${pn}: ${x}`));
      continue;
    }
    if (coll === "KLASSIC" && /\bCODE\b/.test(pg.text) && /\bPRICE\b/.test(pg.text)) {
      for (const it of tablePage(pg, st)) add(pn, { category: "Sanitaryware", series: st.series, sub: st.series, code: it.code, name: it.name, mrp: it.mrp });
      continue;
    }
    const { items, problems: pr, n } = genericPage(pg, coll, st);
    if (!items.length && !n) continue;
    for (const it of items) {
      add(pn, {
        category: st.category, series: st.series, sub: st.series, code: it.code, alt_codes: it.alt_codes,
        name: coll === "AURUM" && isUpper(it.name) ? pyTitle(it.name) : it.name,
        variant: it.variant, details: it.details, mrp: it.mrp, img: it.img, flag: it.flag,
        finish: coll === "AURUM" ? finishOf(it.code) : "",
      });
    }
    pr.forEach((x) => problems.push(`Page ${pn}: ${x}`));
  }
  const guess = file.name.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*\d{4}/i);
  return { products, problems, pages: doc.numPages, doc, guessName: guess ? guess[0] : "" };
}

// ---------------------------------------------------------------- compare & apply

const vkey = (p) => `${p.code}|${String(p.variant || "").toLowerCase().replace(/[^a-z0-9]/g, "")}`;

export function diffPriceList(current, coll, parsed) {
  const old = current.filter((p) => p.collection === coll);
  const byKey = new Map();
  for (const p of old) { const k = vkey(p); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(p); }
  const byCode = new Map();
  for (const p of old) { if (!byCode.has(p.code)) byCode.set(p.code, []); byCode.get(p.code).push(p); }
  const used = new Set();
  const changed = [], added = [], matches = [];
  let same = 0;
  const pending = [];
  for (const n of parsed) {
    const cands = (byKey.get(vkey(n)) || []).filter((p) => !used.has(p));
    if (cands.length) { const o = cands[0]; used.add(o); matches.push([o, n]); continue; }
    pending.push(n);
  }
  for (const n of pending) {   // the option text changed a little: fall back to the code alone
    const cands = (byCode.get(n.code) || []).filter((p) => !used.has(p));
    if (cands.length === 1) { used.add(cands[0]); matches.push([cands[0], n]); }
    else added.push(n);
  }
  for (const [o, n] of matches) {
    if (o.mrp !== n.mrp) changed.push({ old: o, new: n });
    else same++;
  }
  const missing = old.filter((p) => !used.has(p));
  return { changed, added, missing, matches, same };
}

async function renderCrop(doc, crop) {
  const page = await doc.getPage(crop.page);
  const r = crop.rect;
  const pad = 2;
  const x0 = Math.max(0, r.x0 - pad), y0 = Math.max(0, r.y0 - pad);
  const w = (r.x1 - r.x0) + 2 * pad, h = (r.y1 - r.y0) + 2 * pad;
  const scale = Math.max(1.5, Math.min(300 / 72, 800 / Math.max(w, h)));
  const vp = page.getViewport({ scale, offsetX: -x0 * scale, offsetY: -y0 * scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(w * scale); canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  // "print" intent renders without waiting for screen repaints, so it also works in a background tab
  await page.render({ canvasContext: ctx, viewport: vp, intent: "print" }).promise;
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.88));
}

export async function applyPriceList(current, meta, pending, { dropMissing = false } = {}) {
  const { coll, name, parsed, diff } = pending;
  const list = current.map((p) => ({ ...p }));
  const byRef = new Map(current.map((p, i) => [p, list[i]]));
  for (const [o, n] of diff.matches) {
    const p = byRef.get(o);
    p.mrp = n.mrp;
    p.price_list = name;
    p.flag = n.flag || "";
    if (!p.image && n._crop) {
      try { p.image = await putImage(`${coll}-${p.id}-${Date.now()}`, await renderCrop(parsed.doc, n._crop)); } catch {}
    }
  }
  const ids = new Set(list.map((p) => p.id));
  for (const n of diff.added) {
    let id = n.code.replace(/[^A-Za-z0-9-]/g, "_"), k = 1;
    while (ids.has(id)) id = `${n.code.replace(/[^A-Za-z0-9-]/g, "_")}__${++k}`;
    ids.add(id);
    let image = "";
    if (n._crop) {
      try { image = await putImage(`${coll}-${id}-${Date.now()}`, await renderCrop(parsed.doc, n._crop)); } catch {}
    }
    const { _crop, ...rest } = n;
    list.push({ ...rest, id, price_list: name, source: `${name} p.${n.page}`, image });
  }
  let out = list;
  if (dropMissing) {
    const gone = new Set(diff.missing.map((o) => byRef.get(o)));
    out = list.filter((p) => !gone.has(p));
  }
  const m = JSON.parse(JSON.stringify(meta));
  m.lists[coll] = { name, updated: new Date().toISOString(), count: out.filter((p) => p.collection === coll).length };
  return { list: out, meta: m };
}
