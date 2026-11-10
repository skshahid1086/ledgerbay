# Ledgerbay Desktop — 1.13.19

The Electron wrapper that packages Ledgerbay for Windows (installer and portable exe) and Linux (AppImage and .deb). Offline GST billing; the same books as the Ledgerbay web/PWA and Android app.

See [../DESKTOP-BUILD.md](../DESKTOP-BUILD.md) for build instructions. Ready-made downloads are on the project's GitHub Releases page.

## What's new in 1.13.19

- **Review documents / older debit notes:** unstamped GST documents are classified under Books → GST, not guessed in the books.
- **Convert to GST Bill** is a primary action next to Print; proforma amounts received carry over.
- **Invoice branding:** "Made with Ledgerbay" is no longer shown on invoices, prints or PDFs.
- **Bank details on invoices:** bank name, IFSC and account number print after you add a bank with UPI; only one show-on-invoice account is kept after restart.
- **GSTIN checksum**, and the Furniture category / sofa demo are removed so the app stays general-purpose.
- **Credit-note tax:** re-saving a credit note against a CGST+SGST bill keeps that split.
- **Old invoices:** editing a bill saved when the business state was blank keeps its original tax split; changing the party or place of supply asks for confirmation before GST is recalculated.
- **Desktop:** the sync server shipped with the app is the 1.13.19 server and reports 1.13.19.

## Install

- **Windows:** `Ledgerbay-Setup-<version>.exe` is a per-user installer (no admin) into `%LOCALAPPDATA%\Programs\Ledgerbay`, with Desktop and Start menu shortcuts. The portable exe runs without installing. Builds are unsigned, so SmartScreen may say "Unknown publisher": choose **More info → Run anyway**.
- **Linux:** AppImage (make it executable and run) or the .deb package.

## First launch

1. Set an owner password (kept on this PC only).
2. Fill in **Set up your company**. The desktop build starts with empty books (no demo data).

## Where your data lives

- Windows: `%APPDATA%\ledgerbay`
- Linux: `~/.config/ledgerbay` (an older `~/.config/Ledgerbay` folder is moved here automatically on first start)

**Help → About Ledgerbay** shows the exact folder. Books are stored under the stable origin `ledgerbay://app`, so they survive restarts and upgrades. Take regular backups from **Settings → Backup** (a JSON file you choose where to save).

## Printing

- The in-app **Print A4** / **Print thermal** buttons, and **File → Print… (Ctrl+P)** while a bill preview is open, print just the bill through the system print dialog. Use "Microsoft Print to PDF" (or any PDF printer) for a PDF, or **Download PDF** in the preview.
- The UPI QR code is printed when a UPI ID is set in Settings.

## Sync (phone ↔ PC)

Desktop can host the LAN sync server:

1. **Sync → Start Sync Server (Host)**, or Settings → Device Sync → **Start Sync Server on this PC**.
2. First time: **Sync → Open Sync Setup in Browser** (`http://127.0.0.1:3000/setup`) and set a passcode.
3. Share the LAN URL shown (for example `http://192.168.x.x:3000`) and the passcode with the phone. Allow inbound TCP 3000 on private networks if the phone cannot connect.

Sync files live in the `sync-data` folder inside the data folder above.

## Desktop behaviour

- Only one copy runs at a time; opening it again brings the existing window to the front.
- Window size and position are remembered (and reset if that screen is gone).
- Web links (WhatsApp share, help pages) open in your normal browser.
- Works fully offline. Main-process errors are written to `logs/main.log` in the data folder.
