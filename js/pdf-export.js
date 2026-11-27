// PDF export: draws the quotation with the same geometry, colours and fonts as the Excel
// template printed on A4 (Carlito = metric-compatible Calibri, includes the ₹ sign).
import { calcLine, calcQuote, lineGst, fmtDate, inr, loadImageScaled, amountInWords } from "./common.js";
import { imageURL, TERMS_TITLE, MAKER_FIELDS } from "./store.js";

const A4 = { w: 595.28, h: 841.89 };
const M = 28;                                   // page margin (pt)
// column widths in Excel pixels (same as the exported Excel: wider photo column, slimmer Qty / Disc.%)
const COLS_PX = [61, 71, 85, 133, 100, 61, 42, 42, 61, 61];
const TOTAL_PX = COLS_PX.reduce((a, b) => a + b, 0);
const K = (A4.w - 2 * M) / TOTAL_PX;            // pt per Excel pixel (≈ Excel's own fit-to-width)
const RK = K * 96 / 72;                         // template row points -> PDF points
const EMU_PX = 9525;

// colours of the approved quotation format: cream page, navy bars, black labels
const C = {
  navy: [31, 72, 124], ink: [0, 0, 0], label: [0, 0, 0],
  cream: [255, 255, 255], white: [255, 255, 255], line: [0, 0, 0],   // page background: pure white
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
  const h1 = 64 * RK;
  fill(M, y, RIGHT - M, h1, C.cream);
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

  // ---------------------------------------------------------------- "QUOTATION" bar
  const hq = 22 * RK;
  fill(M, y, RIGHT - M, hq, C.navy);
  font("bold", 14 * RK, C.white);
  doc.text("QUOTATION", (M + RIGHT) / 2, y + hq / 2 + 14 * RK * 0.33, { align: "center" });
  box(M, y, RIGHT - M, hq, MEDIUM);
  y += hq;

  // ---------------------------------------------------------------- customer details, three lines each side
  // left: Quotation Date / Customer Name / Quotation Type; right: Project / Site Address / Mobile Number / Quotation No.
  const PITCH = 23 * RK;                  // distance between the lines
  const tb = (x, ty, label, value, maxW, maxLines = 1) => {
    font("bold", F11, C.label);
    doc.text(label, x, ty);
    const lw = doc.getTextWidth(label);
    if (!value) return 1;
    let fs = F11;
    font("normal", fs, C.ink);
    // first line continues after the label, following lines use the full width
    const wrap = () => {
      const first = doc.splitTextToSize(String(value), maxW - lw)[0] || "";
      const rest = String(value).slice(first.length).trim();
      return [first, ...(rest ? doc.splitTextToSize(rest, maxW) : [])];
    };
    let lines = wrap();
    while (lines.length > maxLines && fs > F11 * 0.75) { fs -= 0.25; font("normal", fs, C.ink); lines = wrap(); }
    lines = lines.slice(0, maxLines);
    lines.forEach((ln, i) => doc.text(ln, i === 0 ? x + lw : x, ty + i * fs * 1.15));
    return lines.length;
  };
  const xL0 = M + 5, xR0 = colX[5] + 5;
  const leftW = colX[5] - xL0 - 10, rightW = RIGHT - xR0 - 6;
  // measure the address first: a long address takes two lines and pushes the right column down
  font("bold", F11); const addrLabW = doc.getTextWidth("Project / Site Address: ");
  font("normal", F11);
  const addrLines = q.address && doc.splitTextToSize(String(q.address), rightW - addrLabW).length > 1 ? 2 : 1;
  const extraR = (addrLines - 1) * F11 * 1.1;
  const h2 = 2 * PITCH + extraR + 22 * RK;
  fill(M, y, RIGHT - M, h2, C.cream);
  const base = y + 9 * RK + F11 * 0.7;
  tb(xL0, base, "Quotation Date: ", fmtDate(q.date), leftW);
  tb(xL0, base + PITCH + extraR, "Customer Name: ", q.customer, leftW);
  tb(xL0, base + 2 * PITCH + extraR, "Quotation Type: ", q.type, leftW);
  tb(xR0, base, "Project / Site Address: ", q.address, rightW, 2);
  tb(xR0, base + PITCH + extraR, "Mobile Number: ", q.mobile, rightW);
  tb(xR0, base + 2 * PITCH + extraR, "Quotation No.: ", q.number, rightW);
  y += h2;

  // ---------------------------------------------------------------- row 3: table header (repeated on each page)
  // number columns, as in the approved format:
  //   Qty | MRP | Disc. % | Rate After Disc. | Total Taxable Amount | Total Tax / GST Amount | Total Amount
  // The Discount lever drops "Disc. %"; the GST lever drops the GST and Total Amount columns.
  const lineAmt = (l) => lineGst(l.total, settings.gst);
  const NUM = [
    ["Qty", 42, (it) => String(it.qty), "center"],
    ["MRP", 61, (it) => "₹" + inr(it.mrp)],
    !q.hideDisc && ["Disc. %", 42, (it) => String(Number(it.disc) || 0), "center"],
    ["Rate After Disc.", 61, (it, l) => "₹" + inr(l.rate)],
    ["Total Taxable Amount", 61, (it, l) => "₹" + inr(l.total)],
    !q.hideGst && ["Total Tax / GST Amount", 61, (it, l) => "₹" + inr(lineAmt(l))],
    !q.hideGst && ["Total Amount", 61, (it, l) => "₹" + inr(l.total + lineAmt(l))],
  ].filter(Boolean);
  // the number columns get ~85% of their natural width; what the template's 5 number columns lack
  // is taken from Product Name and Product Image (each kept at a readable minimum)
  const wSum = NUM.reduce((a, c) => a + c[1], 0);
  const baseW = COLS_PX.slice(0, 5).map((px) => px * K);
  let extra = Math.max(0, wSum * 0.95 * K - (colX[10] - colX[5]));
  for (const [ci, minPx] of [[3, 92], [4, 70], [2, 74], [1, 62]]) {   // name, photo, code, series
    const take = Math.min(extra, baseW[ci] - minPx * K);
    baseW[ci] -= take; extra -= take;
  }
  const nx = [M];
  for (const w of baseW) nx.push(nx[nx.length - 1] + w);
  const numW = RIGHT - nx[5];
  for (const c of NUM) nx.push(nx[nx.length - 1] + c[1] * numW / wSum);
  const nw = (i) => nx[i + 1] - nx[i];
  const NC = nx.length - 1;
  const heads = ["Sr. No.", "Collection / Series", "Model Code", "Product Name", "Product Image", ...NUM.map((c) => c[0])];
  // headings wrap between words only: the font shrinks until the longest word fits its column;
  // the header grows to fit headings that need three lines
  const headFit = heads.map((t, i) => {
    font("bold", F11, C.white);
    const avail = nw(i) - 4, wrap = t.includes("/") || t.length > 12 || t.startsWith("Total");
    const widest = Math.max(...(wrap ? t.split(" ") : [t]).map((w) => doc.getTextWidth(w)));
    const fs = widest > avail ? F11 * avail / widest : F11;
    doc.setFontSize(fs);
    return { fs, lines: wrap ? doc.splitTextToSize(t, avail) : [t] };
  });
  const h3 = Math.max(29 * RK, Math.max(...headFit.map((h) => h.lines.length * h.fs * 1.05)) + 8);
  const drawHeader = () => {
    fill(M, y, RIGHT - M, h3, C.navy);
    font("bold", F11, C.white);
    heads.forEach((t, i) => {
      // "Disc. %" stays on one line (smaller), longer headings wrap
      font("bold", F11, C.white);
      const { lines, fs } = headFit[i];
      doc.setFontSize(fs);
      const lh = fs * 1.05;
      const ty0 = y + h3 / 2 - ((lines.length - 1) * lh) / 2 + fs * 0.32;
      lines.forEach((ln, j) => doc.text(ln, nx[i] + nw(i) / 2, ty0 + j * lh, { align: "center" }));
      box(nx[i], y, nw(i), h3, THIN);
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
  const SUM_ROW_H = 15 * RK * 1.2;                 // each totals line
  const NET_H = SUM_ROW_H * 1.25, WORDS_H = SUM_ROW_H * 1.35;
  const totH = SUM_ROW_H * 4 + NET_H + WORDS_H;   // 4 totals + Net Amount bar + amount in words
  // T&C block: navy title bar, one wrapped paragraph per point, two "made by" rows, banner
  const TITLE_H = 24 * RK, GAP_H = 6 * RK, DET_H = 30 * RK;
  const FTerm = 12 * RK, TERM_LH = FTerm * 1.22, TERM_GAP = 5 * RK;
  const terms = (settings.terms || []).map((s) => s.trim()).filter(Boolean);
  // "**bold**" markup -> words with their weight, wrapped to the width
  const richWrap = (text, size, maxW) => {
    const words = [];
    for (const s of String(text).split(/(\*\*[^*]+\*\*)/).filter((x) => x !== "")) {
      const b = /^\*\*[^*]+\*\*$/.test(s);
      for (const w of (b ? s.slice(2, -2) : s).split(/(\s+)/)) if (w) words.push([w, b]);
    }
    const lines = [[]];
    let cur = 0;
    for (const [w, b] of words) {
      font(b ? "bold" : "normal", size);
      const ww = doc.getTextWidth(w);
      if (/^\s+$/.test(w)) { if (cur) { lines[lines.length - 1].push([" ", b]); cur += doc.getTextWidth(" "); } continue; }
      if (cur + ww > maxW && cur > 0) {
        const last = lines[lines.length - 1];
        while (last.length && last[last.length - 1][0] === " ") last.pop();
        lines.push([]); cur = 0;
      }
      lines[lines.length - 1].push([w, b]); cur += ww;
    }
    return lines;
  };
  const termW = RIGHT - M - 10;
  const termLines = terms.map((t) => richWrap(t, FTerm, termW));
  const termsH = termLines.reduce((a, ls) => a + ls.length * TERM_LH + TERM_GAP, 0);
  const closing = (settings.closing || "").trim();
  const closingH = closing ? 30 : 0;     // navy banner at the bottom
  const tcH = TITLE_H + GAP_H + termsH + 2 * DET_H + closingH;

  // ---------------------------------------------------------------- product rows
  // Few products: rows grow (up to 100 pt) to use the page, so the photos are bigger.
  // Many products: template row height, flowing over several pages.
  const minH = 50 * RK;
  const pad = 3;
  const space = BOTTOM - y - totH - tcH - 6;
  const nItems = q.items.length;
  const rowH = nItems && nItems * minH <= space ? Math.min(100, Math.max(minH, space / nItems)) : minH;
  for (let i = 0; i < q.items.length; i++) {
    onProgress(i, q.items.length);
    const it = q.items[i];
    const { rate, total } = calcLine(it);
    font("bold", F9);
    const cellLines = (txt, ci) => doc.splitTextToSize(String(txt || ""), nw(ci) - 2 * pad);
    const L = { B: cellLines(it.series, 1), C: cellLines(it.code, 2), D: cellLines(it.label, 3) };
    // size under the product name, regular weight
    const FS = F9 * 0.95;
    font("normal", FS);
    const S = it.size ? doc.splitTextToSize(String(it.size), nw(3) - 2 * pad) : [];
    font("bold", F9);
    const lh = F9 * 1.18;
    const need = Math.max(L.B.length, L.C.length, L.D.length + S.length) * lh + 2 * pad + 2;
    const h = Math.max(rowH, need);
    if (y + h > BOTTOM) newPage(true);

    fill(M, y, RIGHT - M, h, C.cream);
    font("bold", F9);
    const mid = y + h / 2;
    const vText = (lines, ci, align = "center") => {
      const ty0 = mid - ((lines.length - 1) * lh) / 2 + F9 * 0.33;
      const x = align === "center" ? nx[ci] + nw(ci) / 2 : align === "right" ? nx[ci + 1] - pad : nx[ci] + pad;
      lines.forEach((ln, j) => doc.text(ln, x, ty0 + j * lh, { align }));
    };
    vText([String(i + 1)], 0);
    vText(L.B, 1); vText(L.C, 2);
    {   // product name (bold) with the size below it, centred as one block
      const n = L.D.length + S.length, ty0 = mid - ((n - 1) * lh) / 2 + F9 * 0.33, cx = nx[3] + nw(3) / 2;
      font("bold", F9); L.D.forEach((ln, j) => doc.text(ln, cx, ty0 + j * lh, { align: "center" }));
      font("normal", FS); S.forEach((ln, j) => doc.text(ln, cx, ty0 + (L.D.length + j) * lh, { align: "center" }));
      font("bold", F9);
    }
    const fit = (s, ci, align = "right") => {   // like Excel "shrink to fit" for the narrow amount columns
      font("bold", F9);
      const avail = nw(ci) - 2 * pad, w = doc.getTextWidth(s);
      if (w > avail) doc.setFontSize(F9 * avail / w);
      vText([s], ci, align);
      font("bold", F9);
    };
    NUM.forEach((c, k) => fit(c[2](it, { rate, total }), 5 + k, c[3] || "right"));

    // photo
    const url = await imageURL({ image: it.image });
    const img = await loadImageScaled(url, 800, "image/jpeg", 0.92);
    if (img) {
      const bw = nw(4) - 6, bh = Math.min(h, 100) - 6;
      const k = Math.min(bw / img.w, bh / img.h);
      const w = img.w * k, hh = img.h * k;
      doc.addImage(img.dataURL, "JPEG", nx[4] + (nw(4) - w) / 2, y + (h - hh) / 2, w, hh, undefined, "FAST");
    }
    for (let c = 0; c < NC; c++) box(nx[c], y, nw(c), h, THIN);
    y += h;
  }

  // ---------------------------------------------------------------- totals
  // label right-aligned across the table, amount in the Total column; Net Amount on a navy bar;
  // then the amount in words
  const tot = calcQuote(q, settings.gst);
  const rows = [
    ["Total Quantity", String(tot.qty)],
    ["Total MRP", "₹" + inr(tot.mrpTotal)],
    ["Total Taxable Amount", "₹" + inr(tot.sub)],
    ["Total Tax / GST", "₹" + inr(tot.gst)],
  ];
  if (y + totH > BOTTOM) newPage();
  const sumTop = y;
  const valCol = NC - 1;
  const sumRow = (label, val, h, fs, bg, color) => {
    fill(M, y, RIGHT - M, h, bg);
    font("bold", fs, color);
    doc.text(label, nx[valCol] - 4, y + h / 2 + fs * 0.33, { align: "right" });
    const avail = RIGHT - nx[valCol] - 5, w = doc.getTextWidth(val);
    if (w > avail) doc.setFontSize(fs * avail / w);
    doc.text(val, RIGHT - 3, y + h / 2 + fs * 0.33, { align: "right" });
    line(nx[valCol], y, nx[valCol], y + h, THIN);
    line(M, y + h, RIGHT, y + h, THIN);
    y += h;
  };
  for (const [label, val] of rows) sumRow(label, val, SUM_ROW_H, F11, C.cream, C.ink);
  sumRow("Net Amount", "₹" + inr(tot.net, 0), NET_H, 14 * RK, C.navy, C.white);
  // amount in words
  fill(M, y, RIGHT - M, WORDS_H, C.cream);
  font("bold", F11, C.ink);
  const lab = "Amount (in words): ";
  doc.text(lab, M + 5, y + WORDS_H / 2 + F11 * 0.33);
  const lw = doc.getTextWidth(lab);
  font("normal", F11, C.ink);
  doc.text(amountInWords(tot.net), M + 5 + lw, y + WORDS_H / 2 + F11 * 0.33);
  y += WORDS_H;
  line(M, sumTop, RIGHT, sumTop, MEDIUM);
  line(M, y, RIGHT, y, MEDIUM);

  // ---------------------------------------------------------------- terms & conditions
  if (y + tcH > BOTTOM) newPage();
  const tcTop = y;
  fill(M, y, RIGHT - M, tcH - closingH, C.cream);
  // title: navy bar, white bold underlined text on the left
  fill(M, y, RIGHT - M, TITLE_H, C.navy);
  const FT = 14 * RK;
  font("bold", FT, C.white);
  const tw = doc.getTextWidth(TERMS_TITLE), tx = M + 5, ty = y + TITLE_H / 2 + FT * 0.33;
  doc.text(TERMS_TITLE, tx, ty);
  doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.9); doc.line(tx, ty + 2.2, tx + tw + 3, ty + 2.2); doc.setDrawColor(...C.line);
  line(M, y + TITLE_H, RIGHT, y + TITLE_H, MEDIUM);
  y += TITLE_H + GAP_H;
  // one paragraph per point, wrapped, bold words from "**...**"
  for (const ls of termLines) {
    for (const segs of ls) {
      let x = M + 5;
      const baseY = y + FTerm * 0.95;
      for (const [t, b] of segs) { font(b ? "bold" : "normal", FTerm, C.ink); doc.text(t, x, baseY); x += doc.getTextWidth(t); }
      y += TERM_LH;
    }
    y += TERM_GAP;
  }
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
