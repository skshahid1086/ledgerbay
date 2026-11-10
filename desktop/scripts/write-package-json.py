#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
root = Path(sys.argv[1])
prod = os.environ["PRODUCT"]
ver = os.environ["VERSION"]
app_id = os.environ["APP_ID"]
slug = os.environ["SLUG"]
p = root / "package.json"
data = json.loads(p.read_text())
data["name"] = slug
data["productName"] = prod
data["version"] = ver
data["description"] = f"{prod} — offline GST billing for desktop"
data["author"] = {"name": "Sk Sahid", "email": "skshahid1086@users.noreply.github.com"}
data["homepage"] = "https://github.com/skshahid1086/ledgerbay"
data["license"] = "UNLICENSED"
data["private"] = True
b = data.setdefault("build", {})
b["appId"] = app_id
b["productName"] = prod
b["copyright"] = "Copyright © 2026 Sk Sahid"
b["directories"] = {"output": "dist", "buildResources": "build"}
b["files"] = [
  "electron/**/*", "web/**/*", "package.json", "!**/*.map",
  "!web/sync-data/**", "!web/sync-data-test-*/**",
  "!web/personal-seed.json", "!web/ledgerbay-mydata-backup.json",
]
b["asar"] = True
b["asarUnpack"] = ["web/server.mjs", "web/**/*.ttf"]
b["forceCodeSigning"] = False
b["electronDownload"] = {"mirror": "https://github.com/electron/electron/releases/download/"}
b["win"] = {
  "target": [{"target": "portable", "arch": ["x64"]}, {"target": "zip", "arch": ["x64"]}],
  "icon": "build/icon.ico",
  "artifactName": "${productName}-${version}-win.${ext}",
  "signAndEditExecutable": False,
}
b["portable"] = {"artifactName": "${productName}-Portable-${version}.exe"}
b["nsis"] = {
  "oneClick": False, "perMachine": False, "allowToChangeInstallationDirectory": True,
  "createDesktopShortcut": True, "createStartMenuShortcut": True,
  "shortcutName": prod, "installerIcon": "build/icon.ico", "uninstallerIcon": "build/icon.ico",
  "artifactName": "${productName}-Setup-${version}.exe",
}
b["linux"] = {
  "target": [{"target": "AppImage", "arch": ["x64"]}, {"target": "deb", "arch": ["x64"]}],
  "category": "Office", "icon": "build",
  "artifactName": "${productName}-${version}-${arch}.${ext}",
  "desktop": {
    "Name": prod, "Comment": "Offline GST billing",
    "Categories": "Office;Finance;", "StartupWMClass": prod,
  },
  "synopsis": "Offline GST billing for Indian MSMEs",
  "description": f"{prod} offline GST billing desktop app",
}
b["deb"] = {
  "packageCategory": "office",
  "maintainer": "Sk Sahid <skshahid1086@users.noreply.github.com>",
  "depends": ["libgtk-3-0", "libnotify4", "libnss3", "libxss1", "libxtst6", "xdg-utils", "libatspi2.0-0", "libuuid1"],
}
# Microsoft Store / AppX (MSIX). Public Partner Center values committed;
# optional env overrides: MS_STORE_IDENTITY_NAME, MS_STORE_PUBLISHER,
# MS_STORE_PUBLISHER_DISPLAY_NAME, MS_STORE_DISPLAY_NAME, MS_STORE_APPLICATION_ID.
# Package version uses getVersionInWeirdWindowsForm(setBuildNumber=false) → x.y.z.0
# (last segment must be 0 for Store). Package Family Name: SkSahid.Ledgerbay_k3en84vjpw33r
# Store ID: 9P2S6F5QWN88. Left UNSIGNED — Partner Center re-signs.
b["appx"] = {
  "identityName": os.environ.get("MS_STORE_IDENTITY_NAME", "SkSahid.Ledgerbay"),
  "publisher": os.environ.get("MS_STORE_PUBLISHER", "CN=799D416F-D7A9-40FB-8174-601BA874AB3C"),
  "publisherDisplayName": os.environ.get("MS_STORE_PUBLISHER_DISPLAY_NAME", "Sk Sahid"),
  "applicationId": os.environ.get("MS_STORE_APPLICATION_ID", "Ledgerbay"),
  "displayName": os.environ.get("MS_STORE_DISPLAY_NAME", "Ledgerbay"),
  "setBuildNumber": False,  # → version 1.13.19.0 for Store
  "languages": ["en-US"],
  "showNameOnTiles": True,
  "artifactName": "${productName}-${version}.appx",
}
# Do NOT add appx to default win.target — NSIS/portable stay for GitHub Releases;
# AppX is built only via dist:msix / BUILD_TARGETS=appx on windows-latest (or wine).
data.setdefault("scripts", {}).update({
  "start": "electron .",
  "dist:win": "electron-builder --win portable zip --x64",
  "dist:linux": "electron-builder --linux AppImage deb --x64",
  "dist:msix": "python3 scripts/make-ms-store-assets.py . && electron-builder --win appx --x64",
  "privacy-scan": "bash scripts/privacy-scan.sh .",
})
p.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print("package.json updated")
