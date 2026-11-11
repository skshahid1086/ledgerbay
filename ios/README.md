# Ledgerbay for iPhone and iPad

Offline shell around the Ledgerbay web app (**1.13.22**, store variant, bundle id `in.ledgerbay.app`). It is an [xtool](https://github.com/xtool-org/xtool) Swift package: xtool builds, signs, and installs iOS apps from Linux, Windows (WSL), and macOS using Swift Package Manager. There is no App Store build in this repo.

The phone shows the same books app as the web build. First launch is empty (no sample shop). Books stay on the device.

## What the shell does

- Loads the bundled HTML/JS/CSS from a folder in Application Support. Nothing is fetched from a Ledgerbay server to start the app.
- Keeps `localStorage` and IndexedDB in the default WebKit data store, so books survive leaving the app and installing an update. Deleting the app deletes the books. Use **Settings → Backup** first.
- The copy lives at a stable path on purpose. iOS changes the app bundle path on update; a `file://` origin follows that path, and WebKit would treat the new path as a different site. Application Support does not move, so the saved books stay attached.
- **Backup**, sales CSV, GSTR files, and **Download PDF** open the iOS share sheet (Save to Files, Mail, AirDrop, and so on).
- **Share** (invoice PDF or a statement) opens the same share sheet.
- **Print** opens the iOS print dialog (AirPrint). That dialog can also save a PDF. The invoice PDF from Share/Download is drawn by the web app’s own PDF code.
- **Restore**, plus the logo and signature pickers, use the system file picker from the page’s file input.
- WhatsApp links leave the shell and open in Safari / WhatsApp. A sync server you type under Settings can be reached on the local network. Public `http://` servers are blocked; use `https://` for those.
- Safe areas: the page is edge to edge, and the shell sets `--safe-top` / `--safe-bottom` from the device insets (notch and home indicator). On a wide iPad the shell adds the same insets to the top bar and sidebar.
- Zoom: the iOS copy of the page starts at 1× and allows pinch zoom up to 3×. The shared `app/` page still disables zoom for Android and desktop. The iOS copy is made by `scripts/build-ios.sh` and is not committed.

iOS 16 or later. iPhone and iPad.

## What you can do with a free Apple ID

No Mac and no paid Apple Developer Program required:

| Step | Needs a paid account? | Needs a Mac? |
| --- | --- | --- |
| Build an **unsigned** `.ipa` | No | No, after you install the iOS SDK (see below) |
| Sign and install on **your own** iPhone | No | No |
| Use the app for 7 days, then install it again | No | No |
| Run it in the iOS Simulator | No | **Yes** (`xtool dev run --simulator` is Mac-only) |
| GitHub Actions unsigned `.ipa` artifact | No | The workflow uses GitHub’s Mac runner, which already has Xcode. You do not put an Apple ID in the workflow. |
| App Store listing | **Yes** | A separate packaging step. This repo does not upload to the App Store. |

Downloading **Xcode.xip** (Linux / WSL only) asks you to sign in at Apple’s download site and accept a license. A free Apple ID is enough. Do not commit the xip or any Apple password.

## The 7-day limit

A free Apple ID gets a development provisioning profile that **expires after 7 days**. When it expires, iOS will not open Ledgerbay until you install it again with the same Apple ID. The books are not wiped by that re-sign.

xtool also **prefixes the bundle id** when it signs, for example `XTL-A1B2.in.ledgerbay.app`. Free teams cannot register a bundle id that another team already has, so xtool adds a prefix. The same Apple ID keeps the same prefix, which keeps the same app container and the same books. A different Apple ID is a different app: export a backup before you switch. xtool does this prefix for paid accounts too; a paid membership does not turn this project into an App Store build.

Apple also limits how many apps and devices a free account can register. If signing fails with a registration error, remove an old app id from your Apple account or use another Apple ID (and restore from backup).

After the first install, on the iPhone open **Settings → General → VPN & Device Management** and trust the developer certificate.

## Build an unsigned IPA

From the repo root, with `xtool` on your `PATH`:

```bash
./scripts/build-ios.sh
```

That copies `app/` into the package, points the iOS page at a 1×–3× viewport, and runs:

```bash
xtool dev build --configuration release --ipa
```

Outputs:

- `dist/ios/Ledgerbay-1.13.22-unsigned.ipa`
- `ios/xtool/Ledgerbay.ipa` (same package; `ios/xtool/` is gitignored)

An unsigned IPA does not install on a phone until it is signed. Building it does **not** need `xtool auth`.

`XTOOL_SIGN=1 ./scripts/build-ios.sh` passes `--sign`. Run `xtool auth` first. The script never reads an Apple ID or password.

`XTOOL_CONFIGURATION=debug` builds the debug configuration. `IOS_REFRESH_ICON=1` rebuilds `ios/Resources/AppIcon.png` from `app/icons/icon-512-maskable.png`.

### Linux

Follow [xtool’s Linux install guide](https://github.com/xtool-org/xtool/blob/main/Documentation/xtool.docc/Installation-Linux.md) for the Swift version and the Xcode release it expects. In short:

1. Install Swift 6.2 or newer (the version that guide names).
2. Install the `xtool` AppImage and put it on your `PATH`.
3. Download `Xcode.xip` in a browser from [Apple Developer downloads](https://developer.apple.com/download/all/?q=Xcode). The file is large (on the order of 10 GB) and extracting it needs several times that much free disk. This login cannot be done by the build script.
4. Install the SDK: `xtool sdk install /path/to/Xcode.xip`
5. `./scripts/build-ios.sh`

`xtool setup` also asks for an Apple ID. You can skip that until you want to install on a phone. SDK install and `xtool dev build --ipa` are enough for the unsigned package.

### Windows

xtool’s release is a Linux AppImage and a Mac app, not a native Windows `.exe`. Use **WSL (Ubuntu)** and the Linux steps above. To install onto a phone plugged into Windows, attach the USB device to WSL (`usbipd`) and install `libimobiledevice-utils` and `usbmuxd` inside WSL.

### Mac

1. Install Xcode from the Mac App Store (free Apple ID) and open it once so the license and the iOS SDK are in place. You do not download `Xcode.xip`.
2. Install xtool: `brew install xtool-org/tap/xtool`, or download `xtool.app` from [xtool releases](https://github.com/xtool-org/xtool/releases) and symlink `Contents/Resources/bin/xtool` onto your `PATH`.
3. `./scripts/build-ios.sh`

## Install on a phone

1. Plug in the iPhone, unlock it, and tap Trust.
2. `xtool auth`. Choose password login for a free Apple ID. Apple shows a 2FA code; you type it. The password goes to Apple, not into this repo. Do not put it in a script or a GitHub secret for the workflow in this folder.
3. From `ios/`: `xtool dev` builds, signs, and installs. Or, after `XTOOL_SIGN=1 ./scripts/build-ios.sh`, run `xtool install dist/ios/Ledgerbay-1.13.22-devsigned.ipa`.
4. Trust the certificate on the phone (see above).
5. Within 7 days, run the install again with the **same** Apple ID.

On Ubuntu, `sudo apt install libimobiledevice-utils usbmuxd` is what xtool uses to see the phone. Check with `ideviceinfo`.

## GitHub Actions

[`.github/workflows/ios.yml`](../.github/workflows/ios.yml) is **workflow_dispatch only**. It does not run on tags and it does not change `release.yml`. On a Mac runner it builds the unsigned IPA and uploads it as the artifact `ledgerbay-ios-unsigned-ipa`. It does not sign, and it does not need an Apple ID. Installing that artifact on a phone is still the `xtool auth` step above.

## Where the books are

WebKit stores the site data for this `file://` folder inside the app container (Library). The shell does not copy that store into iCloud. Backup JSON from Settings is the way to move books to another phone or to the desktop app.

Barcode scanning asks for the camera. If iOS will not start the camera on a local page, type the code.

The Node sync server (`server.mjs`) is not part of the iOS bundle. The phone can still join a server you already run on your LAN.
