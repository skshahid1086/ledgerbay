# Ledgerbay (desktop)

**Offline GST billing for Indian MSMEs** — Windows and Linux desktop apps wrapping the Ledgerbay web app (Electron).

> Licensed under the [MIT License](./LICENSE). Copyright (c) 2026 Sk Sahid.

Public repo: [github.com/skshahid1086/ledgerbay](https://github.com/skshahid1086/ledgerbay)

**Current packaged version: `1.13.19`** (`in.ledgerbay.app`) — store VARIANT, empty first-run, generic invoice templates.

## What's new in 1.13.19

- **Older debit notes / Review documents** — GST documents with no stored split no longer get a guessed tax type. Classify them under Books → GST → Review documents.
- **Convert to GST Bill** — sits next to Print on the desktop Sales list (not only in the ⋯ menu). Money already received on a proforma is carried over when you convert it.
- **Invoice branding** — "Made with Ledgerbay" is no longer shown on invoices, prints or PDFs.
- **Bank details on invoices** — bank name, IFSC and account number print after you add a bank with UPI; only one show-on-invoice account is kept after restart.
- **GSTIN checksum**, and the Furniture category / sofa demo are removed so the app stays general-purpose.
- **Credit-note tax** — re-saving a credit note against a CGST+SGST bill keeps that split.
- **Old invoices** — editing a bill saved when the business state was blank keeps its original tax split; changing the party or place of supply asks for confirmation before GST is recalculated.
- **Desktop** — ships the 1.13.19 sync server (`app/server.mjs`, `/api/health` reports 1.13.19 / 169).

Full notes: [RELEASE-NOTES.md](./RELEASE-NOTES.md).

## Download

Get the latest build from [Releases](https://github.com/skshahid1086/ledgerbay/releases). Each release includes a `SHA256SUMS.txt` of every asset.

| Platform | File | Notes |
|----------|------|--------|
| Windows | `Ledgerbay-Setup-*.exe` | Per-user installer (Desktop + Start menu). No admin required. |
| Windows | `Ledgerbay-Portable-*.exe` | Portable single file |
| Linux | `Ledgerbay-*-x86_64.AppImage` | Run after `chmod +x` |
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

## Microsoft Store (MSIX)

The publisher has a Partner Center **Individual** account. Store package identity (public, committed in `desktop/package.json` → `build.appx`):

| Field | Value |
|-------|--------|
| identityName | `SkSahid.Ledgerbay` |
| publisher | `CN=799D416F-D7A9-40FB-8174-601BA874AB3C` |
| publisherDisplayName | Sk Sahid |
| displayName | Ledgerbay |
| Package Family Name | `SkSahid.Ledgerbay_k3en84vjpw33r` |
| Store ID | `9P2S6F5QWN88` |
| Version | `1.13.19.0` (revision segment must be `0`) |

Build the **unsigned** `.appx` with the manual workflow [`.github/workflows/msix-store.yml`](./.github/workflows/msix-store.yml) (`workflow_dispatch` on `windows-latest`). It uploads a **workflow artifact** only — **not** a GitHub Release asset. Partner Center re-signs the package. Optional env overrides: `MS_STORE_IDENTITY_NAME`, `MS_STORE_PUBLISHER`, `MS_STORE_PUBLISHER_DISPLAY_NAME`, `MS_STORE_DISPLAY_NAME`, `MS_STORE_APPLICATION_ID`.

Tile/logo PNGs are generated into `desktop/build/appx/` by `scripts/make-ms-store-assets.py` from the app icon.


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
./scripts/build-all.sh ./app 1.13.19 Ledgerbay in.ledgerbay.app
```

Artifacts land in `dist/`: Setup exe, Portable exe, AppImage, `.deb`.

Privacy gate (also runs in CI):

```bash
./scripts/privacy-scan.sh .
```

## GitHub Releases

Push a tag `v*` (e.g. `v1.13.19`). The workflow `.github/workflows/release.yml` builds Windows and Linux packages on `windows-latest` and `ubuntu-latest`, and an unsigned Microsoft Store MSIX/AppX on `windows-latest`, then attaches all of them to the GitHub Release. It uses only the built-in `GITHUB_TOKEN` (no extra repo secrets). It never packages `personal/`, keystores, or backup JSON.

## License

Ledgerbay is open source under the [MIT License](./LICENSE). Copyright (c) 2026 Sk Sahid.
