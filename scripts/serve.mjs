/**
 * Offline demo server: serves the built game over HTTPS on your local network, with its own
 * PeerJS signalling server, so phones on the same Wi-Fi can pair without internet or Vercel.
 *
 *   npm run demo                      (builds, then runs this)
 *   node scripts/serve.mjs [distDir]  (serve an existing build)
 *
 * Also used by the Mac app in desktop/.
 */
import express from 'express';
import { ExpressPeerServer } from 'peer';
import selfsigned from 'selfsigned';
import { createServer } from 'node:https';
import { networkInterfaces, homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The Wi-Fi/Ethernet IPv4 address phones should use. */
export function lanAddress() {
  const candidates = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) candidates.push({ name, address: net.address });
    }
  }
  // Prefer the Mac's Wi-Fi (en0) / Ethernet over VPN or virtual adapters.
  candidates.sort((a, b) => Number(/^(en|eth|wl)/.test(b.name)) - Number(/^(en|eth|wl)/.test(a.name)));
  return candidates[0]?.address ?? '127.0.0.1';
}

/** A self-signed certificate for this machine's LAN address, cached per address. */
async function certificate(host, dir) {
  mkdirSync(dir, { recursive: true });
  const keyFile = join(dir, `${host}.key`);
  const certFile = join(dir, `${host}.crt`);
  if (existsSync(keyFile) && existsSync(certFile)) {
    return { key: readFileSync(keyFile), cert: readFileSync(certFile) };
  }
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'AirBorneo Connecting You' }], {
    days: 825,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: host },
        ],
      },
    ],
  });
  writeFileSync(keyFile, pems.private);
  writeFileSync(certFile, pems.cert);
  return { key: pems.private, cert: pems.cert };
}

export async function startServer({ distDir, port = Number(process.env.PORT) || 8443, certDir = join(homedir(), '.airborneo', 'certs') } = {}) {
  if (!existsSync(join(distDir, 'index.html'))) throw new Error(`No build found in ${distDir}. Run "npm run build:offline" first.`);
  const host = lanAddress();
  const app = express();
  const server = createServer(await certificate(host, certDir), app);

  // Always use the LAN address so the pairing QR code works from a phone.
  app.use((req, res, next) => {
    const h = (req.headers.host ?? '').split(':')[0];
    if (h === 'localhost' || h === '127.0.0.1') return res.redirect(302, `https://${host}:${port}${req.originalUrl}`);
    res.setHeader('Permissions-Policy', 'accelerometer=(self), gyroscope=(self), magnetometer=(self), screen-wake-lock=(self), fullscreen=(self)');
    next();
  });
  app.use('/peerjs', ExpressPeerServer(server, { path: '/', allow_discovery: false }));
  app.use(express.static(distDir));

  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '0.0.0.0', done);
  });
  const url = `https://${host}:${port}/`;
  return { url, host, port, close: () => server.close() };
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * Open the big screen. On a Mac with Google Chrome, use a dedicated demo profile that lets the
 * lounge music start without a click, trusts this machine's self-signed certificate and opens
 * fullscreen. Otherwise fall back to the default browser.
 */
function openBigScreen(url) {
  if (existsSync(CHROME)) {
    const profile = join(homedir(), '.airborneo', 'chrome');
    mkdirSync(profile, { recursive: true });
    spawn(
      CHROME,
      [
        `--user-data-dir=${profile}`,
        '--autoplay-policy=no-user-gesture-required',
        '--ignore-certificate-errors',
        '--test-type',
        '--no-first-run',
        '--no-default-browser-check',
        '--start-fullscreen',
        url,
      ],
      { stdio: 'ignore', detached: true },
    ).unref();
    console.log('  Opened the big screen in Google Chrome (sound on, fullscreen). Press ⌘⌃F to leave fullscreen.\n');
  } else {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    console.log('  Tip: install Google Chrome for automatic sound; otherwise press any key once for sound.\n');
  }
}

// Run directly: node scripts/serve.mjs [distDir]
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const distDir = resolve(process.argv[2] ?? 'dist-offline');
  try {
    const { url } = await startServer({ distDir });
    console.log('\n  AirBorneo · Connecting You is running offline.\n');
    console.log(`  Big screen:  ${url}`);
    console.log('  Phones:      scan the QR code on the big screen (same Wi-Fi)\n');
    console.log('  The certificate is self-signed: on each device choose Advanced → Proceed / Visit website.');
    console.log('  Press Ctrl+C to stop.\n');
    if (process.platform === 'darwin' && !process.env.NO_OPEN) openBigScreen(url);
  } catch (err) {
    console.error(`\n  ${err.message}\n`);
    process.exit(1);
  }
}
