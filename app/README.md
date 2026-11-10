# Ledgerbay

Offline GST billing for Indian shops (vanilla JS + Capacitor).

## Device Sync (v11)

Offline-first sync so phone and PC share the same books.

### Start the server (PC)

```bat
start-sync.bat
```

or:

```bash
PORT=3000 BILLSETU_SYNC_PASSCODE='your-pass' node server.mjs
```

First run without a passcode: CLI prompt, `BILLSETU_SYNC_PASSCODE` env, or open `http://127.0.0.1:PORT/setup` (localhost only). Passcode is stored hashed (scrypt + salt). Failed attempts: 5/min then 15 min lockout per IP. Server binds `0.0.0.0` and prints LAN URLs.

### On each device

**Settings → Device Sync**: server address (pre-filled with same origin on the PC web app), passcode, enable, auto-sync, Sync now / First join (Merge or Replace; JSON backup first).

### What syncs

See REPORT.md collection table. Per-company data stays separated. Stock is rebuilt from documents (never LWW’d as a raw number). Duplicate invoice/PO/DN/voucher numbers are renumbered on merge.

### Print

A4/A5 fill the printable area (`@page` margin 8mm). Amount in words uses Indian form: `Rupees One Lakh Twenty-Five Thousand Only`.
