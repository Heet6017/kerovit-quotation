// Excel export: fills the real template (assets/template.xlsx) by editing its XML directly,
// so the logos, header text boxes, colours, borders and T&C stay exactly as designed.
// (Excel libraries such as ExcelJS drop the template's text boxes, so they can't be used.)
import { calcLine, calcQuote, fmtDate, productLabel, seriesLabel, loadImageScaled, round2 } from "./common.js";
import { imageURL } from "./store.js";

const TEMPLATE_URL = "assets/template.xlsx";
const FIRST_DATA_ROW = 4;      // template product rows are 4..27, row 28 is the white spacer row
const TEMPLATE_DATA_ROWS = 24;
const SPACER_ROW = 28;
const LAST_ROW = 44;
const EMU_PX = 9525, EMU_PT = 12700;
const COL_E_PX = 100;          // photo column widened to 14.29 (≈100 px); Qty / Disc.% slimmed to 6.0 (≈42 px)
const COLS_XML = '<col min="5" max="5" width="14.2890625" style="1" customWidth="1"/><col min="6" max="6" width="8.7265625" style="1"/>' +
  '<col min="7" max="8" width="6" style="1" customWidth="1"/><col min="9" max="16384" width="8.7265625" style="1"/>';

const xmlEsc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const colOf = (i) => "ABCDEFGHIJK"[i];

// Indian-grouped rupee format with paise: ₹1,02,300.00
const INR_FMT = '[&gt;=10000000]&quot;₹&quot;##\\,##\\,##\\,##0.00;[&gt;=100000]&quot;₹&quot;##\\,##\\,##0.00;&quot;₹&quot;#,##0.00';

class Styles {
  constructor(xml) {
    this.xml = xml;
    const m = xml.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
    this.count = Number(m[1]);
    this.added = [];
    this.cache = new Map();
    this.xfs = m[2].match(/<xf [\s\S]*?(?:\/>|<\/xf>)/g);
    this.fontCount = Number(xml.match(/<fonts count="(\d+)"/)[1]);
    // light-blue fills for the alternating product rows
    const nFills = Number(this.xml.match(/<fills count="(\d+)"/)[1]);
    const solid = (rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
    this.xml = this.xml.replace(/<fills count="\d+"/, `<fills count="${nFills + 2}"`)
      .replace("</fills>", solid("FFF4F8FD") + solid("FFE3EDF9") + "</fills>");
    this.rowFill = { even: nFills, odd: nFills + 1 };
    // add the rupee number format
    this.xml = this.xml.replace(/<numFmts count="(\d+)">/, (_, n) => `<numFmts count="${Number(n) + 1}">`)
      .replace("</numFmts>", `<numFmt numFmtId="165" formatCode="${INR_FMT}"/></numFmts>`);
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

function textboxPara(label, value, small) {
  const lab = `<a:r><a:rPr lang="en-US" sz="1100" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>${xmlEsc(label)}</a:t></a:r>`;
  const val = value ? `<a:r><a:rPr lang="en-US" sz="${small ? 950 : 1100}" b="0"><a:solidFill><a:srgbClr val="1C2733"/></a:solidFill></a:rPr><a:t>${xmlEsc(value)}</a:t></a:r>` : "";
  return `<a:p>${lab}${val}</a:p>`;
}

function setTextbox(drawing, name, label, value, { cx, cy, small } = {}) {
  const re = new RegExp(`<xdr:oneCellAnchor>(?:(?!</xdr:oneCellAnchor>)[\\s\\S])*?name="${name}"[\\s\\S]*?</xdr:oneCellAnchor>`);
  return drawing.replace(re, (anchor) => {
    let a = anchor.replace(/<a:p>[\s\S]*<\/a:p>/, textboxPara(label, value, small));
    if (cx || cy) {
      a = a.replace(/<xdr:ext cx="(\d+)" cy="(\d+)"\/>/, (_, x, y) => `<xdr:ext cx="${cx || x}" cy="${cy || y}"/>`)
        .replace(/<a:ext cx="(\d+)" cy="(\d+)"\/>/, (_, x, y) => `<a:ext cx="${cx || x}" cy="${cy || y}"/>`);
    }
    return a;
  });
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
  const baseH = items.length && !settings.keepRows ? Math.max(50, Math.min(100, Math.floor(280 / items.length))) : 50;
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
  const after = [];
  for (let r = SPACER_ROW; r <= LAST_ROW; r++) {
    let x = shiftRowXml(rows[r], delta);
    const nr = r + delta;
    if (r === 29) x = x.replace(new RegExp(`<c r="J${nr}" s="(\\d+)"[^>]*>[\\s\\S]*?</c>`),
      (_, s) => fCell(`J${nr}`, styles.withFmt(Number(s), 165), `SUM(J${FIRST_DATA_ROW}:J${lastData})`, tot.sub));
    if (r === 30) {
      x = x.replace(new RegExp(`<c r="J${nr}" s="(\\d+)"[^>]*>[\\s\\S]*?</c>`),
        (_, s) => fCell(`J${nr}`, styles.withFmt(Number(s), 165), `ROUND(J${nr - 1}*${settings.gst}/100,2)`, tot.gst));
      if (Number(settings.gst) !== 18) x = x.replace(new RegExp(`<c r="A${nr}" s="(\\d+)" t="s"><v>\\d+</v></c>`),
        (_, s) => strCell(`A${nr}`, s, `ADD GST @ ${settings.gst}%`));
    }
    if (r === 31) x = x.replace(new RegExp(`<c r="J${nr}" s="(\\d+)"[^>]*>[\\s\\S]*?</c>`),
      (_, s) => fCell(`J${nr}`, styles.withFmt(Number(s), 165), `J${nr - 2}+J${nr - 1}`, tot.grand));
    if (r === 44 && settings.closing) {
      // closing banner in the bottom row: white bold text on navy, "Bathrooms You Desire" larger
      const fid = styles.addFont('<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>');
      const navy = 6;   // template fill #1F4E78 (table heading colour)
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
    if (r >= 33 && r <= 43) {
      const term = settings.terms[r - 33];
      if (term !== undefined) x = x.replace(new RegExp(`<c r="A${nr}" s="(\\d+)" t="s"><v>\\d+</v></c>`),
        (_, s) => strCell(`A${nr}`, s, term));
    }
    after.push(x);
  }

  const before = [1, 2, 3].map((r) => rows[r]).join("");
  sheet = sheet.replace(/<sheetData>[\s\S]*<\/sheetData>/, `<sheetData>${before}${dataXml.join("")}${after.join("")}</sheetData>`);
  sheet = sheet.replace(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/g, (m, c1, r1, c2, r2) =>
    Number(r1) >= SPACER_ROW ? `<mergeCell ref="${c1}${Number(r1) + delta}:${c2}${Number(r2) + delta}"/>` : m);
  if (settings.closing) {
    sheet = sheet.replace(/<mergeCells count="(\d+)">/, (_, n) => `<mergeCells count="${Number(n) + 1}">`)
      .replace("</mergeCells>", `<mergeCell ref="A${LAST_ROW + delta}:J${LAST_ROW + delta}"/></mergeCells>`);
  }
  sheet = sheet.replace(/<col min="5" max="16384" [^>]*\/>/, COLS_XML);
  sheet = sheet.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:K${LAST_ROW + delta}"/>`);
  // print: A4, fit all columns on the page width, header row repeated on every page
  sheet = sheet.replace(/<pageSetup [^>]*\/>/, '<pageSetup paperSize="9" fitToHeight="0" orientation="portrait" r:id="rId1"/>');
  if (!sheet.includes("<sheetPr")) sheet = sheet.replace("<dimension", '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension');
  sheet = sheet.replace(/<pageMargins [^>]*\/>/, '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>');
  sheet = sheet.replace(/<selection [^>]*\/>/, '<selection activeCell="A1" sqref="A1"/>');

  // ---- header text boxes (row 2)
  // left boxes span columns A–E (≈411 px), right boxes columns F–J (≈305 px)
  const addrLen = (q.address || "").length;
  drawing = setTextbox(drawing, "TextBox 8", "Quotation Date: ", fmtDate(q.date), { cx: 3800000 });
  drawing = setTextbox(drawing, "TextBox 4", "Customer Name: ", q.customer, { cx: 3800000 });
  drawing = setTextbox(drawing, "TextBox 5", "Quotation Type: ", q.type, { cx: 3800000 });
  drawing = setTextbox(drawing, "TextBox 6", "Project / Site Address: ", q.address,
    { cx: 2450000, cy: addrLen > 20 ? 575000 : 264560, small: addrLen > 30 });
  drawing = setTextbox(drawing, "TextBox 7", "Mobile Number: ", q.mobile, { cx: 2400000 });
  // Kerovit logos: fixed size at their true proportions (not stretched between cells), right edge in column J.
  // The T&C logo moves with the rows.
  drawing = drawing.replace(/<xdr:twoCellAnchor>((?:(?!<\/xdr:twoCellAnchor>)[\s\S])*?)<\/xdr:twoCellAnchor>/g, (m, inner) => {
    const one = (col, off, row, rowOff, cx, cy) => "<xdr:oneCellAnchor>" + inner.replace(/<xdr:from>[\s\S]*?<\/xdr:to>/,
      `<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>${off}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${rowOff}</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/>`) +
      "</xdr:oneCellAnchor>";
    if (m.includes('name="Picture 2"')) return one(6, 53340, 0, 82550, 1847850, 636145);
    if (m.includes('name="Picture 9"')) return one(7, 180000, 40 + delta, 69851, 1320800, 454702);
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
  const productsFitPage1 = 186.5 + heights.reduce((a, h) => a + h, 0) <= 770;
  if (!productsFitPage1 && !workbook.includes("_xlnm.Print_Titles")) {
    workbook = workbook.replace("</sheets>", '</sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">Sheet1!$3:$3</definedName></definedNames>');
  }

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
