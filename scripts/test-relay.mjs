/**
 * A tiny Nostr relay for testing online pairing offline: it forwards events to matching
 * subscriptions (kinds, #tags, since), which is all Trystero needs. Not for production.
 *
 *   node scripts/test-relay.mjs [port]     (wss on the demo server's self-signed certificate)
 */
import { WebSocketServer } from 'ws';
import { createServer } from 'node:https';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const port = Number(process.argv[2] ?? 7447);
const certDir = join(homedir(), '.airborneo', 'certs');
const host = readdirSync(certDir).find((f) => f.endsWith('.crt') && !f.startsWith('127.'))?.replace(/\.crt$/, '');
const server = createServer({ key: readFileSync(join(certDir, `${host}.key`)), cert: readFileSync(join(certDir, `${host}.crt`)) });
const wss = new WebSocketServer({ server });
const subs = new Map(); // socket -> Map(subId -> filters)

const matches = (ev, f) =>
  (!f.kinds || f.kinds.includes(ev.kind)) &&
  (!f.since || ev.created_at >= f.since - 5) &&
  Object.entries(f).every(([k, v]) => !k.startsWith('#') || ev.tags.some((t) => t[0] === k.slice(1) && v.includes(t[1])));

wss.on('connection', (ws) => {
  subs.set(ws, new Map());
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const [type, a, ...rest] = msg;
    if (type === 'REQ') {
      subs.get(ws).set(a, rest);
      ws.send(JSON.stringify(['EOSE', a]));
    } else if (type === 'CLOSE') subs.get(ws).delete(a);
    else if (type === 'EVENT') {
      ws.send(JSON.stringify(['OK', a.id, true, '']));
      for (const [client, s] of subs) {
        for (const [subId, filters] of s) if (filters.some((f) => matches(a, f))) client.send(JSON.stringify(['EVENT', subId, a]));
      }
    }
  });
  ws.on('close', () => subs.delete(ws));
});
server.listen(port, '0.0.0.0', () => console.log(`test relay on wss://${host}:${port}`));
