import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { makeCode, peerIdFor, type ControllerMsg, type ScreenMsg } from './protocol';
import { RelayControllerLink, RelayHostLink } from './relay';

export type LinkStatus = 'starting' | 'ready' | 'connected' | 'reconnecting' | 'no-screen' | 'offline';

/** What each end of the link can see, for the on-screen connection panel. */
export interface LinkDiagnostics {
  online: boolean;
  /** Pairing relays (or the local pairing server) currently reachable. */
  relays: number;
  relayTotal: number;
  /** The other device has shown up. */
  found: boolean;
  /** The direct link's state: 'none', 'new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'. */
  link: string;
  /** Message brokers (the relay path for different networks) currently reachable. */
  brokers: number;
  brokerTotal: number;
  /** How the devices are talking: a direct link, through the relay, or not yet. */
  path: 'direct' | 'relay' | 'none';
}

export interface ScreenLink {
  code: string;
  status: LinkStatus;
  readonly connected: boolean;
  start(code: string): void;
  send(msg: ScreenMsg): void;
  diagnostics(): LinkDiagnostics;
}

export interface PhoneLink {
  status: LinkStatus;
  readonly connected: boolean;
  connect(code: string): void;
  close(): void;
  send(msg: ControllerMsg): void;
  diagnostics(): LinkDiagnostics;
}

/** One line for the connection panel, naming the first thing that's wrong. */
export function describeLink(d: LinkDiagnostics, other: 'phone' | 'screen'): { text: string; bad: boolean } {
  const device = other === 'phone' ? 'This screen' : 'This phone';
  if (!d.online) return { text: `${device} is offline · check its Wi-Fi or mobile data`, bad: true };
  const parts: string[] = [];
  if (d.relayTotal === 1) parts.push(`Pairing server ${d.relays ? 'ok' : 'unreachable'}`);
  else if (d.relayTotal > 1) parts.push(`Relays ${d.relays}/${d.relayTotal}`);
  if (d.brokerTotal > 0) parts.push(`Brokers ${d.brokers}/${d.brokerTotal}`);
  const relays = parts.join(' · ');
  if (d.relays + d.brokers === 0) return { text: `${relays} · can't reach any, retrying (a firewall may block them)`, bad: true };
  if (d.path === 'relay') return { text: `Online · ${relays} · ${other} linked via relay`, bad: false };
  if (d.link === 'connected') return { text: `Online · ${relays} · ${other} linked${d.brokerTotal > 0 ? ' directly' : ''}`, bad: false };
  if (d.link === 'failed') return { text: `Online · ${relays} · found the ${other} but couldn't link, retrying`, bad: true };
  if (d.found || d.link === 'connecting' || d.link === 'new') return { text: `Online · ${relays} · linking to the ${other}…`, bad: false };
  return { text: `Online · ${relays} · waiting for the ${other}`, bad: false };
}

/**
 * The dev server and the offline demo run their own PeerJS signalling server, and a self-hosted
 * one can be set with VITE_PEER_HOST. Online (Vercel) builds pair through public Nostr relays.
 */
const localBroker = import.meta.env.DEV || import.meta.env.VITE_PEER_LOCAL === '1' || !!import.meta.env.VITE_PEER_HOST;

export function createScreenLink(onMessage: (msg: ControllerMsg) => void, onStatus: (status: LinkStatus, code: string) => void): ScreenLink {
  return localBroker ? new HostLink(onMessage, onStatus) : new RelayHostLink(onMessage, onStatus);
}

export function createPhoneLink(onMessage: (msg: ScreenMsg) => void, onStatus: (status: LinkStatus) => void): PhoneLink {
  return localBroker ? new ControllerLink(onMessage, onStatus) : new RelayControllerLink(onMessage, onStatus);
}

/**
 * Where the PeerJS signalling server lives. In dev, the Vite plugin in vite.config.ts serves one at
 * /peerjs on the same origin (as does the offline demo server); VITE_PEER_HOST points at a
 * self-hosted one.
 */
function peerOptions(): PeerOptions {
  const env = import.meta.env;
  if (env.VITE_PEER_HOST) {
    return {
      host: env.VITE_PEER_HOST,
      port: Number(env.VITE_PEER_PORT ?? 443),
      path: env.VITE_PEER_PATH ?? '/',
      secure: true,
      debug: 1,
    };
  }
  // Dev server and the offline demo build both run their own signalling server at /peerjs.
  return {
    host: location.hostname,
    port: Number(location.port || (location.protocol === 'https:' ? 443 : 80)),
    path: '/peerjs',
    secure: location.protocol === 'https:',
    debug: 1,
  };
}

/** The big screen over PeerJS: owns a short pairing code and accepts one phone at a time. */
class HostLink implements ScreenLink {
  code = '';
  status: LinkStatus = 'starting';
  private conn?: DataConnection;
  private retryTimer = 0;

  constructor(
    private readonly onMessage: (msg: ControllerMsg) => void,
    private readonly onStatus: (status: LinkStatus, code: string) => void,
  ) {}

  start(code = makeCode()): void {
    this.code = code;
    this.setStatus('starting');
    const peer = new Peer(peerIdFor(code), peerOptions());
    peer.on('open', () => this.setStatus(this.conn?.open ? 'connected' : 'ready'));
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      if (!peer.destroyed) window.setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        peer.destroy();
        this.start(makeCode());
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
        if (this.status !== 'connected') this.setStatus('offline');
        window.clearTimeout(this.retryTimer);
        this.retryTimer = window.setTimeout(() => {
          if (peer.destroyed) this.start(this.code);
          else if (peer.disconnected) peer.reconnect();
        }, 3000);
      } else {
        console.warn('[link] peer error', err.type, err.message);
      }
    });
  }

  private accept(conn: DataConnection): void {
    conn.on('open', () => {
      if (this.conn && this.conn !== conn) this.conn.close();
      this.conn = conn;
      this.setStatus('connected');
      this.send({ t: 'welcome', code: this.code });
    });
    conn.on('data', (data) => this.onMessage(data as ControllerMsg));
    conn.on('close', () => {
      if (this.conn === conn) {
        this.conn = undefined;
        this.setStatus('ready');
      }
    });
    conn.on('error', (err) => console.warn('[link] connection error', err));
  }

  get connected(): boolean {
    return !!this.conn?.open;
  }

  diagnostics(): LinkDiagnostics {
    return { online: navigator.onLine, relays: this.status === 'offline' || this.status === 'starting' ? 0 : 1, relayTotal: 1, brokers: 0, brokerTotal: 0, found: !!this.conn, link: this.conn?.open ? 'connected' : 'none', path: this.conn?.open ? 'direct' : 'none' };
  }

  send(msg: ScreenMsg): void {
    if (this.conn?.open) void this.conn.send(msg);
  }

  private setStatus(status: LinkStatus): void {
    this.status = status;
    this.onStatus(status, this.code);
  }
}

/** The phone over PeerJS: connects to the screen that shows the given code, and keeps reconnecting. */
class ControllerLink implements PhoneLink {
  status: LinkStatus = 'starting';
  private peer?: Peer;
  private conn?: DataConnection;
  private code = '';
  private retryTimer = 0;
  private attempts = 0;

  constructor(
    private readonly onMessage: (msg: ScreenMsg) => void,
    private readonly onStatus: (status: LinkStatus) => void,
  ) {}

  connect(code: string): void {
    this.code = code;
    this.attempts = 0;
    window.clearTimeout(this.retryTimer);
    if (this.peer && !this.peer.destroyed && this.peer.open) {
      this.dial();
      return;
    }
    this.peer?.destroy();
    this.setStatus('starting');
    const peer = new Peer(peerOptions());
    this.peer = peer;
    peer.on('open', () => this.dial());
    peer.on('disconnected', () => {
      if (!peer.destroyed) window.setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        this.setStatus('no-screen');
        this.scheduleRetry();
      } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
        this.setStatus('offline');
        this.scheduleRetry();
      } else {
        console.warn('[link] peer error', err.type, err.message);
      }
    });
  }

  private dial(): void {
    if (!this.peer || this.peer.destroyed) return this.connect(this.code);
    if (this.peer.disconnected) {
      this.peer.reconnect();
      this.scheduleRetry();
      return;
    }
    const conn = this.peer.connect(peerIdFor(this.code), { serialization: 'json', reliable: true });
    conn.on('open', () => {
      this.conn = conn;
      this.attempts = 0;
      this.setStatus('connected');
      this.send({ t: 'hello', v: 1, device: navigator.userAgent.slice(0, 80) });
    });
    conn.on('data', (data) => this.onMessage(data as ScreenMsg));
    conn.on('close', () => {
      if (this.conn === conn) {
        this.conn = undefined;
        this.setStatus('reconnecting');
        this.scheduleRetry();
      }
    });
    conn.on('error', () => this.scheduleRetry());
  }

  private scheduleRetry(): void {
    window.clearTimeout(this.retryTimer);
    const delay = Math.min(1000 * 2 ** this.attempts, 8000);
    this.attempts++;
    this.retryTimer = window.setTimeout(() => {
      if (!this.conn?.open) this.dial();
    }, delay);
  }

  get connected(): boolean {
    return !!this.conn?.open;
  }

  /** Close the data channel promptly so the screen pauses straight away. */
  close(): void {
    this.conn?.close();
    this.peer?.destroy();
  }

  diagnostics(): LinkDiagnostics {
    return { online: navigator.onLine, relays: this.peer?.open ? 1 : 0, relayTotal: 1, brokers: 0, brokerTotal: 0, found: !!this.conn, link: this.conn?.open ? 'connected' : 'none', path: this.conn?.open ? 'direct' : 'none' };
  }

  send(msg: ControllerMsg): void {
    if (this.conn?.open) void this.conn.send(msg);
  }

  private setStatus(status: LinkStatus): void {
    this.status = status;
    this.onStatus(status);
  }
}
