# AirBorneo · Connecting You

A three.js flying game for AirBorneo. **68 passengers** are flying home, to weddings, to meetings and on honeymoon. Fly AirBorneo flight 101, an ATR 72-500, from **Kuching (WBGG)** to **Singapore Changi (WSSS)**, and **keep them comfortable**. Your phone is the control yoke and the game runs on a big screen (a laptop, TV or booth display), with lounge music playing throughout.

- **It starts straight away**, lined up on runway 25. Push the throttle to TO (flaps 15 are set for you if you forget), then tilt back gently to rotate at 110 kt.
- **Passenger comfort is the score.** The cabin panel shows the passengers' faces and you hear them react:
  - steep banks over 25° and jerky steering make them gasp ("My coffee!");
  - sudden drops and lurches make them scream;
  - long stretches of rough flying make someone **vomit** (a sick bag counts against you);
  - wandering off the dotted line gets them nervous ("Is this the way to Singapore?");
  - smooth flying earns happy sighs, and a butter landing gets applause.
- **Controls are airliner-gentle:** roll is limited to about 12°/s and the phone input is smoothed. Small, steady tilts win.
- **About 2 minutes of flying**, roughly 3 minutes from line-up to the results screen:
  1. a right turn over Kuching city and the Sarawak River,
  2. Mount Santubong and sea-breeze gusts along the coast,
  3. island-hopping over the South China Sea,
  4. a thunderstorm the route skirts round (stray into its core and the cabin suffers),
  5. a Sumatra squall,
  6. windshear on short final.
- **Land on Changi 20C:** set flaps 30, follow the 3° glide path (the PAPI lights work), flare gently and pull the throttle to idle.
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

`npm run dist` builds `desktop/dist/AirBorneo Connecting You-<version>.dmg`. The app starts the same offline server inside itself and opens the game fullscreen. To try it without packaging, use `npm start` instead.

The app is unsigned, so the first time you open it:
1. Right-click the app → **Open** → **Open**.
2. Allow incoming connections when macOS asks.
3. Use the **Phone** menu to see the controller address.

## Deploy (Vercel, optional)

It is a static Vite site, and `vercel.json` sets the framework, the `dist` output and a `Permissions-Policy` header for the motion sensors.

1. Import the repo in Vercel. No environment variables are needed.
2. Pairing uses the free PeerJS cloud broker (`0.peerjs.com`) and its STUN/TURN servers. To run your own broker, set `VITE_PEER_HOST`, `VITE_PEER_PORT` and `VITE_PEER_PATH`, and deploy [peerjs-server](https://github.com/peers/peerjs-server).
3. Preview deployments may sit behind Vercel Deployment Protection, which phones would have to log in to. Use the production URL, or disable protection for previews.

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
- Kuching runway 07/25 is 3,780 × 46 m on 068°/248°. Take-off is on 25, which points at Singapore.
- Changi 02C/20C is 4,000 × 60 m.
- Runway markings follow ICAO, with PAPI and sequenced approach lights.
- The ATR 72-500 is built to its real dimensions (27.17 m long, 27.05 m span) and has six-blade props, black de-icing boots and a T-tail.
- The route is the 381 NM great-circle KCH–SIN, compressed for play. The instruments still read realistic knots, feet and flight levels.

## Brand assets

airborneo.com could not be reached when this was built, so the look comes from public descriptions of the AirBorneo identity:
- a white fuselage with the Sarawak flag's yellow, red and black,
- the "Wings of Unity" hornbill-feather logo,
- the tagline "Borneo For You".

To use the official artwork:
- **Colours and fonts:** `src/brand/tokens.ts` and `src/brand/brand.css`.
- **Logo:** put the files in `public/brand/` and replace the `.ab-mark` stripe square.
- **Aircraft livery:** `src/world/livery.ts`, which paints the fuselage and fin on canvases.
