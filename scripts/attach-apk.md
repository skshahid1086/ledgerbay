# Attaching the Android APK to a GitHub Release

CI (`.github/workflows/release.yml`) builds **only Windows and Linux**. It must never see the Android keystore, `keystore.properties`, or signing passwords.

The release-signed APK is built elsewhere and lands at:

```text
ledgerbay-<version>.apk
```

(example: `ledgerbay-1.13.22.apk`). Only the `store/` folder is public-facing — never `personal/`.

## After a `v*` tag release is published

1. Confirm the Actions release has the Windows/Linux files and an initial `SHA256SUMS.txt`.
2. Copy the APK next to your other assets (do not commit it to git):

   ```bash
   APK=./ledgerbay-1.13.22.apk
   TAG=v1.13.22
   gh release upload "$TAG" "$APK" --clobber
   ```

3. Regenerate checksums for **all** release assets (desktop + APK) and replace `SHA256SUMS.txt` on the release:

   ```bash
   mkdir -p /tmp/lb-rel && cd /tmp/lb-rel
   gh release download "$TAG" -D .
   sha256sum Ledgerbay-* ledgerbay-*.apk *.exe *.deb *.AppImage 2>/dev/null | sort > SHA256SUMS.txt
   # or simply:
   sha256sum * > SHA256SUMS.txt
   gh release upload "$TAG" SHA256SUMS.txt --clobber
   ```

4. Double-check the release notes list Windows, Linux, and Android, and that no keystore/backup JSON was uploaded.

## Do not

- Put `*.jks` / `*.keystore` / `keystore.properties` in the repo or in Actions secrets for this workflow
- Upload anything from `ledgerbay-v21/personal/`
- Build the APK inside `release.yml`
