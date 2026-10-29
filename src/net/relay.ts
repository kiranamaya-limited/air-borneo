/**
 * Online pairing without a server of our own. The screen and the phone meet in a "room" named after
 * the pairing code, announced through several public Nostr relays at once (via Trystero), then talk
 * directly over a WebRTC data channel. Any one relay can be down or blocked and pairing still works.
 * TURN relays carry the data when the phone (say on 4G) can't reach the screen directly.
 *
 * Both ends report what they can see (internet, relays reached, the other device, the link) and
 * re-join the room by themselves when the network comes back.
 */
import { joinRoom, getRelaySockets, type Room, type MessageAction, type JsonValue } from 'trystero/nostr';
import type { ControllerMsg, ScreenMsg } from './protocol';
import type { LinkDiagnostics, LinkStatus } from './link';

const APP_ID = 'airborneo-coming-home';

/** Large, long-running public relays that pass Trystero's ephemeral signalling events. */
const RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://offchain.pub',
  'wss://relay.nostr.band',
  'wss://nostr.oxtr.dev',
  'wss://relay.snort.social',
  'wss://nostr-pub.wellorder.net',
  'wss://relay.nostr.net',
];

function relayUrls(): string[] {
  const pinned = import.meta.env.VITE_NOSTR_RELAYS;
  return pinned ? pinned.split(',').map((u) => u.trim()).filter(Boolean) : RELAYS;
}

const TURN = [
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

function openRoom(code: string): Room {
  const urls = relayUrls();
  return joinRoom({ appId: APP_ID, relayConfig: { urls, redundancy: urls.length }, turnConfig: TURN }, code.toLowerCase());
}

/** How many relay connections are open right now. */
function relaysOpen(): number {
  const sockets = Object.values(getRelaySockets() as Record<string, WebSocket>);
  return sockets.filter((s) => s.readyState === WebSocket.OPEN).length;
}

/** Shared room handling for both ends: joining, re-joining when the network returns, diagnostics. */
abstract class RelayLink {
  status: LinkStatus = 'starting';
  protected room?: Room;
  protected msg?: MessageAction<JsonValue>;
  code = '';
  /** The other device, once it has introduced itself. */
  protected other?: string;
  protected seen = false;
  private noRelaysSince = 0;
  private watch = 0;

  constructor() {
    window.addEventListener('online', () => this.rejoin());
  }

  protected abstract onRoom(room: Room, msg: MessageAction<JsonValue>): void;
  protected abstract setStatus(status: LinkStatus): void;

  protected join(code: string): void {
    void this.room?.leave();
    this.code = code;
    this.other = undefined;
    this.seen = false;
    const room = openRoom(code);
    this.room = room;
    this.msg = room.makeAction<JsonValue>('m');
    room.onPeerJoin = () => (this.seen = true);
    this.onRoom(room, this.msg);
    window.clearInterval(this.watch);
    this.noRelaysSince = performance.now();
    this.watch = window.setInterval(() => this.tick(), 1000);
  }

  /** Leave and join the same room again: fresh relay subscriptions and announcements. */
  protected rejoin(): void {
    if (!this.code) return;
    const code = this.code;
    this.setStatus('reconnecting');
    this.join(code);
  }

  private tick(): void {
    const open = relaysOpen();
    if (open > 0 || !navigator.onLine) this.noRelaysSince = performance.now();
    else if (performance.now() - this.noRelaysSince > 15000) {
      // Online, yet no relay for a while: start over.
      this.noRelaysSince = performance.now();
      this.rejoin();
      return;
    }
    this.onTick(open);
  }

  protected onTick(_open: number): void {}

  diagnostics(): LinkDiagnostics {
    const pc = this.other ? this.room?.getPeers()[this.other] : undefined;
    return {
      online: navigator.onLine,
      relays: relaysOpen(),
      relayTotal: relayUrls().length,
      found: this.seen || !!this.other,
      link: pc ? pc.connectionState : this.other ? 'connected' : 'none',
    };
  }
}

/** The big screen: owns the room for its pairing code and accepts one phone at a time. */
export class RelayHostLink extends RelayLink {
  constructor(
    private readonly onMessage: (msg: ControllerMsg) => void,
    private readonly onStatusChange: (status: LinkStatus, code: string) => void,
  ) {
    super();
  }

  get connected(): boolean {
    return !!this.other;
  }

  start(code: string): void {
    this.setStatus('starting');
    this.join(code);
  }

  protected onRoom(room: Room, msg: MessageAction<JsonValue>): void {
    // Tell every newcomer who we are; the phone answers with "hello".
    room.onPeerJoin = (peer) => {
      this.seen = true;
      void msg.send({ t: 'welcome', code: this.code }, { target: peer });
    };
    room.onPeerLeave = (peer) => {
      if (peer === this.other) {
        this.other = undefined;
        this.setStatus('ready');
      }
    };
    msg.onMessage = (data, { peerId }) => {
      const m = data as unknown as ControllerMsg;
      if (m.t === 'hello') {
        this.other = peerId;
        this.setStatus('connected');
        void msg.send({ t: 'welcome', code: this.code }, { target: peerId });
      }
      if (peerId === this.other) this.onMessage(m);
    };
  }

  protected onTick(open: number): void {
    if (this.other) return;
    if (!navigator.onLine || open === 0) {
      if (this.status !== 'offline') this.setStatus('offline');
    } else if (this.status !== 'ready') this.setStatus('ready');
  }

  send(msg: ScreenMsg): void {
    if (this.other) void this.msg?.send(msg as unknown as JsonValue, { target: this.other });
  }

  protected setStatus(status: LinkStatus): void {
    this.status = status;
    this.onStatusChange(status, this.code);
  }
}

/** The phone: joins the room for the code and talks only to the screen that welcomes it. */
export class RelayControllerLink extends RelayLink {
  private waitTimer = 0;

  constructor(
    private readonly onMessage: (msg: ScreenMsg) => void,
    private readonly onStatusChange: (status: LinkStatus) => void,
  ) {
    super();
  }

  get connected(): boolean {
    return !!this.other;
  }

  connect(code: string): void {
    if (this.room && code === this.code) return;
    this.setStatus('starting');
    this.join(code);
  }

  protected onRoom(room: Room, msg: MessageAction<JsonValue>): void {
    msg.onMessage = (data, { peerId }) => {
      const m = data as unknown as ScreenMsg;
      if (m.t === 'welcome') {
        if (this.other !== peerId) {
          this.other = peerId;
          window.clearTimeout(this.waitTimer);
          this.setStatus('connected');
          this.send({ t: 'hello', v: 1, device: navigator.userAgent.slice(0, 80) });
        }
        return;
      }
      if (peerId === this.other) this.onMessage(m);
    };
    room.onPeerLeave = (peer) => {
      if (peer === this.other) {
        this.other = undefined;
        this.setStatus('reconnecting');
      }
    };
    // Still alone after a while: say so, but keep listening (the screen may still be starting).
    window.clearTimeout(this.waitTimer);
    this.waitTimer = window.setTimeout(() => {
      if (!this.other) this.setStatus(navigator.onLine && relaysOpen() > 0 ? 'no-screen' : 'offline');
    }, 12000);
  }

  /** Leave promptly so the screen pauses straight away. */
  close(): void {
    this.code = '';
    void this.room?.leave();
    this.room = undefined;
    this.other = undefined;
  }

  send(msg: ControllerMsg): void {
    if (this.other) void this.msg?.send(msg as unknown as JsonValue, { target: this.other });
  }

  protected setStatus(status: LinkStatus): void {
    this.status = status;
    this.onStatusChange(status);
  }
}
