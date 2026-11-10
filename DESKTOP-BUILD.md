# Desktop build notes

Repo: `github.com/skshahid1086/ledgerbay` (public). Layout:

```
app/                 ← clean store web (1.13.19), incl. server.mjs (LAN sync server)
desktop/             ← Electron wrapper
scripts/privacy-scan.sh
scripts/attach-apk.md
.github/workflows/release.yml   ← Windows + Linux only; APK attached offline
LICENSE              ← proprietary (viewing only)
README.md
RELEASE-NOTES.md     ← what changed per version
```

## One-command desktop package

```bash
cd desktop
./scripts/build-all.sh ../app 1.13.19 Ledgerbay in.ledgerbay.app
```

Outputs in `desktop/dist/`: `Ledgerbay-Setup-1.13.19.exe`, `Ledgerbay-Portable-1.13.19.exe`, `Ledgerbay-1.13.19-x86_64.AppImage`, `Ledgerbay-1.13.19-amd64.deb`. The packaged app runs the bundled `server.mjs` for LAN sync; it reads its version from `build-config.js` (1.13.19).

## Android APK on the same Release

CI does **not** build the APK. After the tag release publishes Win/Linux + `SHA256SUMS.txt`, attach `ledgerbay-v21/store/ledgerbay-*.apk` per `scripts/attach-apk.md` and refresh checksums.

## Demo seed

`LEDGERBAY_BUILD.VARIANT=store` in `build-config.js` (written by `build-all.sh`). Native `lbIsProd()` in v21 starts empty; legacy web is patched by `scripts/patch-legacy-seed.py`.

## Never copy into repo / CI

`ledgerbay-v21/personal/`, backups, secrets, `*.jks` / keystores, sync-data, `.env`, real LAN/Tailscale IPs, Playwright traces, old personal fixtures.

## Microsoft Store AppX

- Config: `desktop/package.json` `build.appx` (Partner Center values above).
- Assets: `desktop/build/appx/*.png` via `python3 scripts/make-ms-store-assets.py .`
- Build: `BUILD_TARGETS=appx bash scripts/build-all.sh …` on **Windows only** (electron-builder refuses AppX on Linux).
- CI: `.github/workflows/msix-store.yml` — `workflow_dispatch`, artifact `ledgerbay-msix-store`, never softprops release.
- Do not put the Android keystore or `personal/` in this repo.
- Store web under `app/` is the 1.13.19 release candidate; treat as not final until the owner signs off.
