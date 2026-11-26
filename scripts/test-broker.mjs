/**
 * A local MQTT broker over secure WebSockets, for testing the relay path (different networks)
 * without internet. Uses the demo server's self-signed certificate. Not for production.
 *
 *   node scripts/test-broker.mjs [port]     (wss://<host>:<port>/mqtt)
 */
import aedesModule from 'aedes';
import { WebSocketServer, createWebSocketStream } from 'ws';
import { createServer } from 'node:https';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const port = Number(process.argv[2] ?? 7448);
const certDir = join(homedir(), '.airborneo', 'certs');
const host = readdirSync(certDir).find((f) => f.endsWith('.crt') && !f.startsWith('127.'))?.replace(/\.crt$/, '');
const broker = typeof aedesModule.createBroker === 'function' ? await aedesModule.createBroker() : aedesModule();
const server = createServer({ key: readFileSync(join(certDir, `${host}.key`)), cert: readFileSync(join(certDir, `${host}.crt`)) });
const wss = new WebSocketServer({ server, path: '/mqtt' });
wss.on('connection', (ws) => broker.handle(createWebSocketStream(ws)));
let published = 0;
broker.on('publish', (packet, client) => {
  if (client) published++;
});
setInterval(() => process.stdout.write(`\r  messages relayed: ${published}   `), 2000).unref();
server.listen(port, '0.0.0.0', () => console.log(`test broker on wss://${host}:${port}/mqtt`));
