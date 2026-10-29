# AirBorneo · Fresh Cargo Run

A three.js flying game for AirBorneo. Fly an ATR 72-500 freighter carrying fresh Sarawak seafood and fruit from **Kuching (WBGG)** to **Singapore Changi (WSSS)**. Your phone is the control yoke and the game runs on a big screen (a laptop, TV or booth display).

- **Take-off, like a real crew:** set flaps 15, push the throttle to TO, then tilt back to rotate at Vr (110 kt). Rotate too hard and you strike the tail.
- **Fly the dotted line:** each marker scores by how close you pass: PERFECT, GOOD, OK or MISS. Staying tight builds a ×3 combo.
- **Weather that pushes you off the line:**
  - a gusty crosswind out of Kuching,
  - rainforest updrafts,
  - a cumulonimbus cell over the South China Sea (lightning, rain, heavy turbulence),
  - a Sumatra squall,
  - windshear on short final.
- **Land on Changi 20C:** set flaps 30, follow the 3° glide path (the PAPI lights work), flare gently and pull the throttle to idle. Your landing is graded by sink rate in feet per minute.
- **Results:** a score, a 1–5 star rating (Cadet → Borneo Ace), cargo freshness, and a personal best stored on the screen's browser.

About 60 seconds of steering, and about 1½ minutes from gate to gate.

## Play

1. Open the game on the big screen.
2. Scan the QR code with a phone, or open `/controller.html` and type the 5-letter code.
3. Tap **Connect**. iPhone asks for motion access; allow it.
4. Hold the phone in landscape like a yoke, screen towards you and tilted back a little. Tap **Calibrate** and the flight starts.

| Phone control | Does |
| --- | --- |
| Tilt left/right (steering wheel) | Bank, up to 35° |
| Tilt top edge towards / away from you | Nose up / down |
| Throttle lever (left thumb) | IDLE · CLB · TO detents |
| FLAPS (right thumb) | 0 → 15 → 30 |
| Action | Skip the intro / fly again |
| Re-centre | Re-calibrate the neutral pose |

**No phone?** Click "Fly with keyboard" or press **K** or **Space** on the title screen:

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

## Deploy (Vercel)

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
