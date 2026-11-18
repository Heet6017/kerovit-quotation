"""
Give the app's program files a new version stamp (run before every publish).

Browsers cache the website's files for a while; with a new stamp they always load the new
JavaScript/CSS together instead of mixing old and new files.

    python tools/bump_version.py
"""
import os, re, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(ROOT, "index.html")
html = open(p, encoding="utf-8").read()
v = time.strftime("%Y%m%d%H%M")
html = re.sub(r'(\.(?:js|css))\?v=[^"]*"', rf'\1?v={v}"', html)
html = html.replace('href="css/app.css"', f'href="css/app.css?v={v}"')
open(p, "w", encoding="utf-8", newline="").write(html)
print("version", v)
