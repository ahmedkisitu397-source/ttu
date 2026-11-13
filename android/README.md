# TTu for Android

Capacitor wrapper that loads https://ttu.hadtah.workers.dev. The pigeon launcher icon is the teal brand mark.

```
npm install
npx cap sync android
# icons (optional, after changing resources/icon.png):
npx capacitor-assets generate --android --iconBackgroundColor '#14b8a6' --assetPath resources
cd android && ./gradlew assembleDebug
```

The debug APK is built on GitHub Actions and attached to the v1.0.0 pre-release as `TTu-1.0.0-debug.apk`.

External source links and “Watch on YouTube” open in the system browser. YouTube embeds play inside the app. PDFs are saved to the device Downloads folder.
