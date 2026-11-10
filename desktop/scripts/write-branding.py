#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(sys.argv[1])
brand = {
  "productName": os.environ["PRODUCT"],
  "appId": os.environ["APP_ID"],
  "version": os.environ["VERSION"],
  "scheme": os.environ["SCHEME"],
  "slug": os.environ["SLUG"],
  "variant": "store",
}
(root / "electron" / "branding.json").write_text(json.dumps(brand, indent=2) + "\n")
print("branding.json", brand)
