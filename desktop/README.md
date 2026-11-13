# TTu for Windows

Electron shell around the hosted app at https://ttu.hadtah.workers.dev.

```
npm install
npm start                          # dev
npm run dist:win                   # NSIS installer → dist/TTu-Setup-1.0.0.exe
```

Source links and “Watch on YouTube” open in the system browser. YouTube embeds play in the window. PDF downloads use the normal Save dialog. The installer is built unsigned on GitHub Actions (Windows SmartScreen will warn).
