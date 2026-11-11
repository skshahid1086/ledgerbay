# Ledgerbay release notes

## 1.13.22

Desktop (Windows / Linux) `1.13.22`, Microsoft Store MSIX `1.13.22.0`, Android `1.13.22` (store versionCode 175).

Changes since 1.13.19 (the previous GitHub release):

- **Narrow screens and large zoom** — list tables (sales, purchases, debit notes, overdue follow-ups, books, reports, and the rest) stack into readable cards on small viewports and at 150% zoom. If a table still will not stack, it can scroll horizontally instead of being clipped.
- **Dashboard chips** — the transaction filter chips wrap instead of overflowing the screen.
- **Convert to GST Bill** — stays on the sticky action bar only, and is no longer duplicated in the More sheet.
- No billing, GST, convert-pricing, or books logic was changed in 1.13.22 itself; the work is CSS and layout. Everything from 1.13.19 is included (Review documents, proforma amounts carried over, no "Made with Ledgerbay" branding, bank details on invoices, GSTIN checksum, credit-note tax split, and old-invoice GST handling).
- **Desktop** — ships the 1.13.22 sync server (`app/server.mjs`, `/api/health` reports 1.13.22 / 175). Data folder `~/.config/ledgerbay` (with migration from `Ledgerbay`), backup/PDF save dialog starts in Downloads, and Ctrl+P prints the open bill with its UPI QR.

### Downloads

| File | Platform |
|------|----------|
| `Ledgerbay-Setup-1.13.22.exe` | Windows installer (per-user) |
| `Ledgerbay-Portable-1.13.22.exe` | Windows portable |
| `Ledgerbay-1.13.22-x86_64.AppImage` | Linux AppImage |
| `Ledgerbay-1.13.22-amd64.deb` | Debian / Ubuntu |
| `ledgerbay-1.13.22.apk` | Android (attached offline, see `scripts/attach-apk.md`) |
| `SHA256SUMS.txt` | Checksums of every file above |

An unsigned iOS `.ipa` can be built with the manual `iOS (xtool)` workflow; it is not attached to this GitHub Release.

Your books are kept on upgrade (Linux `~/.config/ledgerbay`, Windows `%APPDATA%\ledgerbay`). Take a backup from **Settings → Backup** before upgrading.

The source is licensed under the MIT License. Copyright (c) 2026 Sk Sahid.

## 1.13.19

Desktop (Windows / Linux) `1.13.19`, Microsoft Store MSIX `1.13.19.0`, Android `1.13.19` (store versionCode 169).

Changes since 1.13.18:

- **Older debit notes (BUG-9)** — an on-account debit note from an earlier version no longer changes tax type in the books when you open or edit it. Documents whose GST split was never stored appear under **Books → GST → Review documents**, where you can classify them as CGST+SGST or IGST (or keep the stored split). They stay on a holding ledger until then, so ITC is not guessed.
- **Convert to GST Bill** — on the desktop Sales list, Convert sits with Print as a primary action (not only in the ⋯ menu). Converting a quotation or proforma re-prices it with the current GST rules.
- **Proforma payments** — money already received on a proforma is carried over when you convert it to a GST bill.
- Everything from 1.13.18 is included: no "Made with Ledgerbay" branding on invoices, bank details and UPI on A4 invoices, GSTIN checksum, no Furniture/sofa category, credit notes keep their CGST+SGST split, and editing an old pre-state invoice keeps its original split unless you change the party or place of supply (you are asked to confirm first).
- **Desktop** — ships the 1.13.19 sync server (`app/server.mjs`, `/api/health` reports 1.13.19 / 169). Data folder `~/.config/ledgerbay` (with migration from `Ledgerbay`), backup/PDF save dialog starts in Downloads, and Ctrl+P prints the open bill with its UPI QR.

### Downloads

| File | Platform |
|------|----------|
| `Ledgerbay-Setup-1.13.19.exe` | Windows installer (per-user) |
| `Ledgerbay-Portable-1.13.19.exe` | Windows portable |
| `Ledgerbay-1.13.19-x86_64.AppImage` | Linux AppImage |
| `Ledgerbay-1.13.19-amd64.deb` | Debian / Ubuntu |
| `ledgerbay-1.13.19.apk` | Android (attached offline, see `scripts/attach-apk.md`) |
| `SHA256SUMS.txt` | Checksums of every file above |

Your books are kept on upgrade (Linux `~/.config/ledgerbay`, Windows `%APPDATA%\ledgerbay`). Take a backup from **Settings → Backup** before upgrading.

The source is now licensed under the MIT License. Copyright (c) 2026 Sk Sahid.

## 1.13.18

Desktop (Windows / Linux) `1.13.18`, Microsoft Store MSIX `1.13.18.0`, Android `1.13.18` (store versionCode 167).

Changes since 1.13.9:

- **Invoice branding** — "Made with Ledgerbay" is no longer shown on the invoice view, in print previews, or in PDFs.
- **Bank details on invoices** — after you add a bank account and turn on UPI, the bank name, IFSC and account number print on A4 invoices. Only one account is marked "show on invoice", and that choice is kept after a restart.
- **GSTIN checksum** — setup and party GSTIN checks use a valid checksum (the party-form placeholder is `22AAAAA0000A1ZC`).
- **Furniture category removed** — the item category list is general (no Furniture preset or sofa demo). Older books that already have a furniture category still display a clean label.
- **Credit-note tax** — a credit note taken from a CGST+SGST invoice keeps that split when you edit and save it unchanged, and the books stay under the right tax heads.
- **Old invoices and GST** — editing an invoice that was saved when the business state was blank keeps its original CGST+SGST (or IGST). If you change the party or place of supply, a notice explains that GST will be recalculated and asks you to confirm before saving. Cancel leaves the bill as it was.
- **Desktop** — ships the 1.13.18 sync server (`app/server.mjs`, `/api/health` reports 1.13.18). Existing 1.13.9 desktop fixes are unchanged: data folder `~/.config/ledgerbay` (with migration from `Ledgerbay`), backup/PDF save dialog starts in Downloads, and Ctrl+P prints the open bill with its UPI QR.

### Downloads

| File | Platform |
|------|----------|
| `Ledgerbay-Setup-1.13.18.exe` | Windows installer (per-user) |
| `Ledgerbay-Portable-1.13.18.exe` | Windows portable |
| `Ledgerbay-1.13.18-x86_64.AppImage` | Linux AppImage |
| `Ledgerbay-1.13.18-amd64.deb` | Debian / Ubuntu |
| `ledgerbay-1.13.18.apk` | Android (attached offline, see `scripts/attach-apk.md`) |
| `SHA256SUMS.txt` | Checksums of every file above |

Your books are kept on upgrade (Linux `~/.config/ledgerbay`, Windows `%APPDATA%\ledgerbay`). Take a backup from **Settings → Backup** before upgrading.

Copyright (c) 2026 Sk Sahid. Licensed under the MIT License.

## 1.13.9

Desktop (Windows / Linux) `1.13.9`, Microsoft Store MSIX `1.13.9.0`, Android `1.13.9`.

- **GST state list + auto-fill** — the setup wizard and party form list every state/UT by its GST code (01–38, incl. 22 Chhattisgarh); a valid GSTIN fills the state, and the bill uses CGST+SGST when business and party are in the same state, IGST otherwise.
- **Money in** — fixed recording of money received.
- **Party / supplier statements** — statement fix for customers and suppliers.
- **Paid bills** — paid bills can now be cancelled or deleted.
- **Stock sync** — stock stays the same on every device after sync, including offline purchases, sales and deletes.
- **Opening balances** — party openings get their ledgers and an Opening Balance Difference ledger, so the trial balance tallies.
- **Sync** — records created offline are no longer lost when devices sync (sequence-based sync cursor in `server.mjs` / `sync.js`).
- **Desktop** — ships the 1.13.9 sync server (`app/server.mjs`, reports version 1.13.9); backup/PDF save dialog starts in Downloads; build makes `icon.ico` from the PNG when the web build has none.

### Downloads

| File | Platform |
|------|----------|
| `Ledgerbay-Setup-1.13.9.exe` | Windows installer (per-user) |
| `Ledgerbay-Portable-1.13.9.exe` | Windows portable |
| `Ledgerbay-1.13.9-x86_64.AppImage` | Linux AppImage |
| `Ledgerbay-1.13.9-amd64.deb` | Debian / Ubuntu |
| `ledgerbay-1.13.9.apk` | Android (attached offline, see `scripts/attach-apk.md`) |
| `SHA256SUMS.txt` | Checksums of every file above |

Your books are kept on upgrade (Linux `~/.config/ledgerbay`, Windows `%APPDATA%\ledgerbay`). Take a backup from **Settings → Backup** before upgrading.

Copyright (c) 2026 Sk Sahid. Licensed under the MIT License.
