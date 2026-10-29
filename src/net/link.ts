import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { makeCode, peerIdFor, type ControllerMsg, type ScreenMsg } from './protocol';

export type LinkStatus = 'starting' | 'ready' | 'connected' | 'reconnecting' | 'no-screen' | 'offline';

/**
 * Where the PeerJS signalling server lives. In dev, the Vite plugin in vite.config.ts serves one at
 * /peerjs on the same origin; set VITE_PEER_HOST to use a self-hosted server in production.
 * Otherwise the free PeerJS cloud broker (with its STUN/TURN defaults) is used.
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
  if (env.DEV) {
    return {
      host: location.hostname,
      port: Number(location.port || (location.protocol === 'https:' ? 443 : 80)),
      path: '/peerjs',
      secure: location.protocol === 'https:',
      debug: 1,
    };
  }
  return { debug: 1 };
}

/** The big screen: owns a short pairing code and accepts one phone at a time. */
export class HostLink {
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

  send(msg: ScreenMsg): void {
    if (this.conn?.open) void this.conn.send(msg);
  }

  private setStatus(status: LinkStatus): void {
    this.status = status;
    this.onStatus(status, this.code);
  }
}

/** The phone: connects to the screen that shows the given code, and keeps reconnecting. */
export class ControllerLink {
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

  send(msg: ControllerMsg): void {
    if (this.conn?.open) void this.conn.send(msg);
  }

  private setStatus(status: LinkStatus): void {
    this.status = status;
    this.onStatus(status);
  }
}
