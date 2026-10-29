import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { PeerServer } from 'peer';
import { networkInterfaces } from 'node:os';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

/** First non-internal IPv4 address, so the pairing QR code works from a phone on the same Wi-Fi. */
function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const DEV_PEER_PORT = 9137;

/**
 * Runs a PeerJS signalling server next to the Vite dev server and proxies it at /peerjs, so phone
 * pairing works locally (and offline) over the same HTTPS origin. Production uses the PeerJS cloud.
 * (Configuring a proxy also makes Vite serve HTTPS over HTTP/1.1, which WebSocket upgrades need.)
 */
function devPeerServer(): Plugin {
  return {
    name: 'airborneo-dev-peer-server',
    apply: 'serve',
    config: () => ({
      server: {
        proxy: {
          '/peerjs': {
            target: `http://127.0.0.1:${DEV_PEER_PORT}`,
            ws: true,
            rewrite: (path: string) => path.replace(/^\/peerjs/, ''),
          },
        },
      },
    }),
    async configureServer() {
      const g = globalThis as { __abPeerServer?: boolean };
      if (g.__abPeerServer) return;
      g.__abPeerServer = true;
      // If another dev server already runs the signalling server on this port, share it.
      const free = await new Promise<boolean>((done) => {
        const probe = createServer()
          .once('error', () => done(false))
          .once('listening', () => probe.close(() => done(true)))
          .listen(DEV_PEER_PORT, '127.0.0.1');
      });
      if (free) PeerServer({ port: DEV_PEER_PORT, host: '127.0.0.1', path: '/', allow_discovery: false });
    },
  };
}

export default defineConfig({
  plugins: [basicSsl(), devPeerServer()],
  define: {
    __DEV_LAN_HOST__: JSON.stringify(lanAddress()),
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        controller: resolve(root, 'controller.html'),
      },
    },
  },
});
