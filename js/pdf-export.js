// PDF export: draws the quotation with the same geometry, colours and fonts as the Excel
// template printed on A4 (Carlito = metric-compatible Calibri, includes the ₹ sign).
import { calcLine, calcQuote, fmtDate, inr, loadImageScaled } from "./common.js";
import { imageURL } from "./store.js";

const A4 = { w: 595.28, h: 841.89 };
const M = 28;                                   // page margin (pt)
// column widths in Excel pixels (same as the exported Excel: wider photo column, slimmer Qty / Disc.%)
const COLS_PX = [61, 71, 85, 133, 100, 61, 42, 42, 61, 61];
const TOTAL_PX = COLS_PX.reduce((a, b) => a + b, 0);
const K = (A4.w - 2 * M) / TOTAL_PX;            // pt per Excel pixel (≈ Excel's own fit-to-width)
const RK = K * 96 / 72;                         // template row points -> PDF points
const EMU_PX = 9525;

const C = {
  navy: [31, 78, 120], tx2: [31, 73, 125], tcHead: [23, 54, 93], ink: [28, 39, 51],
  even: [244, 248, 253], odd: [227, 237, 249],      // light blues for the alternating product rows
  band: [231, 239, 255], hdr2: [243, 243, 255],
  totals: [198, 217, 240], white: [255, 255, 255], line: [0, 0, 0],
};
const THIN = 0.45, MEDIUM = 1.0;

let fontsLoaded = null;
async function fontData() {
  if (fontsLoaded) return fontsLoaded;
  const get = async (u) => {
    const b = new Uint8Array(await (await fetch(u)).arrayBuffer());
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  };
  fontsLoaded = { reg: await get("assets/fonts/Carlito-Regular.ttf"), bold: await get("assets/fonts/Carlito-Bold.ttf") };
  return fontsLoaded;
}

const colX = (() => { const xs = [M]; for (const w of COLS_PX) xs.push(xs[xs.length - 1] + w * K); return xs; })();
const colW = (i) => COLS_PX[i] * K;
const RIGHT = colX[10];
// drawing anchors in the template were saved where a column of width 8.73 = 64 px (609600 EMU)
const anchorX = (col, offEmu) => colX[col] + (offEmu / (COLS_PX[col] * EMU_PX * 64 / 61)) * colW(col);
const anchorY = (rowTop, offEmu) => rowTop + (offEmu / 12700) * RK;

export async function buildPdf(q, settings, onProgress = () => {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const f = await fontData();
  doc.addFileToVFS("Carlito-Regular.ttf", f.reg); doc.addFont("Carlito-Regular.ttf", "Carlito", "normal");
  doc.addFileToVFS("Carlito-Bold.ttf", f.bold); doc.addFont("Carlito-Bold.ttf", "Carlito", "bold");
  doc.setProperties({ title: `Quotation ${q.number || ""} - ${q.customer || ""}`, creator: "Kerovit Quotation Maker" });

  const font = (style, sizePt, color = C.ink) => { doc.setFont("Carlito", style); doc.setFontSize(sizePt); doc.setTextColor(...color); };
  const fill = (x, y, w, h, rgb) => { doc.setFillColor(...rgb); doc.rect(x, y, w, h, "F"); };
  const line = (x1, y1, x2, y2, lw) => { doc.setLineWidth(lw); doc.setDrawColor(...C.line); doc.line(x1, y1, x2, y2); };
  const box = (x, y, w, h, lw) => { doc.setLineWidth(lw); doc.setDrawColor(...C.line); doc.rect(x, y, w, h, "S"); };

  // logos (Kerovit logo is cropped exactly like the template does)
  const kajaria = await loadImageScaled("assets/logo-kajaria.png", 1400, "image/png");
  const kerovit = await loadImageScaled("assets/logo-kerovit.png", 900, "image/png", 1,
    { l: 0.07529, t: 0.23058, r: 0.06354, b: 0.24236 });
  // logo kept at its true proportions, right edge on the template anchor
  const logoRight = (img, alias, right, top, h) => {
    if (!img) return;
    const w = h * img.w / img.h;
    doc.addImage(img.dataURL, "PNG", right - w, top, w, h, alias, "FAST");
  };

  const F11 = 11 * RK, F9 = 9 * RK, F12 = 12 * RK;
  let y = M;
  let pageTop = M;

  // ---------------------------------------------------------------- row 1: logos
  const h1 = 85.5 * RK;
  fill(M, y, RIGHT - M, h1, C.band);
  const pic = (img, alias, c0, x0, y0, c1, x1, y1) => {
    if (!img) return;
    const ax = anchorX(c0, x0), ay = anchorY(y, y0);
    const bx = anchorX(c1, x1), by = anchorY(y, y1);
    doc.addImage(img.dataURL, "PNG", ax, ay, bx - ax, by - ay, alias, "FAST");
  };
  pic(kajaria, "kaj", 0, 95249, 101600, 3, 230980, 311150);
  logoRight(kerovit, "ker", anchorX(9, 546100), anchorY(y, 82550), anchorY(y, 718695) - anchorY(y, 82550));
  box(M, y, RIGHT - M, h1, MEDIUM);
  y += h1;

  // ---------------------------------------------------------------- row 2: customer text boxes
  const h2 = 72 * RK;
  fill(M, y, RIGHT - M, h2, C.hdr2);
  const tb = (col, offEmu, rowOffEmu, label, value, maxW) => {
    const x = colX[col] + (offEmu / EMU_PX) * K + 9.6 * K;
    const ty = y + (rowOffEmu / EMU_PX) * K + 4.8 * K + F11 * 0.85;
    font("bold", F11, C.tx2);
    doc.text(label, x, ty);
    const lw = doc.getTextWidth(label);
    if (value) {
      let fs = F11;
      font("normal", fs, C.ink);
      // first line continues after the label, following lines use the full box width
      const wrap = () => {
        const first = doc.splitTextToSize(String(value), maxW - lw)[0] || "";
        const rest = String(value).slice(first.length).trim();
        return [first, ...(rest ? doc.splitTextToSize(rest, maxW) : [])];
      };
      let lines = wrap();
      while (lines.length > 3 && fs > F11 * 0.75) { fs -= 0.5; font("normal", fs, C.ink); lines = wrap(); }
      if (lines.length > 1 && fs === F11) { fs = F11 * 0.88; font("normal", fs, C.ink); lines = wrap(); }
      lines.slice(0, 3).forEach((ln, i) => doc.text(ln, i === 0 ? x + lw : x, ty + i * fs * 1.15));
    }
  };
  const leftW = colX[5] - M - 12, rightW = RIGHT - colX[5] - 12;
  tb(0, 31750, 6350, "Quotation Date: ", fmtDate(q.date), leftW);
  tb(0, 38100, 317500, "Customer Name: ", q.customer, leftW);
  tb(0, 25400, 615950, "Quotation Type: ", q.type, leftW);
  tb(5, 69850, 0, "Project / Site Address: ", q.address, rightW);
  tb(5, 95250, 584200, "Mobile Number: ", q.mobile, rightW);
  y += h2;

  // ---------------------------------------------------------------- row 3: table header (repeated on each page)
  const h3 = 29 * RK;
  const heads = ["Sr. No.", "Collection / Series", "Model Code", "Product Name", "Product Image", "MRP", "Qty", "Disc.%", "Rate", "Total"];
  const drawHeader = () => {
    fill(M, y, RIGHT - M, h3, C.navy);
    font("bold", F11, C.white);
    heads.forEach((t, i) => {
      const lines = doc.splitTextToSize(t, colW(i) - 4);
      const lh = F11 * 1.05;
      const ty0 = y + h3 / 2 - ((lines.length - 1) * lh) / 2 + F11 * 0.32;
      lines.forEach((ln, j) => doc.text(ln, colX[i] + colW(i) / 2, ty0 + j * lh, { align: "center" }));
      box(colX[i], y, colW(i), h3, THIN);
    });
    y += h3;
  };
  drawHeader();

  const sideBorders = (from, to) => { line(M, from, M, to, MEDIUM); line(RIGHT, from, RIGHT, to, MEDIUM); };
  let segTop = pageTop;
  // column headings are repeated only when product rows continue on the new page
  const newPage = (withHeader = false) => {
    sideBorders(segTop, y);
    line(M, y, RIGHT, y, MEDIUM);
    doc.addPage("a4", "portrait");
    y = M; segTop = M;
    if (withHeader) drawHeader();
    else line(M, y, RIGHT, y, MEDIUM);
  };
  const BOTTOM = A4.h - M;

  // footer sizes (needed up front to decide how tall the product rows can be)
  const hs = 50 * RK * 0.5;
  const totRows = [14.5, 14.5, 15];
  const totH = totRows.reduce((a, r) => a + r * RK * 1.25, 0);
  font("normal", F11);
  const termLines = settings.terms.map((t) => doc.splitTextToSize(t, RIGHT - M - 8));
  const tlh = 14.5 * RK;
  font("bold", F11);
  const closing = (settings.closing || "").trim();
  const closingH = closing ? 30 : 0;     // navy banner at the bottom
  const tcH = 15.5 * RK + termLines.reduce((a, l) => a + l.length * tlh, 0) + 15 * RK + closingH;

  // ---------------------------------------------------------------- product rows
  // Few products: rows grow (up to 100 pt) to use the page, so the photos are bigger.
  // Many products: template row height, flowing over several pages.
  const minH = 50 * RK;
  const pad = 3;
  const space = BOTTOM - y - hs - totH - tcH;
  const nItems = q.items.length;
  const rowH = nItems && nItems * minH <= space ? Math.min(100, Math.max(minH, space / nItems)) : minH;
  for (let i = 0; i < q.items.length; i++) {
    onProgress(i, q.items.length);
    const it = q.items[i];
    const { rate, total } = calcLine(it);
    font("bold", F9);
    const cellLines = (txt, ci) => doc.splitTextToSize(String(txt || ""), colW(ci) - 2 * pad);
    const L = { B: cellLines(it.series, 1), C: cellLines(it.code, 2), D: cellLines(it.label, 3) };
    const lh = F9 * 1.18;
    const need = Math.max(L.B.length, L.C.length, L.D.length) * lh + 2 * pad + 2;
    const h = Math.max(rowH, need);
    if (y + h > BOTTOM) newPage(true);

    const bg = i % 2 === 0 ? C.even : C.odd;
    fill(M, y, RIGHT - M, h, bg);
    font("bold", F9);
    const mid = y + h / 2;
    const vText = (lines, ci, align = "center") => {
      const ty0 = mid - ((lines.length - 1) * lh) / 2 + F9 * 0.33;
      const x = align === "center" ? colX[ci] + colW(ci) / 2 : align === "right" ? colX[ci + 1] - pad : colX[ci] + pad;
      lines.forEach((ln, j) => doc.text(ln, x, ty0 + j * lh, { align }));
    };
    vText([String(i + 1)], 0);
    vText(L.B, 1); vText(L.C, 2); vText(L.D, 3);
    const fit = (s, ci, align = "right") => {   // like Excel "shrink to fit" for the narrow amount columns
      font("bold", F9);
      const avail = colW(ci) - 2 * pad, w = doc.getTextWidth(s);
      if (w > avail) doc.setFontSize(F9 * avail / w);
      vText([s], ci, align);
      font("bold", F9);
    };
    fit("₹" + inr(it.mrp), 5);
    fit(String(it.qty), 6, "center");
    fit(String(Number(it.disc) || 0), 7, "center");
    fit("₹" + inr(rate), 8);
    fit("₹" + inr(total), 9);

    // photo
    const url = await imageURL({ image: it.image });
    const img = await loadImageScaled(url, 800, "image/jpeg", 0.92);
    if (img) {
      const bw = colW(4) - 6, bh = Math.min(h, 100) - 6;
      const k = Math.min(bw / img.w, bh / img.h);
      const w = img.w * k, hh = img.h * k;
      doc.addImage(img.dataURL, "JPEG", colX[4] + (colW(4) - w) / 2, y + (h - hh) / 2, w, hh, undefined, "FAST");
    }
    for (let c = 0; c < 10; c++) box(colX[c], y, colW(c), h, THIN);
    y += h;
  }

  // white spacer row (template row 28)
  if (y + hs > BOTTOM) newPage();
  fill(M, y, RIGHT - M, hs, C.white);
  for (let c = 0; c < 10; c++) { line(colX[c + 1], y, colX[c + 1], y + hs, THIN); }
  y += hs;

  // ---------------------------------------------------------------- totals
  const tot = calcQuote(q, settings.gst);
  const rows = [
    ["TOTAL AMOUNT", tot.sub, totRows[0]],
    [`ADD GST @ ${settings.gst}%`, tot.gst, totRows[1]],
    ["TOTAL AMOUNT INCLUDING TAXES", tot.grand, totRows[2]],
  ];
  if (y + totH > BOTTOM) newPage();
  line(M, y, RIGHT, y, MEDIUM);
  for (const [label, val, ht] of rows) {
    const h = ht * RK * 1.25;
    fill(M, y, RIGHT - M, h, C.totals);
    font("bold", F11, C.ink);
    doc.text(label, colX[9] - 3, y + h / 2 + F11 * 0.33, { align: "right" });
    const s = "₹" + inr(val), avail = colW(9) - 4, w = doc.getTextWidth(s);
    if (w > avail) doc.setFontSize(F11 * avail / w);
    doc.text(s, RIGHT - 2, y + h / 2 + F11 * 0.33, { align: "right" });
    line(colX[9], y, colX[9], y + h, THIN);
    line(M, y + h, RIGHT, y + h, THIN);
    y += h;
  }
  line(M, y, RIGHT, y, MEDIUM);

  // ---------------------------------------------------------------- terms & conditions
  if (y + tcH > BOTTOM) newPage();
  const tcTop = y;
  fill(M, y, RIGHT - M, tcH, C.band);
  font("bold", F12, C.tcHead);
  doc.text("TERMS & CONDITIONS", M + 3, y + 15.5 * RK * 0.78);
  y += 15.5 * RK;
  font("normal", F11, C.ink);
  const termTops = [];
  for (const lines of termLines) {
    termTops.push(y);
    for (const ln of lines) { doc.text(ln, M + 3, y + tlh * 0.78); y += tlh; }
  }
  if (termTops.length >= 10) {
    // template anchor: term 8 to term 10, right edge in column J; same crop as the template
    const ay = anchorY(termTops[7], 69851), by = anchorY(termTops[9], 156253);
    logoRight(kerovit, "ker", anchorX(9, 527050), ay, by - ay);
  }
  y += 15 * RK;
  if (closing) {
    // closing banner: white bold text on navy, the tagline "Bathrooms You Desire" heavier
    fill(M, y, RIGHT - M, closingH, C.navy);
    const m = closing.match(/bathrooms you desire/i);
    const parts = m ? [[closing.slice(0, m.index), false], [m[0], true], [closing.slice(m.index + m[0].length), false]]
      : [[closing, false]];
    let fs = F11 * 1.05;
    const width = () => parts.reduce((a, [t, em]) => { font("bold", em ? fs * 1.06 : fs); return a + doc.getTextWidth(t); }, 0);
    while (width() > RIGHT - M - 16 && fs > 6) fs -= 0.25;
    let x = (M + RIGHT) / 2 - width() / 2;
    const base = y + closingH / 2 + fs * 0.33;
    for (const [t, em] of parts) {
      if (!t) continue;
      font("bold", em ? fs * 1.06 : fs, C.white);
      if (em) {   // extra-bold: fill and outline the letters
        doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.45);
        doc.text(t, x, base, { renderingMode: "fillThenStroke" });
        doc.setDrawColor(...C.line);
      } else doc.text(t, x, base);
      x += doc.getTextWidth(t);
    }
    y += closingH;
  }
  line(M, tcTop, RIGHT, tcTop, MEDIUM);
  line(M, y, RIGHT, y, MEDIUM);
  sideBorders(segTop, y);

  // page numbers when the quotation runs over several pages
  const n = doc.getNumberOfPages();
  if (n > 1) {
    for (let p = 1; p <= n; p++) {
      doc.setPage(p);
      font("normal", 8, [120, 130, 140]);
      doc.text(`Page ${p} of ${n}`, RIGHT, A4.h - 12, { align: "right" });
    }
  }
  return doc.output("blob");
}
