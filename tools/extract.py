"""
Kerovit price-list extractor.

Reads the three Kerovit PDFs and writes:
  data/products.json   - the product database used by the quotation app
  data/products.csv    - same data, for opening in Excel
  data/extract_report.txt - per-page integrity checks (prices found vs prices assigned)

Usage:  python tools/extract.py <folder-with-pdfs>
"""
import json, re, sys, os, csv, collections
import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else r"D:\kervoit"
SOURCES = {
    "KLASSIC": "Klassic Price List - AIEK Oct 2026.pdf",
    "AURUM": "Aurum Price List Sept 2026- AIEK.pdf",
    "VANITY": "Kerovit Vanity Catalogue 2026_Small.pdf",
}
PRICE_LIST_DATE = {"KLASSIC": "Oct 2026", "AURUM": "Sept 2026", "VANITY": "2026"}

FINISH = {  # Aurum finish suffixes (from "Definition of Finish" page)
    "CP": "Chrome", "RG": "Rose Gold", "CG": "Champagne Gold", "GM": "Gunmetal",
    "CRG": "Chrome & Rose Gold", "MBRG": "Matte Black & Rose Gold", "CGL": "Chrome & Gold",
    "GW": "Glossy White", "MW": "Matte White", "GB": "Glossy Black", "MB": "Matte Black",
    "MBK": "Matte Black", "MG": "Matte Light Grey", "MC": "Matte Brown",
    "DGY": "Matte Dark Grey", "LGY": "Matte Light Grey",
}

CODE = r"[A-Z]{2,}[A-Z0-9\-]*\d[A-Z0-9\-\.]*"
CODE_LINE = re.compile(rf"^\s*({CODE}\*?(\s*/\s*(?:{CODE}|\d{{2}})\*?)*)\s*(\([^)]*\)\s*\*?)?\s*$")
NUM = r"\d{1,3}(?:,\d{2,4})+|\d{3,6}"   # ,\d{4} tolerates typos like "10,2300" (flagged)


def code_part(t):
    """'KA999992 (AUTO OPEN/CLOSE SEAT COVER)*' -> ('KA999992', 'Auto Open/Close Seat Cover')"""
    m = re.match(r"^\s*(.*?)\s*\(([^)]*)\)\s*\*?\s*$", t)
    if m:
        return m.group(1), m.group(2).title()
    return t, ""


def expand_codes(t):
    """'KA640007/08/09' -> ['KA640007','KA640008','KA640009'];  'A / B' -> ['A','B']"""
    parts = [c.strip().rstrip("*").strip() for c in t.split("/") if c.strip()]
    out = []
    for p in parts:
        if re.fullmatch(r"\d{2}", p) and out:
            out.append(out[-1][:-2] + p)
        else:
            out.append(p)
    return out


def suspicious(v):
    return bool(re.search(r",\d{4}", v))
RUPEE = "[`₹]"


def lines_of(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            spans = [s for s in l["spans"] if s["text"].strip()]
            if not spans:
                continue
            t = "".join(s["text"] for s in l["spans"]).strip()
            x0, y0, x1, y1 = l["bbox"]
            if x0 < 0 or x0 > page.rect.width:
                continue
            s = spans[0]
            out.append(dict(t=re.sub(r"\s+", " ", t), x0=x0, y0=y0, x1=x1, y1=y1,
                            size=round(s["size"], 1), font=s["font"],
                            bold=any(k in s["font"] for k in ("Bold", "Medium", "SemiBold"))))
    out.sort(key=lambda l: (round(l["y0"]), l["x0"]))
    return out


def is_title(t):
    letters = [ch for ch in t if ch.isalpha()]
    return bool(letters) and sum(ch.isupper() for ch in letters) >= 0.7 * len(letters)


def to_int(s):
    return int(s.replace(",", ""))


def split_codes(t):
    return [c.strip().rstrip("*").strip() for c in t.split("/") if c.strip()]


def clean(t):
    t = re.sub(r"\s+", " ", t).strip(" -,")
    t = t.replace("Compatable", "Compatible").replace("Avaliable", "Available")
    return t


def finish_of(code):
    m = re.search(r"-([A-Z]+)$", code)
    return FINISH.get(m.group(1), "") if m else ""


def product_images(page):
    """Product photo rectangles on the page (excludes QR codes, icons, full-page photos)."""
    W, H = page.rect.width, page.rect.height
    rects = []
    for info in page.get_image_info():
        r = pymupdf.Rect(info["bbox"]) & page.rect
        if r.is_empty or r.width < 4 or r.height < 4 or r.width > W - 20:
            continue
        if r.width * r.height > 0.25 * W * H:          # lifestyle photo
            continue
        if abs(r.width - r.height) < 4 and r.width < 45:  # QR code / feature icon
            continue
        rects.append(r)
    return rects


def nearest_img(rects, x, y, limit=200):
    best, out = limit, None
    for r in rects:
        if r.height > 400:      # decorative full-height strips
            continue
        cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
        d = ((cx - x) ** 2 + (cy - y) ** 2) ** 0.5
        if d < best:
            best, out = d, r
    return out


def union_in(rects, x0, y0, x1, y1):
    """Union of all image pieces whose centre lies inside the box (some photos are sliced into pieces)."""
    out = None
    for r in rects:
        cx, cy = (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2
        if x0 <= cx <= x1 and y0 <= cy <= y1:
            out = pymupdf.Rect(r) if out is None else out | r
    return out


# ---------------------------------------------------------------- generic (code anchors)

def generic_page(page, coll, state):
    L = lines_of(page)
    W = page.rect.width
    # headings
    for l in L:
        if coll == "KLASSIC":
            if l["size"] == 15.0 and l["y0"] < 110:
                state["series"] = l["t"].title()
            if l["size"] == 12.0 and l["y0"] < 45 and not l["bold"]:
                state["category"] = l["t"].title()
        elif coll == "AURUM":
            if l["size"] >= 20 and l["y0"] < 80:
                state["category"] = l["t"].title()
            if 14 <= l["size"] < 20 and 80 < l["y0"] < 120:
                state["series"] = l["t"].title()
    if coll == "KLASSIC":
        codes = [l for l in L if CODE_LINE.match(l["t"]) and l["bold"] and l["size"] >= 7]
    else:
        codes = [l for l in L if CODE_LINE.match(l["t"]) and l["bold"] and l["size"] >= 8.5]
    prices = []
    for l in L:
        t = l["t"]
        if coll == "KLASSIC":
            if re.fullmatch(r"Per Piece", t, re.I):   # price printed on the next line: "₹ 100 /200/300"
                nxt = [k for k in L if 0 < k["y0"] - l["y0"] < 10 and abs(k["x0"] - l["x0"]) < 3]
                if nxt:
                    t = "Per Piece " + nxt[0]["t"]
            m = re.search(rf"Per Piece\s*{RUPEE}?\s*((?:{NUM})(?:\s*/\s*(?:{NUM}))*)", t, re.I)
            if m:
                prices.append(dict(l, vals=[to_int(v) for v in re.split(r"\s*/\s*", m.group(1))],
                                   flag=suspicious(m.group(1))))
        else:
            m = re.match(rf"^{RUPEE}?\s*({NUM})$", t)
            if m and l["bold"] and l["size"] >= 8.5 and l["y0"] < page.rect.height - 60:
                prices.append(dict(l, vals=[to_int(m.group(1))], flag=suspicious(m.group(1))))
            else:  # "CODE*  ₹ 1,234" style handled by separate lines already
                pass
    # assign each price to the best code (same row to the right, or directly below)
    pairs = []
    for pi, p in enumerate(prices):
        for ci, c in enumerate(codes):
            dy = p["y0"] - c["y0"]
            dx = p["x0"] - c["x0"]
            if abs(dy) < 4 and dx > 0:
                cost = dx * 0.05
            elif abs(dy) < 24 and dx > 150 and coll == "AURUM":
                cost = 20 + abs(dy)
            elif 0 < dy < 90 and abs(dx) < 25:
                cost = dy
            else:
                continue
            pairs.append((cost, pi, ci))
    pairs.sort()
    used_p, used_c, link = set(), set(), {}
    for cost, pi, ci in pairs:
        if pi in used_p or ci in used_c:
            continue
        used_p.add(pi); used_c.add(ci); link[ci] = pi
    imgs = product_images(page)
    items, problems = [], []
    if len(prices) != len(used_p):
        problems.append(f"{len(prices) - len(used_p)} price(s) not linked to a code")
    for ci, c in enumerate(codes):
        if ci not in link:
            problems.append(f"code {c['t']} has no price")
            continue
        p = prices[link[ci]]
        # name: lines under the code (or under the stack of codes) aligned with it
        name_lines, last_y = [], c["y1"]
        for l in L:
            if l["y0"] <= c["y0"] + 1 or abs(l["x0"] - c["x0"]) > 3:
                continue
            if l["y0"] - last_y > 16:
                break
            if CODE_LINE.match(l["t"]) and l["bold"]:
                last_y = l["y1"]; continue          # another code in the same stack
            if re.search(rf"Per Piece|^{RUPEE}?\s*({NUM})$", l["t"]):
                if coll == "KLASSIC":
                    break
                last_y = l["y1"]; continue
            name_lines.append(l["t"]); last_y = l["y1"]
        # Klassic text in a different block may sit slightly off; also catch lines between code & price
        if coll == "KLASSIC":
            extra = [l["t"] for l in L if abs(l["x0"] - c["x0"]) <= 3 and c["y1"] < l["y0"] < p["y0"]
                     and l["t"] not in name_lines and not CODE_LINE.match(l["t"])]
            if extra:
                name_lines = sorted(set(name_lines + extra),
                                    key=lambda t: next(l["y0"] for l in L if l["t"] == t))
        name = clean(" ".join(name_lines))
        details = ""
        m = re.search(r"(Height\s*[:\-]?\s*\d+\s*mm)", name, re.I)
        if m:
            details = m.group(1); name = clean(name.replace(m.group(1), ""))
        # image: closest product photo above (Klassic) or left (Aurum) of the code
        if coll == "KLASSIC":
            # the cell above the code, down from the previous product's price line in this column
            top = max([q["y1"] for q in prices if abs(q["x0"] - c["x0"]) < 20 and q["y1"] < c["y0"]] + [c["y0"] - 170])
            img = union_in(imgs, c["x0"] - 15, top, c["x0"] + 150, c["y0"])
        else:
            # the strip left of the code, between the rows above and below
            col = sorted([o for o in codes if abs(o["x0"] - c["x0"]) < 20], key=lambda o: o["y0"])
            i = next(k for k, o in enumerate(col) if o is c)
            a = b = i                                   # stretch over a stack of codes listed together
            while a > 0 and col[a]["y0"] - col[a - 1]["y0"] < 20: a -= 1
            while b < len(col) - 1 and col[b + 1]["y0"] - col[b]["y0"] < 20: b += 1
            top = (col[a - 1]["y0"] + col[a]["y0"]) / 2 + 10 if a > 0 else col[a]["y0"] - 120
            bot = (col[b + 1]["y0"] + col[b]["y0"]) / 2 + 10 if b < len(col) - 1 else col[b]["y0"] + 120
            img = union_in(imgs, 0, top, c["x0"] - 2, bot)
        if img is None:
            img = nearest_img(imgs, c["x0"], c["y0"])
        ctext, extra_name = code_part(c["t"])
        if extra_name:
            name = clean(f"{name} ({extra_name})")
        codelist = expand_codes(ctext)
        flag = "Price looks mis-printed in PDF - verify" if p.get("flag") else ""
        if len(p["vals"]) > 1 and len(codelist) == len(p["vals"]):
            # shorthand like KA640007/08/09 with 3 sizes and 3 prices -> one item each
            sizes = re.findall(r'(\d+\s*["\u201d]\s*-\s*[\dX\. ]+mm)', name)
            base = clean(re.sub(r'\d+\s*["\u201d]\s*-\s*[\dX\. ]+mm\)?', "", name))
            if not sizes:   # 'Extension Nipple 1"/1.5"/2"/2.5"/3"'
                m2 = re.search(r'(\d+(?:\.\d+)?["\u201d](?:\s*/\s*\d+(?:\.\d+)?["\u201d])+)', name)
                if m2:
                    sizes = [s.strip() for s in m2.group(1).split("/")]
                    base = clean(name.replace(m2.group(1), ""))
                    base = clean(re.sub(r"\bPer Piece\b.*$", "", base))
            for i, (cd, val) in enumerate(zip(codelist, p["vals"])):
                items.append(dict(code=cd, alt_codes=[], name=base, details=sizes[i] if i < len(sizes) else "",
                                  variant=sizes[i].split("-")[0].strip() if i < len(sizes) else "", mrp=val, _img=img, flag=flag))
            continue
        if coll == "AURUM" and len(codelist) > 1:   # "KB2211022 / KB2311022 / KB911022-RG": last is the finish SKU
            codelist = [codelist[-1]] + codelist[:-1]
        for vi, val in enumerate(p["vals"]):
            items.append(dict(code=codelist[0], alt_codes=codelist[1:], name=name, details=details,
                              variant="" if len(p["vals"]) == 1 else f"Option {vi + 1}",
                              mrp=val, _img=img, flag=flag))
    return items, problems, len(prices)


# ---------------------------------------------------------------- Klassic sanitaryware blocks

HEADER = re.compile(r"^(?P<name>[A-Z0-9][A-Z0-9 ()\"'\u201d\u2019\.\-&]*?)\s+-\s+(?P<codes>[A-Z]{1,}[A-Z0-9\-]*\s*\*?(\s*/\s*[A-Z]{1,}[A-Z0-9\-]*\s*\*?)*)\s*(?P<col>White)?\s*$")
PRICE_IN = re.compile(rf"{RUPEE}\s*({NUM})")


def klassic_blocks_page(page, state):
    L = lines_of(page)
    W, H = page.rect.width, page.rect.height
    for l in L:
        if l["size"] >= 14 and not l["bold"] and l["y0"] < 140 and is_title(l["t"]):
            state["series"] = l["t"].title()
    heads = []
    for l in L:
        if l["bold"] and l["size"] <= 8 and HEADER.match(l["t"]):
            heads.append(l)
        elif l["bold"] and l["size"] <= 8 and CODE_LINE.match(l["t"]):
            # a code-only header (e.g. KSPPC-001) has no text right above it; an inline variant code does
            above = [k for k in L if k is not l and 0 < l["y0"] - k["y0"] < 16 and abs(k["x0"] - l["x0"]) < 8]
            if not above:
                heads.append(l)
    # sub-section titles (e.g. EXTENDED WALL HUNG) further down the page
    titles = [l for l in L if l["size"] >= 14 and not l["bold"] and is_title(l["t"])]
    all_price_tokens = sum(len(PRICE_IN.findall(l["t"])) for l in L if l["size"] <= 8)
    items, problems, assigned = [], [], 0
    imgs = product_images(page)
    for h in heads:
        m = HEADER.match(h["t"])
        if m:
            pname = m.group("name").strip().title()
            codes = split_codes(m.group("codes"))
        else:
            pname, codes = "", expand_codes(h["t"])
        right = min([o["x0"] for o in heads if o["x0"] > h["x0"] + 100] + [W + 10]) - 10
        below = min([o["y0"] for o in heads + titles if o is not h and o["y0"] > h["y0"] + 5
                     and o["x0"] < right and (o in titles or abs(o["x0"] - h["x0"]) < 60)] + [H - 12])
        sub = state["series"]
        for t in titles:
            if t["y0"] < h["y0"] and abs(t["x0"] - 30) < 30:
                sub = t["t"].title()
        blk = [l for l in L if l is not h and h["y0"] + 2 < l["y0"] < below and h["x0"] - 4 <= l["x0"] < right
               and l["size"] <= 8 and not l["t"].startswith("* Products") and not re.fullmatch(r"\d{1,3}", l["t"])]
        # merge lines into visual rows
        rows = []
        for l in sorted(blk, key=lambda l: (l["y0"], l["x0"])):
            if rows and abs(rows[-1]["y0"] - l["y0"]) < 2.5:
                rows[-1]["parts"].append(l)
            else:
                rows.append(dict(y0=l["y0"], parts=[l]))
        text_rows = []
        for r in rows:
            parts = sorted(r["parts"], key=lambda l: l["x0"])
            txt = " ".join(p["t"] for p in parts)
            if txt.strip() in ("White",):
                continue
            text_rows.append(txt)
        opts, pending = [], []
        cur_code = codes[0]
        # split rows that carry two prices ("... ₹ 1,111 Box Rim ... ₹ 2,222") into segments
        segs = []
        for txt in text_rows:
            pieces = re.split(rf"({RUPEE}\s*(?:{NUM}))", txt)
            if len(pieces) <= 3:
                segs.append(txt); continue
            for i in range(0, len(pieces) - 1, 2):
                segs.append((pieces[i] + pieces[i + 1]).strip())
            if pieces[-1].strip():
                segs.append(pieces[-1].strip())
        for txt in segs:
            row_code = None
            mcode = re.match(rf"^(?:Also available\s+)?({CODE})(\s*:\s*|\s*$|\s+(?=[A-Z][a-z]))(.*)$", txt)
            if mcode and not re.match(r"^KS\d+E?$|^KSPKP|^KSMV|^KS0", mcode.group(1)):
                rest = mcode.group(3)
                if txt.startswith("Also") or not rest:
                    cur_code = mcode.group(1)            # e.g. "KGP10008WJ-PP" on its own row
                    txt = rest
                    if not txt:
                        pending = []; continue
                elif PRICE_IN.search(rest):
                    row_code = mcode.group(1)            # "CODE : Full Pedestal ... ₹ 1,234" (this row only)
                    txt = rest
            prices = PRICE_IN.findall(txt)
            label = clean(PRICE_IN.sub("", txt))
            if not prices:
                pending.append(label); continue
            label = clean(re.sub(r"\b(White\s+)?(Per Piece|per piece)\b", "", label, flags=re.I))
            if row_code:
                label = clean(f"{row_code}: {label}")
            opts.append(dict(label=label, before=pending, price=to_int(prices[0]), code=row_code or cur_code,
                             flag=suspicious(prices[0])))
            pending = []
        if pending and opts:
            opts[-1]["after"] = pending
        assigned += len(opts)
        prev_bottom = max([o["y0"] for o in heads + titles if o["y0"] < h["y0"] - 20 and abs(o["x0"] - h["x0"]) < 60] + [h["y0"] - 260])
        top = max(prev_bottom + 20, h["y0"] - 260)
        img = union_in(imgs, h["x0"] - 20, top, min(h["x0"] + 145, right), h["y0"])
        if not opts:
            problems.append(f"{h['t']}: no price found")
        items.append(dict(head=h["t"], name=pname, codes=codes, sub=sub, rows=text_rows, opts=opts, _img=img))
    if assigned != all_price_tokens:
        problems.append(f"price tokens on page {all_price_tokens}, assigned {assigned}")
    return items, problems, all_price_tokens


def table_page(page, state):
    """Tables such as SEAT COVERS: CODE | DESCRIPTION | PRICE on one row."""
    L = lines_of(page)
    for l in L:
        if l["size"] >= 14 and l["y0"] < 140:
            state["series"] = l["t"].title()
    items = []
    codes = [l for l in L if CODE_LINE.match(l["t"]) and l["bold"] and l["x0"] < 150]
    for c in codes:
        row = [l for l in L if abs(l["y0"] - c["y0"]) < 4 and l is not c]
        price = [l for l in row if PRICE_IN.search(l["t"])]
        desc = [l["t"] for l in row if l not in price]
        if price:
            items.append(dict(code=c["t"].rstrip("*"), name=clean(" ".join(desc)),
                              mrp=to_int(PRICE_IN.search(price[0]["t"]).group(1))))
    return items


# ---------------------------------------------------------------- Vanity

def vanity_page(page, state):
    L = lines_of(page)
    codes = [l for l in L if re.match(r"^KAJ\d{4}(-[A-Z]+)?\*?$", l["t"])]
    out = []
    for c in codes:
        # name = big uppercase line right above the code
        above = [l for l in L if 3 < c["y0"] - l["y0"] < 30 and abs(l["x0"] - c["x0"]) < 6 and l["t"].isupper()]
        above.sort(key=lambda l: c["y0"] - l["y0"])
        name = above[0]["t"].title() if above else ""
        near = [l for l in L if -2 < l["y0"] - c["y0"] < 140 and -5 < l["x0"] - c["x0"] < 260 and l is not c]
        # price: first number after a 'Per Piece' label, nearest to the code
        prices = [l for l in L if re.match(rf"^{RUPEE}?\s*({NUM})$", l["t"]) and l["y0"] > c["y0"]]
        prices.sort(key=lambda l: (l["y0"] - c["y0"]) + abs(l["x0"] - c["x0"]) * 0.5)
        if not prices:
            continue
        price = to_int(re.search(NUM, prices[0]["t"]).group(0))
        def val_after(label):
            for l in L:
                if l["t"].startswith(label) and -5 < l["y0"] - c["y0"] < 140 and -5 < l["x0"] - c["x0"] < 260:
                    rest = l["t"][len(label):].strip(" :")
                    if rest: return rest
                    below = [k for k in L if 0 < k["y0"] - l["y0"] < 14 and abs(k["x0"] - l["x0"]) < 4]
                    if below: return below[0]["t"]
            return ""
        cab, mir = val_after("Cabinet Size"), val_after("Cabinet Mirror Size")
        feats = [l["t"] for l in near if "Technology" in l["t"] or "LED" in l["t"]]
        out.append(dict(code=c["t"].rstrip("*"), name=name, cab=cab, mir=mir, feat=feats[0] if feats else "",
                        mrp=price, _y=c["y0"]))
    # pages with a series title but the code on the next page: name fallback
    return out, L


# ---------------------------------------------------------------- main

def main():
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    img_dir = os.path.join(ROOT, "images", "products")
    os.makedirs(img_dir, exist_ok=True)

    def hd_dpi(clip):
        # HD photos: ~800 px on the long side (sharp in Excel/PDF), capped at 300 dpi
        longest = max(clip.width, clip.height) / 72.0
        return max(110, min(300, int(800 / longest)))
    products, report = [], []
    seen = collections.Counter()

    textless_cache = {}

    def textless(page):
        """Copy of the page with all text removed, so no photo can show a price or code."""
        key = (page.parent.name, page.number)
        if key not in textless_cache:
            textless_cache.clear()          # keep only the current page in memory
            tmp = pymupdf.open()
            tmp.insert_pdf(page.parent, from_page=page.number, to_page=page.number)
            tp = tmp[0]
            for b in tp.get_text("dict")["blocks"]:
                if b.get("type") == 0:
                    tp.add_redact_annot(b["bbox"])
            tp.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE)
            textless_cache[key] = (tmp, tp)
        return textless_cache[key][1]

    def save_img(page, rect, pid):
        if rect is None:
            return ""
        pad = 2
        clip = pymupdf.Rect(rect.x0 - pad, rect.y0 - pad, rect.x1 + pad, rect.y1 + pad) & page.rect
        pix = textless(page).get_pixmap(dpi=hd_dpi(clip), clip=clip)
        fn = f"{pid}.jpg"
        pix.save(os.path.join(img_dir, fn), jpg_quality=86)
        return f"images/products/{fn}"

    def add(coll, page_no, page, category, series, sub, code, name, mrp, rect=None, **kw):
        pid = re.sub(r"[^A-Za-z0-9\-]", "_", code)
        seen[pid] += 1
        if seen[pid] > 1:
            pid = f"{pid}__{seen[pid]}"
        products.append(dict(
            id=pid, collection=coll, category=category, sub_category=sub, series=series,
            code=code, alt_codes=kw.get("alt_codes", []), name=name, variant=kw.get("variant", ""),
            details=kw.get("details", ""), finish=kw.get("finish", ""), colour=kw.get("colour", ""),
            mrp=mrp, unit="Piece", price_list=PRICE_LIST_DATE[coll],
            source=f"{SOURCES[coll]} p.{page_no}", page=page_no,
            image=save_img(page, rect, pid) if rect else "", flag=kw.get("flag", ""),
        ))

    # ---- KLASSIC
    d = pymupdf.open(os.path.join(SRC, SOURCES["KLASSIC"]))
    st = dict(series="", category="Faucet")
    for pn, page in enumerate(d, 1):
        if pn >= 118:  # Green-Pro certification lists, not a price list
            continue
        text = page.get_text()
        L = lines_of(page)
        if any(HEADER.match(l["t"]) and l["bold"] and l["size"] <= 8 for l in L):
            st["category"] = "Sanitaryware"
            items, probs, n = klassic_blocks_page(page, st)
            for it in items:
                opts = it["opts"]
                SPEC = re.compile(r"^(Open\s+)?(P-Trap|S-Trap|Size|Cistern\s*:|Twin Flush)", re.I)
                trap_varies = any("Trap" in " ".join(o["before"]) for o in opts[1:])
                desc_rows = []
                if opts:
                    b0 = opts[0]["before"]
                    k = next((i for i, x in enumerate(b0) if re.match(r"^(with|Box Rim)\b", x, re.I)), len(b0))
                    desc_rows = [x for x in b0[:k] if not (trap_varies and "Trap" in x)]
                for oi, o in enumerate(opts):
                    label = o["label"]
                    before = [x for x in o["before"] if x not in desc_rows and not (SPEC.match(x) and not (trap_varies and "Trap" in x))]
                    if oi == 0 and not o["before"] and label:
                        variant = label           # e.g. "Washdown Wall Hung with ₹ 1,234" (the bowl alone)
                    else:
                        variant = clean(" ".join(before + ([label] if label else [])))
                    if not variant and len(opts) == 1:
                        variant = ""
                    nm = f"{it['name']} {it['sub']}".strip() if it["name"] else (desc_rows[0] if desc_rows else it["sub"])
                    add("KLASSIC", pn, page, "Sanitaryware", it["name"] or it["sub"], it["sub"], o["code"],
                        nm, o["price"], it["_img"],
                        alt_codes=[c for c in it["codes"] if c != o["code"]] if o["code"] == it["codes"][0] else [],
                        variant=clean(variant).replace("`", "₹"),
                        details="; ".join(desc_rows) or "; ".join(clean(r) for r in it["rows"] if SPEC.match(r) and not PRICE_IN.search(r)),
                        flag="Price looks mis-printed in PDF - verify" if o.get("flag") else "",
                        colour="White" if "White" in it["head"] or "White" in " ".join(it["rows"]) else "")
            report.append(f"KLASSIC p{pn} [blocks] products={len(items)} price-tokens={n} " + ("; ".join(probs) if probs else "OK"))
            continue
        if re.search(r"\bCODE\b", text) and re.search(r"\bPRICE\b", text):
            items = table_page(page, st)
            for it in items:
                add("KLASSIC", pn, page, "Sanitaryware", st["series"], st["series"], it["code"], it["name"], it["mrp"])
            report.append(f"KLASSIC p{pn} [table] rows={len(items)}")
            continue
        items, probs, n = generic_page(page, "KLASSIC", st)
        if not items and not n:
            continue
        for it in items:
            add("KLASSIC", pn, page, st["category"], st["series"], st["series"], it["code"], it["name"], it["mrp"],
                it["_img"], alt_codes=it["alt_codes"], variant=it["variant"], details=it["details"], flag=it["flag"])
        report.append(f"KLASSIC p{pn} [{st['category']}/{st['series']}] items={len(items)} prices={n} " + ("; ".join(probs) if probs else "OK"))

    # ---- AURUM
    d = pymupdf.open(os.path.join(SRC, SOURCES["AURUM"]))
    st = dict(series="", category="")
    for pn, page in enumerate(d, 1):
        if pn < 10:
            continue
        items, probs, n = generic_page(page, "AURUM", st)
        if not items and not n:
            continue
        for it in items:
            add("AURUM", pn, page, st["category"], st["series"], st["series"], it["code"], it["name"].title() if it["name"].isupper() else it["name"],
                it["mrp"], it["_img"], alt_codes=it["alt_codes"], details=it["details"], finish=finish_of(it["code"]),
                variant=it["variant"], flag=it["flag"])
        report.append(f"AURUM p{pn} [{st['category']}/{st['series']}] items={len(items)} prices={n} " + ("; ".join(probs) if probs else "OK"))

    # ---- VANITY
    d = pymupdf.open(os.path.join(SRC, SOURCES["VANITY"]))
    st = dict(series="", category="Vanity")
    for pn, page in enumerate(d, 1):
        items, L = vanity_page(page, st)
        for it in items:
            # photo: the largest product image on the page that isn't the mood photo
            # Vanity photos are baked into a full-page background, so crop the product area
            # below the mood photo and render it with the page text removed.
            W, H = page.rect.width, page.rect.height
            if len(items) == 1:
                rect = pymupdf.Rect(40, 520, W - 40, H - 40)
            else:
                cx = next(l["x0"] for l in L if l["t"].rstrip("*") == it["code"])
                rect = pymupdf.Rect(40 if cx < W / 2 else W / 2, 520, W / 2 if cx < W / 2 else W - 40, it["_y"] - 22)
            rect.tag_textless = True
            nm = it["name"] or st.get("last_title", "")
            details = "; ".join(x for x in [f"Cabinet {it['cab']}" if it["cab"] else "", f"Mirror {it['mir']}" if it["mir"] else "", it["feat"]] if x)
            add("VANITY", pn, page, "Vanity", nm, "Vanity", it["code"], f"{nm} Vanity Set".strip(), it["mrp"], rect, details=details,
                flag="" if nm else "Name not found - check")
        report.append(f"VANITY p{pn} items={len(items)}") if items else None

    # ---- write
    for p in products:
        p.pop("_img", None)
    with open(os.path.join(ROOT, "data", "products.json"), "w", encoding="utf-8") as f:
        json.dump(products, f, ensure_ascii=False, indent=1)
    with open(os.path.join(ROOT, "data", "products.csv"), "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(products[0].keys()))
        w.writeheader()
        for p in products:
            w.writerow({**p, "alt_codes": " / ".join(p["alt_codes"])})
    with open(os.path.join(ROOT, "data", "extract_report.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(report))
    c = collections.Counter(p["collection"] for p in products)
    print("products:", len(products), dict(c))
    print("problem pages:")
    for r in report:
        if not r.endswith("OK") and "[table]" not in r and not r.startswith("VANITY"):
            print("  ", r)


if __name__ == "__main__":
    main()
