/**
 * Online pairing without a server of our own. The screen and the phone meet in a "room" named after
 * the pairing code, announced through several public Nostr relays at once (via Trystero), then talk
 * directly over a WebRTC data channel. Any one relay can be down or blocked and pairing still works.
 * TURN relays carry the data when the phone (say on 4G) can't reach the screen directly.
 */
import { joinRoom, getRelaySockets, type Room, type MessageAction, type JsonValue } from 'trystero/nostr';
import type { ControllerMsg, ScreenMsg } from './protocol';
import type { LinkStatus } from './link';

const APP_ID = 'airborneo-coming-home';

/** Relays to use: the build can pin a list (for tests); otherwise 10 of Trystero's defaults. */
function relayConfig(): { urls?: string[]; redundancy: number } {
  const pinned = import.meta.env.VITE_NOSTR_RELAYS;
  if (pinned) return { urls: pinned.split(',').map((u) => u.trim()).filter(Boolean), redundancy: 10 };
  return { redundancy: 10 };
}

const TURN = [
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

function openRoom(code: string): Room {
  return joinRoom({ appId: APP_ID, relayConfig: relayConfig(), turnConfig: TURN }, code.toLowerCase());
}

/** How many relay connections are open right now. */
function relaysOpen(): number {
  const sockets = Object.values(getRelaySockets() as Record<string, WebSocket>);
  return sockets.filter((s) => s.readyState === WebSocket.OPEN).length;
}

/** The big screen: owns the room for its pairing code and accepts one phone at a time. */
export class RelayHostLink {
  code = '';
  status: LinkStatus = 'starting';
  private room?: Room;
  private msg?: MessageAction<JsonValue>;
  private phone?: string;
  private watch = 0;

  constructor(
    private readonly onMessage: (msg: ControllerMsg) => void,
    private readonly onStatus: (status: LinkStatus, code: string) => void,
  ) {}

  start(code: string): void {
    this.code = code;
    void this.room?.leave();
    this.setStatus('starting');
    const room = openRoom(code);
    this.room = room;
    this.msg = room.makeAction<JsonValue>('m');
    // Tell every newcomer who we are; the phone answers with "hello".
    room.onPeerJoin = (peer) => void this.msg?.send({ t: 'welcome', code: this.code }, { target: peer });
    room.onPeerLeave = (peer) => {
      if (peer === this.phone) {
        this.phone = undefined;
        this.setStatus('ready');
      }
    };
    this.msg.onMessage = (data, { peerId }) => {
      const m = data as unknown as ControllerMsg;
      if (m.t === 'hello') {
        this.phone = peerId;
        this.setStatus('connected');
        void this.msg?.send({ t: 'welcome', code: this.code }, { target: peerId });
      }
      if (peerId === this.phone) this.onMessage(m);
    };
    // Report whether we can reach any relay at all.
    window.clearInterval(this.watch);
    const started = performance.now();
    this.watch = window.setInterval(() => {
      if (this.phone) return;
      const open = relaysOpen();
      if (open > 0 && this.status !== 'ready') this.setStatus('ready');
      else if (open === 0 && performance.now() - started > 8000 && this.status !== 'offline') this.setStatus('offline');
    }, 500);
  }

  get connected(): boolean {
    return !!this.phone;
  }

  send(msg: ScreenMsg): void {
    if (this.phone) void this.msg?.send(msg as unknown as JsonValue, { target: this.phone });
  }

  private setStatus(status: LinkStatus): void {
    this.status = status;
    this.onStatus(status, this.code);
  }
}

/** The phone: joins the room for the code and talks only to the screen that welcomes it. */
export class RelayControllerLink {
  status: LinkStatus = 'starting';
  private room?: Room;
  private msg?: MessageAction<JsonValue>;
  private code = '';
  private screen?: string;
  private waitTimer = 0;

  constructor(
    private readonly onMessage: (msg: ScreenMsg) => void,
    private readonly onStatus: (status: LinkStatus) => void,
  ) {}

  connect(code: string): void {
    if (this.room && code === this.code) return;
    void this.room?.leave();
    this.code = code;
    this.screen = undefined;
    this.setStatus('starting');
    const room = openRoom(code);
    this.room = room;
    this.msg = room.makeAction<JsonValue>('m');
    this.msg.onMessage = (data, { peerId }) => {
      const m = data as unknown as ScreenMsg;
      if (m.t === 'welcome') {
        if (this.screen !== peerId) {
          this.screen = peerId;
          window.clearTimeout(this.waitTimer);
          this.setStatus('connected');
          this.send({ t: 'hello', v: 1, device: navigator.userAgent.slice(0, 80) });
        }
        return;
      }
      if (peerId === this.screen) this.onMessage(m);
    };
    room.onPeerLeave = (peer) => {
      if (peer === this.screen) {
        this.screen = undefined;
        this.setStatus('reconnecting');
      }
    };
    // Still alone after a while: say so, but keep listening (the screen may still be starting).
    window.clearTimeout(this.waitTimer);
    this.waitTimer = window.setTimeout(() => {
      if (!this.screen) this.setStatus(relaysOpen() > 0 ? 'no-screen' : 'offline');
    }, 12000);
  }

  get connected(): boolean {
    return !!this.screen;
  }

  /** Leave promptly so the screen pauses straight away. */
  close(): void {
    void this.room?.leave();
    this.room = undefined;
    this.screen = undefined;
  }

  send(msg: ControllerMsg): void {
    if (this.screen) void this.msg?.send(msg as unknown as JsonValue, { target: this.screen });
  }

  private setStatus(status: LinkStatus): void {
    this.status = status;
    this.onStatus(status);
  }
}
