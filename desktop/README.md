# Ledgerbay (desktop)

**Offline GST billing for Indian MSMEs** — Windows and Linux desktop apps wrapping the Ledgerbay web app (Electron).

> Licensed under the [MIT License](./LICENSE). Copyright (c) 2026 Sk Sahid.

Public repo: [github.com/skshahid1086/ledgerbay](https://github.com/skshahid1086/ledgerbay)

## Download

Get the latest build from [Releases](https://github.com/skshahid1086/ledgerbay/releases). Each release includes a `SHA256SUMS.txt` of every asset.

| Platform | File | Notes |
|----------|------|--------|
| Windows | `Ledgerbay-Setup-*.exe` | Per-user installer (Desktop + Start menu). No admin required. |
| Windows | `Ledgerbay-Portable-*.exe` | Portable single file |
| Linux | `Ledgerbay-*-x64.AppImage` | Run after `chmod +x` |
| Linux | `Ledgerbay-*.deb` | Debian/Ubuntu: `sudo dpkg -i …` |
| Android | `ledgerbay-*.apk` | Sideload. On the phone: open the APK → allow **Install unknown apps** for your browser/file manager if prompted. |

Verify downloads:

```bash
sha256sum -c SHA256SUMS.txt
```

### Windows SmartScreen

Builds are **unsigned**. Windows may show **“Windows protected your PC” / Unknown publisher**. Click **More info → Run anyway**. That is expected until a code-signing certificate is added. Desktop CI does **not** use the Android signing keystore (and must never receive it).

### Linux AppImage

```bash
chmod +x Ledgerbay-*-x64.AppImage
./Ledgerbay-*-x64.AppImage
```

### Android APK (maintainers)

The release-signed APK is produced **outside** GitHub Actions (signing key stays offline). After CI publishes the Windows/Linux assets, attach the APK to the same release — see [`scripts/attach-apk.md`](./scripts/attach-apk.md).

## What it is

Ledgerbay (formerly BillSetu) is an offline-first GST invoicing and books app: parties, stock, invoices, purchases, reports, A4 / thermal print, and optional LAN sync between phone and PC.

Desktop extras:

- Stable local origin so books survive restarts and updates
- System print dialog + print-to-PDF
- Optional in-app sync **host** (bundled sync server)
- Camera barcode / Capacitor share / Android back are not available (browser fallbacks only)

## Data folder

Electron stores books under the app **package name** (slug of the product name):

| OS | Typical path |
|----|----------------|
| Windows | `%APPDATA%\ledgerbay` |
| Linux | `~/.config/ledgerbay` |

If you rebuild with a different `<productName>` / slug, the data folder name changes — books will not auto-migrate. Back up from **Settings → Backup** before renaming.

## Demo data / clean store builds

Packaged **store** builds set `window.LEDGERBAY_BUILD.VARIANT = "store"`. The web app’s `lbIsProd()` then starts with **empty** books (no sample demo data). First launch may show the company setup wizard.

| Control | Effect |
|---------|--------|
| `web/build-config.js` → `LEDGERBAY_BUILD.VARIANT` | `"store"` / `"personal"` → empty seed; `"dev"` → demo seed |
| `lbIsProd()` in `app.js` | `VARIANT === "store" \|\| "personal"` |
| Desktop preload `billsetuDesktop.noDemoSeed` | Always `true` in this wrapper; mirrors store intent |

**Personal** builds (private, never published) may load `personal-seed.json` — that path must never enter this repo or GitHub Releases.

## Build from source

Requirements: Node 20+, Linux host recommended (cross-builds Windows + Linux). Windows NSIS uses system `makensis` (wine32 not required for our custom installer).

```bash
./scripts/build-all.sh ../app 1.13.22 Ledgerbay in.ledgerbay.app

```

Artifacts land in `dist/`: Setup exe, Portable exe, AppImage, `.deb`.

Privacy gate (also runs in CI):

```bash
./scripts/privacy-scan.sh .
```

## GitHub Releases

Push a tag `v*` (e.g. `v1.13.22`). The workflow `.github/workflows/release.yml` builds Windows and Linux packages on `windows-latest` and `ubuntu-latest`, and an unsigned Microsoft Store MSIX/AppX on `windows-latest`, then attaches all of them to the GitHub Release. It uses only the built-in `GITHUB_TOKEN` (no extra repo secrets). It never packages `personal/`, keystores, or backup JSON.


## Support

Privacy policy: [skshahid1086.github.io/ledgerbay/privacy.html](https://skshahid1086.github.io/ledgerbay/privacy.html)

For support and privacy questions, email [work.sahid@icloud.com](mailto:work.sahid@icloud.com). You can also open an issue on the [GitHub Issues page](https://github.com/skshahid1086/ledgerbay/issues).

## License

Ledgerbay is open source under the [MIT License](./LICENSE). Copyright (c) 2026 Sk Sahid.
