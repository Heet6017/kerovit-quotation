# Kerovit Quotation Maker

A web app that makes Kerovit quotations in the company's Excel format. It downloads each quotation as Excel and PDF.

- Search products by code or keywords; each result shows its photo and MRP.
- Choose the quotation type (Retail / Special Approval / Project Supply) and a discount. The discount can also be changed for a single line.
- Excel output fills the original template (`assets/template.xlsx`), so the logos, header, colours and T&C stay the same.
- Update prices by uploading a new price-list PDF. The app shows every change before it saves anything.

## Privacy

The price list is published **encrypted** (`data/products.enc`, AES-256-GCM, key from a password).
The website asks for the password once on each computer. Plain-text price data (`data/products.json`, `.csv`) and the
price-list PDFs are excluded by `.gitignore` and never uploaded.

## Updating prices for everyone

1. On the website, go to **Price List → Update price list from a new PDF**, check the changes, then press **Apply update**.
2. Go to **Backup → Download for GitHub (encrypted)**.
3. In this repository, replace `data/products.enc` with the downloaded file (*Add file → Upload files*, then *Commit*).
   After about a minute, every computer gets the new prices.

## Rebuilding the database from the PDFs (developer)

```powershell
python -m pip install pymupdf cryptography
python tools/extract.py "D:\kervoit"     # -> data/products.json (private) + images/products/
python tools/encrypt_db.py               # asks for the password -> data/products.enc (publish this)
```

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/`, `js/` | The app (no build step; runs on GitHub Pages) |
| `js/xlsx-export.js` / `js/pdf-export.js` | Excel and PDF output |
| `js/pricelist.js` | Reads new price-list PDFs in the browser (pdf.js) |
| `data/products.enc` | Encrypted product database |
| `images/products/` | Product photos |
| `assets/` | Excel template, logos, Carlito font (metric-compatible with Calibri, SIL Open Font License) |
| `vendor/` | JSZip, jsPDF, pdf.js |
| `tools/` | Python extractor and encryption tool |
