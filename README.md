# AirBorneo · Coming Home

A three.js flying game for AirBorneo. **68 Sarawakians are flying home** from Kuala Lumpur: students back for the holidays, families going home for Gawai, a grandmother who has waited all year. Fly AirBorneo flight 101, an ATR 72-500, from **Kuala Lumpur International (WMKK)** home to **Kuching (WBGG)**, and **keep them comfortable**. Your phone is the control yoke and the game runs on a big screen (a laptop, TV or booth display), with lounge music playing throughout.

- **It starts straight away**, lined up on KLIA's runway 32R. Push the throttle to TO (flaps 15 are set for you if you forget), then tilt back gently to rotate at 110 kt.
- **Passenger comfort is the score.** The cabin panel shows the passengers' faces and you hear them react:
  - steep banks over 25° and jerky steering make them gasp ("My coffee!");
  - sudden, sustained drops and lurches make them scream;
  - long stretches of rough flying make someone **vomit** (a sick bag counts against you);
  - wandering off the dotted line gets them nervous ("Is this the way to Kuching?");
  - smooth flying earns happy sighs, and a butter landing gets applause.
- **Responsive controls:** the plane answers the phone straight away; it's up to you to fly smoothly.
- **About 2¼ minutes of flying**, roughly 3 minutes from line-up to the results screen:
  1. a right turn out of KLIA past the Kuala Lumpur skyline (the Petronas Twin Towers and KL Tower), with a gusty crosswind,
  2. updrafts over the Titiwangsa hills,
  3. sea-breeze gusts off the east coast, then Pulau Tioman and the South China Sea,
  4. a thunderstorm the route skirts round (stray into its core and the cabin suffers),
  5. a squall line off Borneo,
  6. home: the Sarawak coast past Mount Santubong, up the Sarawak River over Kuching and the golden-roofed State Assembly,
  7. windshear on short final.
- **Land on Kuching runway 25:** set flaps 30, follow the 3° glide path (the PAPI and approach lights work), flare gently and pull the throttle to idle.
- **Results:** stars from passenger comfort and the landing, ranked Trainee → First Officer → Captain → Senior Captain → **Smooth Operator**. They also show how many passengers had a lovely flight, how many needed sick bags, and the biggest complaint.

**Sound:** a synthesised bossa-nova lounge loop, wind gusts, rain, thunder, cabin chimes, the captain's PA, and passenger voices made with formant synthesis. No audio files.

## Play

1. Open the game on the big screen.
2. Scan the QR code with a phone, or open `/controller.html` and type the 5-letter code.
3. Tap **Connect**. iPhone asks for motion access; allow it.
4. Hold the phone in landscape like a yoke, screen towards you and tilted back a little. Tap **Calibrate** and the flight starts.

| Phone control | Does |
| --- | --- |
| Tilt left/right (steering wheel) | Bank, up to 35°. Keep it under 25° for the passengers |
| Tilt top edge towards / away from you | Nose up / down |
| Throttle lever (left thumb) | IDLE · CLB · TO detents |
| FLAPS (right thumb) | 0 → 15 → 30 |
| Action | Start / fly again |
| Re-centre | Re-calibrate the neutral pose |

**No phone?** Press any key on the title screen, or click "Fly with keyboard":

| Key | Does |
| --- | --- |
| ← / → or A / D | Roll |
| ↓ / ↑ | Nose up / nose down (like a yoke) |
| W / S, or 1 / 2 / 3 | Throttle; the numbers jump to IDLE / CLB / TO |
| F | Flaps |
| Space | Action |
| M | Mute |

## Run locally

```bash
npm install
npm run dev
```

`npm run dev` serves over HTTPS on your network, because phones only expose motion sensors to secure pages.

1. Open the printed `https://<your-LAN-IP>:5173` on the laptop.
2. Scan the QR code with a phone on the same Wi-Fi. The QR code already points at your LAN address.
3. The certificate is self-signed, so accept the warning once on each device.

Pairing in dev uses a local PeerJS signalling server (port 9137), proxied at `/peerjs`, so it works without internet access.

Other scripts:

```bash
npm test            # unit tests: tilt maths, flight model, route, scoring, full autopilot mission
npm run build       # type-check + production build into dist/
npm run e2e         # headless big-screen + phone test over real WebRTC (first: npx playwright install chromium)
```

Debug URL parameters for the big screen:
- `?seed=123`: repeatable weather
- `?code=ABCDE`: a fixed pairing code, handy for a booth
- `?quality=low`: lower resolution, no shadows
- `?autopilot`: demo mode

## Offline demo on your Mac (no internet, no Vercel)

```bash
npm install
npm run demo
```

`npm run demo` builds the game and serves it over HTTPS on your Wi-Fi with its own pairing server, then opens the big screen.
- If Google Chrome is installed, the big screen opens in its own Chrome demo profile: fullscreen, music on with no click, no certificate warning. Press ⌘⌃F to leave fullscreen.
- Without Chrome, the default browser opens instead. Press any key once for sound.
- Phones on the same Wi-Fi scan the QR code. The certificate is self-signed, so tap **Advanced → Proceed** once on each phone.
- If macOS asks whether to accept incoming network connections, choose **Allow**.

To change the port, set `PORT=9443 npm run demo`. The default is 8443.

### As a Mac app (`.app` / `.dmg`)

```bash
cd desktop
npm install
npm run dist
```

`npm run dist` builds `desktop/dist/AirBorneo Coming Home-<version>.dmg`. The app starts the same offline server inside itself and opens the game fullscreen. To try it without packaging, use `npm start` instead.

The app is unsigned, so the first time you open it:
1. Right-click the app → **Open** → **Open**.
2. Allow incoming connections when macOS asks.
3. Use the **Phone** menu to see the controller address.

## Play online (Vercel)

It is a static Vite site, and `vercel.json` sets the framework, the `dist` output and a `Permissions-Policy` header for the motion sensors. No environment variables are needed.

Deploy from your computer with the Vercel CLI. It uploads this folder directly, so it works on a free Hobby account even though the repository belongs to a GitHub organisation:

```bash
npx vercel login
npx vercel deploy --prod
```

The first time, it asks a few questions: set up and deploy (yes), your personal scope, no existing project, a project name such as `airborneo-coming-home`, and keep the detected settings. It prints the live address, `https://<project>.vercel.app`. Run `npx vercel deploy --prod` again to publish later changes.

Open that production address on the big screen. Other deployment URLs sit behind Vercel's login protection, which phones can't pass.

Online details:
- **Pairing** goes through public Nostr relays (via [Trystero](https://github.com/dmotz/trystero)): the screen and the phone meet in a room named after the pairing code on 10 relays at once, so one being down or blocked doesn't matter, then talk directly over WebRTC. TURN relays carry the data when the phone (say on 4G) can't reach the screen directly. The offline demo keeps its own local PeerJS server. To test the online path without internet, `node scripts/test-relay.mjs` runs a local relay; build with `VITE_NOSTR_RELAYS=wss://<host>:7447`.
- **Sound:** browsers hold back sound on an ordinary web page until its first click or key press, and a small "Sound off" hint shows until then. For sound from the first second, install the game: in Chrome, **⋮ → Cast, save and share → Install page as app** (or the install icon in the address bar). The installed app opens fullscreen with the lounge music on.

## How it's built

```
index.html / controller.html    big screen / phone pages
src/net/                        PeerJS link + message protocol
src/controller/                 phone: tilt maths (tilt.ts), UI, 30 Hz input stream
src/game/                       renderer-independent: route, flight model, weather, scoring, mission state machine
src/world/                      three.js: procedural ATR 72, airports, terrain, ocean, sky, clouds, rain, markers, camera
src/ui/  src/audio/             HUD, screens, synthesised engine/weather sound + spoken callouts
src/brand/                      design tokens (colours, fonts): the one place to change the look
```

**Real-world grounding:**
- KLIA runway 14L/32R is about 4,000 × 60 m. Take-off is on 32R.
- Kuching runway 07/25 is 3,780 × 46 m on 068°/248°. Landing is on 25.
- Runway markings follow ICAO, with PAPI and sequenced approach lights.
- The ATR 72-500 is built to its real dimensions (27.17 m long, 27.05 m span) and has six-blade props, black de-icing boots and a T-tail.
- The route is the 523 NM great-circle KUL–KCH, compressed for play. The instruments still read realistic knots, feet and flight levels.

## Brand assets

airborneo.com could not be reached when this was built, so the look comes from public descriptions of the AirBorneo identity:
- a white fuselage with the Sarawak flag's yellow, red and black,
- the "Wings of Unity" hornbill-feather logo,
- the tagline "Borneo For You".

To use the official artwork:
- **Colours and fonts:** `src/brand/tokens.ts` and `src/brand/brand.css`.
- **Logo:** put the files in `public/brand/` and replace the `.ab-mark` stripe square.
- **Aircraft livery:** `src/world/livery.ts`, which paints the fuselage and fin on canvases.
