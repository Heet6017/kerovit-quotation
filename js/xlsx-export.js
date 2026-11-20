// Excel export: fills the real template (assets/template.xlsx) by editing its XML directly,
// so the logos, header text boxes, colours, borders and T&C stay exactly as designed.
// (Excel libraries such as ExcelJS drop the template's text boxes, so they can't be used.)
import { calcLine, calcQuote, fmtDate, productLabel, seriesLabel, loadImageScaled, round2, amountInWords } from "./common.js";
import { imageURL, TERMS_TITLE, MAKER_FIELDS } from "./store.js";

const TEMPLATE_URL = "assets/template.xlsx";
const FIRST_DATA_ROW = 4;      // template product rows are 4..27, row 28 is the white spacer row
const TEMPLATE_DATA_ROWS = 24;
const SPACER_ROW = 28;
const LAST_ROW = 44;
const EMU_PX = 9525, EMU_PT = 12700;
const COL_E_PX = 100;          // photo column widened to 14.29 (≈100 px); Qty / Disc.% slimmed to 6.0 (≈42 px)
const COLS_XML = '<col min="5" max="5" width="14.2890625" style="1" customWidth="1"/><col min="6" max="6" width="8.7265625" style="1"/>' +
  '<col min="7" max="8" width="6" style="1" customWidth="1"/><col min="9" max="16384" width="8.7265625" style="1"/>';

const CREAM = "FFFFF9F3", NAVY = "FF1F487C";
const xmlEsc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const colOf = (i) => "ABCDEFGHIJK"[i];

// Indian-grouped rupee format with paise: ₹1,02,300.00
const INR_FMT0 = '[&gt;=10000000]&quot;₹&quot;##\\,##\\,##\\,##0;[&gt;=100000]&quot;₹&quot;##\\,##\\,##0;&quot;₹&quot;#,##0';
const INR_FMT ='[&gt;=10000000]&quot;₹&quot;##\\,##\\,##\\,##0.00;[&gt;=100000]&quot;₹&quot;##\\,##\\,##0.00;&quot;₹&quot;#,##0.00';

class Styles {
  constructor(xml) {
    this.xml = xml;
    const m = xml.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
    this.count = Number(m[1]);
    this.added = [];
    this.cache = new Map();
    this.xfs = m[2].match(/<xf [\s\S]*?(?:\/>|<\/xf>)/g);
    this.fontCount = Number(xml.match(/<fonts count="(\d+)"/)[1]);
    // approved format: cream page instead of the template's light blues, navy bars
    const solid = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
    let fi = -1;
    this.xml = this.xml.replace(/<fills count="\d+">([\s\S]*?)<\/fills>/, (m, inner) => m.replace(inner,
      inner.replace(/<fill>[\s\S]*?<\/fill>/g, (f) => {
        fi++;
        if (fi === 3 || fi === 4 || fi === 5) return solid(CREAM);   // light blue / lavender fills
        if (fi === 6) return `<fill><patternFill patternType="solid"><fgColor rgb="${NAVY}"/><bgColor rgb="${NAVY}"/></patternFill></fill>`;
        return f;
      })));
    this.cream = 3; this.navy = 6;
    this.rowFill = { even: 3, odd: 3 };
    // add the rupee number format
    this.xml = this.xml.replace(/<numFmts count="(\d+)">/, (_, n) => `<numFmts count="${Number(n) + 2}">`)
      .replace("</numFmts>", `<numFmt numFmtId="165" formatCode="${INR_FMT}"/><numFmt numFmtId="166" formatCode="${INR_FMT0}"/></numFmts>`);
    this.borderCount = Number(this.xml.match(/<borders count="(\d+)"/)[1]);
    this.borderCache = new Map();
  }
  /** border with the given styles ("thin" / "medium") on left, right, top, bottom */
  border(l, r, t, b) {
    const key = [l, r, t, b].join("|");
    if (this.borderCache.has(key)) return this.borderCache.get(key);
    const side = (n, s) => s === "none" ? `<${n}/>` : `<${n} style="${s}"><color indexed="64"/></${n}>`;
    const x = `<border>${side("left", l)}${side("right", r)}${side("top", t)}${side("bottom", b)}<diagonal/></border>`;
    this.xml = this.xml.replace(/<borders count="\d+"/, `<borders count="${this.borderCount + 1}"`).replace("</borders>", x + "</borders>");
    this.borderCache.set(key, this.borderCount);
    return this.borderCount++;
  }
  addFont(fontXml) {
    this.xml = this.xml.replace(/<fonts count="(\d+)"/, (_, n) => `<fonts count="${Number(n) + 1}"`)
      .replace("</fonts>", fontXml + "</fonts>");
    return this.fontCount++;
  }
  attr(i, name) {
    const m = this.xfs[i].match(new RegExp(name + '="(\\d+)"'));
    return m ? Number(m[1]) : 0;
  }
  xf({ numFmt = 0, font = 0, fill = 0, border = 0, h = "", v = "center", wrap = false, shrink = false }) {
    const key = [numFmt, font, fill, border, h, v, wrap, shrink].join("|");
    if (this.cache.has(key)) return this.cache.get(key);
    const al = `<alignment${h ? ` horizontal="${h}"` : ""}${v ? ` vertical="${v}"` : ""}${wrap ? ' wrapText="1"' : ""}${shrink ? ' shrinkToFit="1"' : ""}/>`;
    const x = `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"` +
      ` applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">${al}</xf>`;
    const idx = this.count + this.added.length;
    this.added.push(x);
    this.cache.set(key, idx);
    return idx;
  }
  /** same look as an existing style, but rupee format, right-aligned and shrunk to fit the narrow column */
  withFmt(i, numFmt) {
    return this.xf({ numFmt, font: this.attr(i, "fontId"), fill: this.attr(i, "fillId"), border: this.attr(i, "borderId"),
      h: "right", v: "center", shrink: true });
  }
  toXML() {
    return this.xml.replace(/<cellXfs count="\d+">([\s\S]*?)<\/cellXfs>/,
      (_, inner) => `<cellXfs count="${this.count + this.added.length}">${inner}${this.added.join("")}</cellXfs>`);
  }
}

function rowStyles(styles, even) {
  // even rows look like template row 8 (#F3F3FF), odd rows like template row 7 (#E7EFFF)
  const fill = even ? styles.rowFill.even : styles.rowFill.odd;
  const b = even ? { A: 20, mid: 21, D: 22, J: 25 } : { A: 10, mid: 1, D: 1, J: 11 };
  const F = 5; // Arial 9 bold (template product-row font)
  return {
    A: styles.xf({ font: F, fill, border: b.A, h: "center" }),
    B: styles.xf({ font: F, fill, border: b.mid, h: "center", wrap: true }),
    C: styles.xf({ font: F, fill, border: b.mid, h: "center", wrap: true }),
    D: styles.xf({ font: F, fill, border: b.D, h: "center", wrap: true }),
    E: styles.xf({ font: 0, fill, border: b.mid }),
    F: styles.xf({ numFmt: 165, font: F, fill, border: b.mid, h: "right", shrink: true }),
    G: styles.xf({ font: F, fill, border: b.mid, h: "center", shrink: true }),
    H: styles.xf({ font: F, fill, border: b.mid, h: "center", shrink: true }),
    I: styles.xf({ numFmt: 165, font: F, fill, border: b.mid, h: "right", shrink: true }),
    J: styles.xf({ numFmt: 165, font: F, fill, border: b.J, h: "right", shrink: true }),
  };
}

const strCell = (ref, s, text) => `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
const numCell = (ref, s, n) => `<c r="${ref}" s="${s}"><v>${n}</v></c>`;
const fCell = (ref, s, f, v) => `<c r="${ref}" s="${s}"><f>${xmlEsc(f)}</f><v>${v}</v></c>`;
const blankCell = (ref, s) => `<c r="${ref}" s="${s}"/>`;

/** rough line count for a wrapped cell, to grow the row height for long names */
function lines(text, charsPerLine) {
  const words = String(text).split(/\s+/);
  let n = 1, cur = 0;
  for (const w of words) {
    const len = w.length + (cur ? 1 : 0);
    if (cur + len > charsPerLine && cur > 0) { n++; cur = w.length; } else cur += len;
  }
  return n;
}

function shiftRowXml(rowXml, delta) {
  if (!delta) return rowXml;
  return rowXml
    .replace(/<row r="(\d+)"/, (_, r) => `<row r="${Number(r) + delta}"`)
    .replace(/ r="([A-Z]+)(\d+)"/g, (_, c, r) => ` r="${c}${Number(r) + delta}"`);
}

/** header detail text box: black bold label, value after it, wraps inside the box width */
function infoBox(id, col, colOff, row, rowOffPt, cx, cy, label, value, valueSz = 1100) {
  const run = (t, b) => `<a:r><a:rPr lang="en-US" sz="${b ? 1100 : valueSz}" b="${b ? 1 : 0}"><a:solidFill><a:srgbClr val="000000"/></a:solidFill>` +
    `<a:latin typeface="Calibri"/></a:rPr><a:t>${xmlEsc(t)}</a:t></a:r>`;
  return `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>${colOff}</xdr:colOff><xdr:row>${row}</xdr:row>` +
    `<xdr:rowOff>${Math.round(rowOffPt * EMU_PT)}</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/>` +
    `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="Info ${id}"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr>` +
    `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></xdr:spPr>` +
    `<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"/>` +
    `<a:lstStyle/><a:p>${run(label, true)}${value ? run(value, false) : ""}</a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:oneCellAnchor>`;
}

/** insert a new row 2: every row from 2 down moves one row lower (cells, merges, formulas, drawings) */
function shiftRefs(s) {
  return s.replace(/(\$?)([A-K])(\$?)(\d+)\b/g, (m, d1, c, d2, r) => Number(r) >= 2 ? `${d1}${c}${d2}${Number(r) + 1}` : m);
}

/** rich-text runs from "**bold**" markup */
function richRuns(text, { sz = 11, color = "FF000000", bold = false } = {}) {
  return String(text).split(/(\*\*[^*]+\*\*)/).filter((s) => s !== "").map((seg) => {
    const b = bold || /^\*\*[^*]+\*\*$/.test(seg);
    const t = seg.replace(/^\*\*|\*\*$/g, "");
    return `<r><rPr>${b ? "<b/>" : ""}<sz val="${sz}"/><color rgb="${color}"/><rFont val="Calibri"/><family val="2"/></rPr><t xml:space="preserve">${xmlEsc(t)}</t></r>`;
  }).join("");
}

function picAnchor(i, col, row, offX, offY, cx, cy, rid) {
  return `<xdr:oneCellAnchor><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>${offX}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${offY}</xdr:rowOff></xdr:from>` +
    `<xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${100 + i}" name="Product ${i + 1}"/>` +
    `<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill>` +
    `<a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${rid}"/>` +
    `<a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
}

export async function buildXlsx(q, settings, onProgress = () => {}) {
  const buf = await (await fetch(TEMPLATE_URL)).arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  let sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
  let drawing = await zip.file("xl/drawings/drawing1.xml").async("string");
  let drawRels = await zip.file("xl/drawings/_rels/drawing1.xml.rels").async("string");
  let types = await zip.file("[Content_Types].xml").async("string");
  let workbook = await zip.file("xl/workbook.xml").async("string");
  const styles = new Styles(await zip.file("xl/styles.xml").async("string"));

  const items = q.items;
  const nRows = Math.max(items.length, settings.keepRows ? TEMPLATE_DATA_ROWS : 1);
  const delta = nRows - TEMPLATE_DATA_ROWS;
  const lastData = FIRST_DATA_ROW + nRows - 1;

  // ---- split template rows
  const rows = {};
  sheet.replace(/<row r="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (m, r) => { rows[Number(r)] = m; return m; });

  const S = [rowStyles(styles, true), rowStyles(styles, false)];
  // few products -> taller rows (bigger photos); many products -> template height of 50
  const baseH = items.length && !settings.keepRows ? Math.max(50, Math.min(100, Math.floor(200 / items.length))) : 50;
  const dataXml = [];
  const heights = [];
  for (let i = 0; i < nRows; i++) {
    const r = FIRST_DATA_ROW + i;
    const st = S[i % 2];
    const it = items[i];
    let cells;
    let ht = 50;
    if (it) {
      const { rate, total } = calcLine(it);
      const name = it.label;
      ht = Math.max(baseH, lines(name, 20) * 11.5 + 8, lines(it.series, 10) * 11.5 + 8, lines(it.code, 12) * 11.5 + 8);
      cells = [
        numCell(`A${r}`, st.A, i + 1),
        strCell(`B${r}`, st.B, it.series),
        strCell(`C${r}`, st.C, it.code),
        strCell(`D${r}`, st.D, name),
        blankCell(`E${r}`, st.E),
        numCell(`F${r}`, st.F, it.mrp),
        numCell(`G${r}`, st.G, Number(it.qty) || 0),
        numCell(`H${r}`, st.H, Number(it.disc) || 0),
        fCell(`I${r}`, st.I, `ROUND(F${r}*(1-H${r}/100),2)`, rate),
        fCell(`J${r}`, st.J, `ROUND(I${r}*G${r},2)`, total),
      ];
    } else {
      cells = "ABCDEFGHIJ".split("").map((c) => blankCell(`${c}${r}`, st[c]));
    }
    heights.push(ht);
    dataXml.push(`<row r="${r}" spans="1:11" ht="${ht}" customHeight="1" x14ac:dyDescent="0.35">${cells.join("")}</row>`);
  }

  // ---- rows after the products (spacer, totals, T&C) shift by `delta`
  const tot = calcQuote(q, settings.gst);

  // Totals one below another (label right-aligned across A:I, amount in the Total column J),
  // Net Amount on a navy bar, then the amount in words. They start right under the products
  // (the template's white spacer row 28 is dropped).
  const firstSum = SPACER_ROW + delta;
  const summaryMerges = [];
  const SUM = [
    ["Total Quantity", `SUM(G${FIRST_DATA_ROW}:G${lastData})`, tot.qty, 0],
    ["Total MRP", `SUMPRODUCT(F${FIRST_DATA_ROW}:F${lastData},G${FIRST_DATA_ROW}:G${lastData})`, tot.mrpTotal, 165],
    ["Total Taxable Amount", `SUM(J${FIRST_DATA_ROW}:J${lastData})`, tot.sub, 165],
    ["Total Tax / GST", `ROUND(J${firstSum + 2}*${settings.gst}/100,2)`, tot.gst, 165],
    ["Net Amount", `ROUND(J${firstSum + 2}+J${firstSum + 3},0)`, tot.net, 166],
  ];
  const fBold11 = styles.addFont('<font><b/><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>');
  const fNet = styles.addFont('<font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>');
  function summaryRows() {
    const out = [];
    SUM.forEach(([label, f, v, fmt], i) => {
      const nr = firstSum + i, net = i === SUM.length - 1;
      const top = i === 0 ? "medium" : "thin";
      const font = net ? fNet : fBold11, fill = net ? styles.navy : styles.cream;
      const sA = styles.xf({ font, fill, border: styles.border("medium", "none", top, "thin"), h: "right" });
      const sMid = styles.xf({ font, fill, border: styles.border("none", "none", top, "thin"), h: "right" });
      const sI = styles.xf({ font, fill, border: styles.border("none", "thin", top, "thin"), h: "right" });
      const sJ = styles.xf({ numFmt: fmt, font, fill, border: styles.border("thin", "medium", top, "thin"), h: "right", shrink: true });
      const cells = [strCell(`A${nr}`, sA, label), ..."BCDEFGH".split("").map((c) => blankCell(`${c}${nr}`, sMid)),
        blankCell(`I${nr}`, sI), fCell(`J${nr}`, sJ, f, v)];
      summaryMerges.push(`A${nr}:I${nr}`);
      out.push(`<row r="${nr}" spans="1:11" ht="${net ? 22 : 18}" customHeight="1" x14ac:dyDescent="0.35">${cells.join("")}</row>`);
    });
    // amount in words: last line of the block, medium line below
    const nr = firstSum + SUM.length;
    const sw = styles.xf({ fill: styles.cream, border: styles.border("medium", "none", "thin", "medium"), h: "left", v: "center" });
    const sm = styles.xf({ fill: styles.cream, border: styles.border("none", "none", "thin", "medium") });
    const se = styles.xf({ fill: styles.cream, border: styles.border("none", "medium", "thin", "medium") });
    const run = (s, bold) => `<r><rPr>${bold ? "<b/>" : ""}<sz val="11"/><color rgb="FF000000"/><rFont val="Calibri"/><family val="2"/></rPr><t xml:space="preserve">${xmlEsc(s)}</t></r>`;
    const rich = run("Amount (in words): ", true) + run(amountInWords(tot.net), false);
    const cells = [`<c r="A${nr}" s="${sw}" t="inlineStr"><is>${rich}</is></c>`,
      ..."BCDEFGHI".split("").map((c) => blankCell(`${c}${nr}`, sm)), blankCell(`J${nr}`, se)];
    summaryMerges.push(`A${nr}:J${nr}`);
    out.push(`<row r="${nr}" spans="1:11" ht="24" customHeight="1" x14ac:dyDescent="0.35">${cells.join("")}</row>`);
    return out;
  }
  // ---- T&C (title + one row per line), then the "made by" details with the Kerovit logo, then the banner
  const fillTC = styles.cream;
  const bL = styles.border("medium", "none", "none", "none"), bR = styles.border("none", "medium", "none", "none");
  const tcA = styles.xf({ fill: fillTC, border: bL, v: "top", wrap: true });
  const tcMid = styles.xf({ fill: fillTC, border: 0, v: "center" });
  const tcJ = styles.xf({ fill: fillTC, border: bR, v: "center" });
  const fTitle = styles.addFont('<font><b/><u/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>');
  const tcTitle = styles.xf({ font: fTitle, fill: styles.navy, border: styles.border("medium", "none", "medium", "medium"), h: "left", v: "center" });
  const tcTitleMid = styles.xf({ fill: styles.navy, border: styles.border("none", "none", "medium", "medium") });
  const tcTitleJ = styles.xf({ fill: styles.navy, border: styles.border("none", "medium", "medium", "medium") });
  const tailRow = (nr, ht, cellA, sA, sM = tcMid, sJ = tcJ) => `<row r="${nr}" spans="1:11" ht="${ht}" customHeight="1" x14ac:dyDescent="0.35">` +
    (cellA ? `<c r="A${nr}" s="${sA}" t="inlineStr"><is>${cellA}</is></c>` : blankCell(`A${nr}`, sA)) +
    "BCDEFGHI".split("").map((c) => blankCell(`${c}${nr}`, sM)).join("") + blankCell(`J${nr}`, sJ) + "</row>";
  const tailMerges = [];
  const tcStart = firstSum + SUM.length + 1;
  const tail = [];
  let tr = tcStart;
  tail.push(tailRow(tr, 24, richRuns(" " + TERMS_TITLE + " ", { sz: 14, color: "FFFFFFFF", bold: true }).replace("<b/>", "<b/><u/>"),
    tcTitle, tcTitleMid, tcTitleJ));
  tailMerges.push(`A${tr}:J${tr}`); tr++;
  tail.push(tailRow(tr, 5, "", tcA)); tr++;
  // one paragraph per point; long points wrap (row height from an estimate of the wrapped lines)
  for (const line of settings.terms.map((s) => s.trim()).filter(Boolean)) {
    const n = lines(line.replace(/\*\*/g, ""), 112);
    tail.push(tailRow(tr, n * 16 + 6, richRuns(line, { sz: 12 }), tcA));
    tailMerges.push(`A${tr}:J${tr}`); tr++;
  }
  // details: thin line above, two rows of "Label : value" pairs (A:D and E:G), logo in H:J
  const maker = q.maker === "dealer" ? "dealer" : "company";
  const labels = MAKER_FIELDS[maker], info = Array.isArray(q.makerInfo) ? q.makerInfo : [];
  const thin = (top, l, r) => styles.border(l ? "medium" : "none", r ? "medium" : "none", top ? "thin" : "none", "none");
  const det = (top, l, r) => styles.xf({ fill: fillTC, border: thin(top, l, r), v: "center", wrap: true });
  const pair = (i) => richRuns(`**  ${labels[i]} :** `, { sz: 11.5 }) + (info[i] ? richRuns(info[i], { sz: 11 }) : "");
  const detailsRow = (nr, a, b, top) => `<row r="${nr}" spans="1:11" ht="32" customHeight="1" x14ac:dyDescent="0.35">` +
    `<c r="A${nr}" s="${det(top, 1, 0)}" t="inlineStr"><is>${pair(a)}</is></c>` +
    "BCD".split("").map((c) => blankCell(`${c}${nr}`, det(top, 0, 0))).join("") +
    `<c r="E${nr}" s="${det(top, 0, 0)}" t="inlineStr"><is>${pair(b)}</is></c>` +
    "FGHI".split("").map((c) => blankCell(`${c}${nr}`, det(top, 0, 0))).join("") + blankCell(`J${nr}`, det(top, 0, 1)) + "</row>";
  const detRow = tr;
  // company: Prepared By | Designation / Contact Number | Email; dealer: Dealer Name | Dealer Address / Contact Person | Contact Number
  tail.push(detailsRow(tr, 0, 1, true)); tailMerges.push(`A${tr}:D${tr}`, `E${tr}:G${tr}`); tr++;
  tail.push(detailsRow(tr, 2, 3, false)); tailMerges.push(`A${tr}:D${tr}`, `E${tr}:G${tr}`); tr++;
  const bannerRow = tr;

  const after = [];
  for (let r = SPACER_ROW; r <= LAST_ROW; r++) {
    if (r === SPACER_ROW) { after.push(...summaryRows(), ...tail); continue; }
    if (r < 44) continue;
    const shift = r === 44 ? bannerRow - 44 : delta;
    let x = shiftRowXml(rows[r], shift);
    const nr = r + shift;
    if (r === 44 && settings.closing) {
      // closing banner in the bottom row: white bold text on navy, "Bathrooms You Desire" larger
      const fid = styles.addFont('<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>');
      const navy = styles.navy;
      const gs = styles.xf({ font: fid, fill: navy, border: styles.attr(18, "borderId"), h: "center", v: "center", wrap: true });
      const mid = styles.xf({ font: fid, fill: navy, border: styles.attr(19, "borderId"), v: "center" });
      const end = styles.xf({ font: fid, fill: navy, border: styles.attr(20, "borderId"), v: "center" });
      const run = (t, sz) => t ? `<r><rPr><b/><sz val="${sz}"/><color rgb="FFFFFFFF"/><rFont val="Calibri"/><family val="2"/></rPr><t xml:space="preserve">${xmlEsc(t)}</t></r>` : "";
      const c = settings.closing, m = c.match(/bathrooms you desire/i);
      const rich = m ? run(c.slice(0, m.index), 12) + run(m[0], 13.5) + run(c.slice(m.index + m[0].length), 12) : run(c, 12);
      x = x.replace(/ ht="15"/, ' ht="30" customHeight="1"')
        .replace(new RegExp(`<c r="A${nr}" s="\\d+"/>`), `<c r="A${nr}" s="${gs}" t="inlineStr"><is>${rich}</is></c>`)
        .replace(/ s="19"/g, ` s="${mid}"`).replace(/ s="20"/g, ` s="${end}"`);
    }
    after.push(x);
  }

  // header: logos row a little lower; details row tall enough for three lines each side
  // (a long site address takes two lines and pushes Mobile Number / Quotation No. down)
  const addrTwo = (q.address || "").length > 24;
  const LINE = 23, ADDR_EXTRA = addrTwo ? 14 : 0;
  const infoH = 2 * LINE + ADDR_EXTRA + 24;
  const row1 = rows[1].replace(/ ht="[\d.]+"/, ' ht="64"');
  const row2 = rows[2].replace(/ ht="[\d.]+"/, ` ht="${infoH}"`);
  // "Disc. %" on one line: same look as the other headings, shrunk to the narrow column
  const row3 = rows[3].replace(/<c r="H3" s="(\d+)" t="s"><v>23<\/v><\/c>/, (m, s) => strCell("H3",
    styles.xf({ font: styles.attr(+s, "fontId"), fill: styles.attr(+s, "fillId"), border: styles.attr(+s, "borderId"), h: "center", shrink: true }),
    "Disc. %"));
  const before = row1 + row2 + row3;
  sheet = sheet.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${before}${dataXml.join("")}${after.join("")}</sheetData>`);
  sheet = sheet.replace(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g, (m, c1, r1, c2, r2) => {
    const a = Number(r1), b = Number(r2);
    if (a >= SPACER_ROW) return "";  // totals and T&C rows are rebuilt above
    const sh = a >= SPACER_ROW ? delta : 0;
    return sh ? `<mergeCell ref="${c1}${a + sh}:${c2}${b + sh}"/>` : m;
  });
  const newMerges = [...summaryMerges, ...tailMerges, ...(settings.closing ? [`A${bannerRow}:J${bannerRow}`] : [])];
  sheet = sheet.replace("</mergeCells>", newMerges.map((ref) => `<mergeCell ref="${ref}"/>`).join("") + "</mergeCells>");
  sheet = sheet.replace(/<mergeCells count="\d+">/, () => `<mergeCells count="${(sheet.match(/<mergeCell ref=/g) || []).length}">`);
  sheet = sheet.replace(/<col min="5" max="16384" [^>]*\/>/, COLS_XML);
  sheet = sheet.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:K${bannerRow}"/>`);
  // print: A4, fit all columns on the page width, header row repeated on every page
  sheet = sheet.replace(/<pageSetup [^>]*\/>/, '<pageSetup paperSize="9" fitToHeight="0" orientation="portrait" r:id="rId1"/>');
  if (!sheet.includes("<sheetPr")) sheet = sheet.replace("<dimension", '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension');
  sheet = sheet.replace(/<pageMargins [^>]*\/>/, '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>');
  sheet = sheet.replace(/<selection [^>]*\/>/, '<selection activeCell="A1" sqref="A1"/>');

  // ---- header details (row 2): the template's text boxes are replaced by six new ones,
  // left (columns A–E): Quotation Date / Customer Name / Quotation Type,
  // right (columns F–J): Project / Site Address / Mobile Number / Quotation No.
  drawing = drawing.replace(/<xdr:oneCellAnchor>(?:(?!<\/xdr:oneCellAnchor>)[\s\S])*?name="TextBox \d+"[\s\S]*?<\/xdr:oneCellAnchor>/g, "");
  const boxH = 17 * EMU_PT, LX = 3900000, RX = 2700000;
  const y0 = 9;
  drawing = drawing.replace("</xdr:wsDr>", [
    infoBox(201, 0, 45000, 1, y0, LX, boxH, "Quotation Date: ", fmtDate(q.date)),
    infoBox(202, 0, 45000, 1, y0 + LINE + ADDR_EXTRA, LX, boxH, "Customer Name: ", q.customer),
    infoBox(203, 0, 45000, 1, y0 + 2 * LINE + ADDR_EXTRA, LX, boxH, "Quotation Type: ", q.type),
    infoBox(204, 5, 45000, 1, y0, RX, boxH + ADDR_EXTRA * EMU_PT, "Project / Site Address: ", q.address,
      // long addresses get a smaller font so they stay within two lines
      Math.max(800, Math.min(1100, Math.floor(1100 * 62 / Math.max(62, (q.address || "").length + 24) / 50) * 50))),
    infoBox(205, 5, 45000, 1, y0 + LINE + ADDR_EXTRA, RX, boxH, "Mobile Number: ", q.mobile),
    infoBox(206, 5, 45000, 1, y0 + 2 * LINE + ADDR_EXTRA, RX, boxH, "Quotation No.: ", q.number),
  ].join("") + "</xdr:wsDr>");
  // Kerovit logos: fixed size at their true proportions (not stretched between cells), right edge in column J.
  // The T&C logo moves with the rows.
  drawing = drawing.replace(/<xdr:twoCellAnchor>((?:(?!<\/xdr:twoCellAnchor>)[\s\S])*?)<\/xdr:twoCellAnchor>/g, (m, inner) => {
    const one = (col, off, row, rowOff, cx, cy) => "<xdr:oneCellAnchor>" + inner.replace(/<xdr:from>[\s\S]*?<\/xdr:to>/,
      `<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>${off}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${rowOff}</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/>`) +
      "</xdr:oneCellAnchor>";
    if (m.includes('name="Picture 2"')) return one(6, 53340, 0, 82550, 1847850, 636145);
    if (m.includes('name="Picture 9"')) return one(7, 100000, detRow - 1, 120000, 1424940, 490220);
    return m;
  });

  // ---- product photos in column E
  if (!types.includes('Extension="jpeg"')) types = types.replace("<Default Extension=\"png\"", '<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png"');
  const pics = [];
  for (let i = 0; i < items.length; i++) {
    onProgress(i, items.length);
    const it = items[i];
    const url = await imageURL({ image: it.image });
    const img = await loadImageScaled(url, 600, "image/jpeg", 0.92);
    if (!img) continue;
    const name = `q${i + 1}.jpeg`;
    zip.file(`xl/media/${name}`, img.blob);
    const rid = `rIdQ${i + 1}`;
    drawRels = drawRels.replace("</Relationships>",
      `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${name}"/></Relationships>`);
    const cellW = COL_E_PX * EMU_PX, cellH = heights[i] * EMU_PT;
    const pad = 3 * EMU_PX;
    const boxW = cellW - 2 * pad, boxH = Math.min(cellH, 100 * EMU_PT) - 2 * pad;
    const k = Math.min(boxW / img.w, boxH / img.h);
    const cx = Math.round(img.w * k), cy = Math.round(img.h * k);
    pics.push(picAnchor(i, 4, FIRST_DATA_ROW - 1 + i, Math.round((cellW - cx) / 2), Math.round((cellH - cy) / 2), cx, cy, rid));
  }
  drawing = drawing.replace("</xdr:wsDr>", pics.join("") + "</xdr:wsDr>");

  // ---- workbook: recalculate formulas on open, repeat header row when printing
  workbook = workbook.replace(/<calcPr ([^>]*)\/>/, (m, a) => a.includes("fullCalcOnLoad") ? m : `<calcPr ${a} fullCalcOnLoad="1"/>`);
  // repeat the column headings on later pages only when the product rows don't fit on page 1
  // (A4 with 0.5" margins ≈ 770 pt printable; rows 1–3 take 186.5 pt)
  const productsFitPage1 = 64 + 22 + infoH + 29 + heights.reduce((a, h) => a + h, 0) <= 770;
  if (!productsFitPage1 && !workbook.includes("_xlnm.Print_Titles")) {
    // the column headings are row 4 once the QUOTATION bar is inserted below
    workbook = workbook.replace("</sheets>", '</sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">Sheet1!$4:$4</definedName></definedNames>');
  }

  // ---- navy "QUOTATION" bar as a new row 2 (everything from row 2 down moves one row lower)
  const qStyle = styles.xf({ font: fNet, fill: styles.navy, border: styles.border("medium", "none", "medium", "medium"), h: "center" });
  const qMid = styles.xf({ fill: styles.navy, border: styles.border("none", "none", "medium", "medium") });
  const qEnd = styles.xf({ fill: styles.navy, border: styles.border("none", "medium", "medium", "medium") });
  const qRow = `<row r="2" spans="1:11" ht="22" customHeight="1" x14ac:dyDescent="0.35">${strCell("A2", qStyle, "QUOTATION")}` +
    "BCDEFGHI".split("").map((c) => blankCell(`${c}2`, qMid)).join("") + blankCell("J2", qEnd) + "</row>";
  sheet = sheet.replace(/<row r="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (m, r) => Number(r) < 2 ? m
    : shiftRowXml(m, 1).replace(/<f>([^<]*)<\/f>/g, (_, f) => `<f>${shiftRefs(f)}</f>`));
  sheet = sheet.replace(/(<row r="1"[^>]*>[\s\S]*?<\/row>)/, `$1${qRow}`);
  sheet = sheet.replace(/<mergeCell ref="([^"]+)"\/>/g, (_, ref) => `<mergeCell ref="${shiftRefs(ref)}"/>`)
    .replace("</mergeCells>", '<mergeCell ref="A2:J2"/></mergeCells>');
  sheet = sheet.replace(/<mergeCells count="\d+">/, () => `<mergeCells count="${(sheet.match(/<mergeCell ref=/g) || []).length}">`);
  sheet = sheet.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:K${bannerRow + 1}"/>`);
  drawing = drawing.replace(/<xdr:row>(\d+)<\/xdr:row>/g, (m, r) => Number(r) >= 1 ? `<xdr:row>${Number(r) + 1}</xdr:row>` : m);

  zip.file("xl/worksheets/sheet1.xml", sheet);
  zip.file("xl/drawings/drawing1.xml", drawing);
  zip.file("xl/drawings/_rels/drawing1.xml.rels", drawRels);
  zip.file("[Content_Types].xml", types);
  zip.file("xl/workbook.xml", workbook);
  zip.file("xl/styles.xml", styles.toXML());
  zip.file("docProps/core.xml", (await zip.file("docProps/core.xml").async("string"))
    .replace(/<dc:title>[\s\S]*?<\/dc:title>/, "")
    .replace("</cp:coreProperties>", `<dc:title>${xmlEsc("Quotation " + (q.number || ""))}</dc:title></cp:coreProperties>`));

  return zip.generateAsync({
    type: "blob", compression: "DEFLATE",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** quotation line -> the values printed in each column */
export function quoteLines(q) {
  return q.items.map((it) => ({ ...it, ...calcLine(it) }));
}
export { round2 };
