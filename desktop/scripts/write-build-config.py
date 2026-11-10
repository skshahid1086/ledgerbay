#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
web = Path(sys.argv[1])
prod = os.environ["PRODUCT"]
ver = os.environ["VERSION"]
app_id = os.environ["APP_ID"]
slug = os.environ["SLUG"]
parts = ver.split(".")
code = 0
if len(parts) == 3 and all(p.isdigit() for p in parts):
  code = int(parts[0]) * 10000 + int(parts[1]) * 100 + int(parts[2])
sw = f"{slug}-desktop-{ver}".replace(".", "-")
text = f'''/**
 * Desktop store build identity. VARIANT "store" → empty first run (lbIsProd).
 * Written by scripts/build-all.sh — never put real customer data here.
 */
window.LEDGERBAY_BUILD = Object.freeze({{
  APP_ID: {json.dumps(app_id)},
  APP_NAME: {json.dumps(prod)},
  VERSION: {json.dumps(ver)},
  VERSION_CODE: {code},
  VARIANT: "store",
  SW_CACHE: {json.dumps(sw)},
  DESKTOP: true
}});
'''
(web / "build-config.js").write_text(text)
print("build-config.js written VARIANT=store")
