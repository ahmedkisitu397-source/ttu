# TTu on Windows / Mac / Linux desktops

**Easiest (no installer needed):** open the live site in Chrome or Edge → click the *Install* icon in the address bar
(or menu → "Install TTu"). It gets its own window, Start-menu entry and the pigeon icon. This works today because TTu is a PWA.

**Downloadable `.exe` installer for hadtah.com:** this folder is an Electron shell.
On a Windows PC (or any machine with Node 20+): `cd desktop && npm install && npm run dist:win` → `dist/TTu Setup 0.1.0.exe`.
Set `TTU_URL` if the live address differs. Optional: sign the .exe with a code-signing certificate so Windows SmartScreen doesn't warn users.
