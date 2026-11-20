// PDF export: draws the quotation with the same geometry, colours and fonts as the Excel
// template printed on A4 (Carlito = metric-compatible Calibri, includes the ₹ sign).
import { calcLine, calcQuote, fmtDate, inr, loadImageScaled, amountInWords } from "./common.js";
import { imageURL, TERMS_TITLE, MAKER_FIELDS } from "./store.js";

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
  const SUM_ROW_H = 15 * RK * 1.2;                 // each totals line (template row height, a little air)
  const totH = SUM_ROW_H * 6;                      // 5 totals + amount in words
  // T&C block (same row heights as the Excel): title, one row per line, gap, two "made by" rows, banner
  const TITLE_H = 26 * RK, TERM_H = 18 * RK, GAP_H = 8 * RK, DET_H = 32 * RK;
  const terms = settings.terms || [];
  const closing = (settings.closing || "").trim();
  const closingH = closing ? 30 : 0;     // navy banner at the bottom
  const tcH = TITLE_H + terms.length * TERM_H + GAP_H + 2 * DET_H + closingH;

  // ---------------------------------------------------------------- product rows
  // Few products: rows grow (up to 100 pt) to use the page, so the photos are bigger.
  // Many products: template row height, flowing over several pages.
  const minH = 50 * RK;
  const pad = 3;
  const space = BOTTOM - y - hs - totH - tcH - 6;
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
  // Totals one below another, like the template: label right-aligned, amount in the last column,
  // then the amount in words on the last line.
  const tot = calcQuote(q, settings.gst);
  const rows = [
    ["Total Quantity", String(tot.qty)],
    ["Total MRP", "₹" + inr(tot.mrpTotal)],
    ["Total Taxable Amt", "₹" + inr(tot.sub)],
    [`Total TAX (GST ${settings.gst}%)`, "₹" + inr(tot.gst)],
    ["Net Amt", "₹" + inr(tot.net, 0)],
  ];
  if (y + totH > BOTTOM) newPage();
  const sumTop = y;
  const h = SUM_ROW_H;
  for (const [label, val] of rows) {
    fill(M, y, RIGHT - M, h, C.totals);
    font("bold", F11, C.ink);
    doc.text(label, colX[8] - 4, y + h / 2 + F11 * 0.33, { align: "right" });
    const avail = RIGHT - colX[8] - 6, w = doc.getTextWidth(val);
    if (w > avail) doc.setFontSize(F11 * avail / w);
    doc.text(val, RIGHT - 4, y + h / 2 + F11 * 0.33, { align: "right" });
    line(colX[8], y, colX[8], y + h, THIN);
    line(M, y + h, RIGHT, y + h, THIN);
    y += h;
  }
  // amount in words
  fill(M, y, RIGHT - M, h, C.totals);
  font("bold", F11, C.ink);
  const lab = "Amount (In Words): ";
  doc.text(lab, M + 4, y + h / 2 + F11 * 0.33);
  const lw = doc.getTextWidth(lab);
  font("normal", F11, C.ink);
  doc.text(amountInWords(tot.net), M + 4 + lw, y + h / 2 + F11 * 0.33);
  y += h;
  line(M, sumTop, RIGHT, sumTop, MEDIUM);
  line(M, y, RIGHT, y, MEDIUM);

  // ---------------------------------------------------------------- terms & conditions
  if (y + tcH > BOTTOM) newPage();
  const tcTop = y;
  fill(M, y, RIGHT - M, tcH - closingH, C.band);
  // title: centred, bold, underlined
  const FT = 14 * RK;
  font("bold", FT, C.tcHead);
  const tw = doc.getTextWidth(TERMS_TITLE), tx = (M + RIGHT) / 2 - tw / 2, ty = y + TITLE_H / 2 + FT * 0.33;
  doc.text(TERMS_TITLE, tx, ty);
  doc.setDrawColor(...C.tcHead); doc.setLineWidth(0.8); doc.line(tx, ty + 2, tx + tw, ty + 2); doc.setDrawColor(...C.line);
  y += TITLE_H;
  // "**bold**" segments; leading spaces indent the line; shrink a line that is too wide
  const rich = (text, x, baseY, size, maxW, color = C.ink) => {
    const segs = String(text).split(/(\*\*[^*]+\*\*)/).filter((s) => s !== "")
      .map((s) => /^\*\*[^*]+\*\*$/.test(s) ? [s.slice(2, -2), true] : [s, false]);
    let fs = size;
    const width = () => segs.reduce((a, [t, b]) => { font(b ? "bold" : "normal", fs); return a + doc.getTextWidth(t); }, 0);
    while (width() > maxW && fs > size * 0.7) fs -= 0.25;
    for (const [t, b] of segs) { font(b ? "bold" : "normal", fs, color); doc.text(t, x, baseY); x += doc.getTextWidth(t); }
  };
  const FTerm = 11.5 * RK;
  for (const ln of terms) {
    const lead = ln.match(/^\s*/)[0].length;
    font("normal", FTerm);
    const indent = lead ? doc.getTextWidth(" ") * lead * 1.6 : 0;
    rich(ln.trim(), M + 4 + indent, y + TERM_H / 2 + FTerm * 0.33, FTerm, RIGHT - M - 8 - indent);
    y += TERM_H;
  }
  y += GAP_H;
  // "made by" details: company = Prepared By / Designation / Contact Number / Email,
  // dealer = Dealer Name / Dealer Address / Contact Person / Contact Number
  line(M, y, RIGHT, y, THIN);
  const maker = q.maker === "dealer" ? "dealer" : "company";
  const labels = MAKER_FIELDS[maker], info = Array.isArray(q.makerInfo) ? q.makerInfo : [];
  const FD = 11.5 * RK;
  const pairAt = (i, x, top, maxW) => {
    font("bold", FD);
    const lab = labels[i] + " : ";
    const lw = doc.getTextWidth(lab);
    const val = String(info[i] || "").trim();
    let fs = FD * 0.96;
    // first line continues after the label, the next line starts under the label (like the Excel cell)
    const wrap = () => {
      if (!val) return [];
      font("normal", fs);
      const first = doc.splitTextToSize(val, maxW - lw)[0] || "";
      const rest = val.slice(first.length).trim();
      return [first, ...(rest ? doc.splitTextToSize(rest, maxW) : [])];
    };
    let ls = wrap();
    // phone numbers / emails: never split, shrink a little instead
    const oneLine = !/\s/.test(val) || !/[a-z]/i.test(val);
    while ((ls.length > (oneLine ? 1 : 2)) && fs > FD * 0.7) { fs -= 0.25; ls = wrap(); }
    const nl = Math.max(1, Math.min(2, ls.length)), lh = FD * 1.15;
    const base = top + DET_H / 2 - ((nl - 1) * lh) / 2 + FD * 0.33;
    font("bold", FD, C.ink); doc.text(lab, x, base);
    font("normal", fs, C.ink);
    ls.slice(0, 2).forEach((t, j) => doc.text(t, j === 0 ? x + lw : x, base + j * lh));
  };
  const logoH = 38 * RK, logoW = kerovit ? logoH * kerovit.w / kerovit.h : 0;
  const xL = M + 8, xR = colX[4] + 4, wL = colX[4] - xL - 6, wR = RIGHT - 6 - logoW - 10 - xR;
  pairAt(0, xL, y, wL); pairAt(1, xR, y, wR);
  pairAt(2, xL, y + DET_H, wL); pairAt(3, xR, y + DET_H, wR);
  // Kerovit logo on the right of the two detail rows (same crop as the template)
  logoRight(kerovit, "ker", RIGHT - 6, y + DET_H - logoH / 2, logoH);
  y += 2 * DET_H;
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
