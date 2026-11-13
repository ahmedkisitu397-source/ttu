# TTu for Android (APK)

TTu is a PWA, so the Android app is a thin wrapper that opens the hosted site (e.g. `https://ttu.hadtah.com`).
No APK was built on the dev box: it has no Java/Android SDK. Two ways to build one later:

## Option A — Bubblewrap TWA (recommended: smallest, Play-Store friendly)
1. Install JDK 17 and Node, then `npm i -g @bubblewrap/cli`.
2. `bubblewrap init --manifest https://ttu.hadtah.com/manifest.webmanifest` (or edit `twa-manifest.example.json`; package id `com.hadtah.ttu`).
3. `bubblewrap build` → produces `app-release-signed.apk` (sideload / hadtah.com download) and `app-release-bundle.aab` (Play Store).
4. Run `bubblewrap fingerprint` / `keytool -list -v -keystore ttu-release.keystore` and put the SHA-256 fingerprint in
   `public/.well-known/assetlinks.json` on the live site so Android opens TTu full-screen (no browser bar):
   ```json
   [{"relation":["delegate_permission/common.handle_all_urls"],
     "target":{"namespace":"android_app","package_name":"com.hadtah.ttu",
               "sha256_cert_fingerprints":["AA:BB:...:ZZ"]}}]
   ```
   Keep the keystore and its passwords safe — you need the same key for every update.

## Option B — Capacitor
1. Install JDK 17 + Android Studio (SDK 34+). `cd android && npm install && npm run setup`.
2. Set `server.url` in `capacitor.config.json` to the live URL.
3. `npm run apk:debug` → `android/android/app/build/outputs/apk/debug/app-debug.apk`.
   For release: create a keystore, configure signing in Android Studio, `npm run aab:release`.

Either way the wrapper has no secrets in it; all keys stay on the server.
