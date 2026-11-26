/**
 * Online pairing without a server of our own, and without needing the same Wi-Fi.
 *
 * Two paths run side by side, named after the pairing code:
 *  - direct: a WebRTC data channel, found through public Nostr relays (Trystero). Lowest latency;
 *    works on the same network and across most others.
 *  - relay: public MQTT brokers over secure WebSockets (mqtt.ts). Works on any network that can
 *    reach the internet, e.g. the phone on 4G and the laptop on venue Wi-Fi.
 * Every message is sent on the direct path when it is up and on the relay path otherwise (control
 * messages go on both); the receiver drops duplicates. Both ends report what they can see and
 * recover by themselves when the network comes back.
 */
import { joinRoom, getRelaySockets, type Room, type MessageAction, type JsonValue } from 'trystero/nostr';
import type { ControllerMsg, ScreenMsg } from './protocol';
import type { LinkDiagnostics, LinkStatus } from './link';
import { BrokerLink, Dedupe, isEnvelope, topics, type Envelope } from './mqtt';

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

/** Test switches: force one path. */
const RELAY_ONLY = import.meta.env.VITE_RELAY_ONLY === '1';
const DIRECT_ONLY = import.meta.env.VITE_DIRECT_ONLY === '1';

/** Silence after which the other device counts as gone (the phone sends input at 30 Hz, the screen state every 0.5 s). */
const GONE_MS = 4000;

function relaysOpen(): number {
  if (RELAY_ONLY) return 0;
  const sockets = Object.values(getRelaySockets() as Record<string, WebSocket>);
  return sockets.filter((s) => s.readyState === WebSocket.OPEN).length;
}

type Out = ControllerMsg | ScreenMsg;

/** Shared by both ends: the two paths, message envelopes, liveness and diagnostics. */
abstract class DualLink<In extends Out, Mine extends Out> {
  status: LinkStatus = 'starting';
  code = '';
  /** The other device's id, once it has introduced itself. */
  protected other?: string;
  protected seen = false;
  private readonly id = Math.random().toString(36).slice(2, 10);
  private seq = 0;
  private dedupe = new Dedupe();
  private room?: Room;
  private direct?: MessageAction<JsonValue>;
  /** Trystero peer id of the other device on the direct path. */
  private directPeer?: string;
  private broker?: BrokerLink;
  private lastHeard = 0;
  private noRelaysSince = 0;
  private watch = 0;

  constructor(private readonly side: 'screen' | 'phone') {
    window.addEventListener('online', () => this.rejoin());
  }

  protected abstract onArrive(m: In, from: string): void;
  protected abstract onGone(): void;
  protected abstract onTick(): void;
  protected abstract setStatus(status: LinkStatus): void;

  protected join(code: string): void {
    this.leave();
    this.code = code;
    this.other = undefined;
    this.directPeer = undefined;
    this.seen = false;
    this.dedupe = new Dedupe();
    if (!RELAY_ONLY) {
      const urls = relayUrls();
      const room = joinRoom({ appId: APP_ID, relayConfig: { urls, redundancy: urls.length }, turnConfig: TURN }, code.toLowerCase());
      this.room = room;
      this.direct = room.makeAction<JsonValue>('m');
      this.direct.onMessage = (data, { peerId }) => {
        if (isEnvelope(data)) this.receive(data as Envelope<In>, peerId);
      };
      room.onPeerJoin = (peer) => {
        this.seen = true;
        this.onDirectPeer(peer);
      };
      room.onPeerLeave = (peer) => {
        if (peer === this.directPeer) this.directPeer = undefined;
      };
    }
    if (!DIRECT_ONLY) {
      const t = topics(code);
      const [listen, speak] = this.side === 'screen' ? [t.toScreen, t.toPhone] : [t.toPhone, t.toScreen];
      this.broker = new BrokerLink(listen, speak, (e) => this.receive(e as Envelope<In>));
    }
    window.clearInterval(this.watch);
    this.noRelaysSince = performance.now();
    this.watch = window.setInterval(() => this.tick(), 1000);
  }

  protected leave(): void {
    void this.room?.leave();
    this.room = undefined;
    this.direct = undefined;
    this.broker?.close();
    this.broker = undefined;
  }

  /** A device appeared on the direct path (the screen greets it). */
  protected onDirectPeer(_peer: string): void {}

  /** Send a game message: direct when that path is up, otherwise (or for control messages, also) via the relay. */
  protected sendMsg(m: Mine, opts: { both?: boolean; directTo?: string } = {}): void {
    const e: Envelope<Mine> = { f: this.id, i: this.seq++, m };
    const target = opts.directTo ?? this.directPeer;
    const directUp = !!target && this.directReady(target);
    if (this.direct && target && (directUp || opts.directTo || opts.both)) void this.direct.send(e as unknown as JsonValue, { target });
    if (this.broker && (!directUp || opts.both)) this.broker.publish(e);
  }

  private directReady(peer: string): boolean {
    return this.room?.getPeers()[peer]?.connectionState === 'connected';
  }

  private receive(e: Envelope<In>, directPeer?: string): void {
    if (e.f === this.id || !this.dedupe.fresh(e)) return;
    this.seen = true;
    if (directPeer && (!this.other || e.f === this.other)) this.directPeer = directPeer;
    if (e.f === this.other) this.lastHeard = performance.now();
    this.onArrive(e.m, e.f);
  }

  /** Mark a device as the other end of the link. */
  protected adopt(device: string): void {
    this.other = device;
    this.lastHeard = performance.now();
  }

  protected drop(): void {
    this.other = undefined;
    this.directPeer = undefined;
  }

  /** Leave and join again: fresh relay subscriptions, announcements and broker connections. */
  protected rejoin(): void {
    if (!this.code) return;
    this.setStatus('reconnecting');
    this.join(this.code);
  }

  private tick(): void {
    if (this.other && performance.now() - this.lastHeard > GONE_MS) {
      this.drop();
      this.onGone();
    }
    const reachable = relaysOpen() + (this.broker?.connected ?? 0);
    if (reachable > 0 || !navigator.onLine) this.noRelaysSince = performance.now();
    else if (performance.now() - this.noRelaysSince > 15000) {
      // Online, yet nothing reachable for a while: start over.
      this.noRelaysSince = performance.now();
      this.rejoin();
      return;
    }
    this.onTick();
  }

  protected reachable(): number {
    return relaysOpen() + (this.broker?.connected ?? 0);
  }

  get connected(): boolean {
    return !!this.other;
  }

  diagnostics(): LinkDiagnostics {
    const direct = !!this.directPeer && this.directReady(this.directPeer);
    return {
      online: navigator.onLine,
      relays: relaysOpen(),
      relayTotal: RELAY_ONLY ? 0 : relayUrls().length,
      brokers: this.broker?.connected ?? 0,
      brokerTotal: this.broker?.total ?? 0,
      found: this.seen || !!this.other,
      link: this.other ? 'connected' : this.directPeer ? (this.room?.getPeers()[this.directPeer]?.connectionState ?? 'new') : 'none',
      path: this.other ? (direct ? 'direct' : 'relay') : 'none',
    };
  }
}

/** The big screen: owns the code and accepts one phone at a time. */
export class RelayHostLink extends DualLink<ControllerMsg, ScreenMsg> {
  constructor(
    private readonly onMessage: (msg: ControllerMsg) => void,
    private readonly onStatusChange: (status: LinkStatus, code: string) => void,
  ) {
    super('screen');
  }

  start(code: string): void {
    this.setStatus('starting');
    this.join(code);
  }

  protected onDirectPeer(peer: string): void {
    // Greet newcomers on the direct path straight away; phones on the relay path greet us first.
    this.sendMsg({ t: 'welcome', code: this.code }, { directTo: peer });
  }

  protected onArrive(m: ControllerMsg, from: string): void {
    if (m.t === 'hello') {
      // One phone at a time: a second phone waits until the first goes quiet or says goodbye.
      if (this.other && from !== this.other) return;
      const isNew = from !== this.other;
      this.adopt(from);
      this.sendMsg({ t: 'welcome', code: this.code }, { both: true });
      if (isNew) this.setStatus('connected');
    }
    if (from !== this.other) return;
    if (m.t === 'bye') {
      this.drop();
      this.setStatus('ready');
      return;
    }
    this.onMessage(m);
  }

  protected onGone(): void {
    this.setStatus('ready');
  }

  protected onTick(): void {
    if (this.other) return;
    if (!navigator.onLine || this.reachable() === 0) {
      if (this.status !== 'offline') this.setStatus('offline');
    } else if (this.status !== 'ready') this.setStatus('ready');
  }

  send(msg: ScreenMsg): void {
    if (this.other) this.sendMsg(msg, { both: msg.t !== 'state' });
  }

  protected setStatus(status: LinkStatus): void {
    this.status = status;
    this.onStatusChange(status, this.code);
  }
}

/** The phone: announces itself under the code until a screen welcomes it, then talks only to that screen. */
export class RelayControllerLink extends DualLink<ScreenMsg, ControllerMsg> {
  private waitTimer = 0;
  private beacon = 0;

  constructor(
    private readonly onMessage: (msg: ScreenMsg) => void,
    private readonly onStatusChange: (status: LinkStatus) => void,
  ) {
    super('phone');
  }

  connect(code: string): void {
    if (this.code === code && this.beacon) return;
    this.setStatus('starting');
    this.join(code);
    this.startBeacon();
  }

  /** Say hello every second until a screen answers. */
  private startBeacon(): void {
    window.clearInterval(this.beacon);
    this.beacon = window.setInterval(() => {
      if (!this.other) this.sendMsg(hello(), { both: true });
    }, 1000);
    window.clearTimeout(this.waitTimer);
    this.waitTimer = window.setTimeout(() => {
      if (!this.other) this.setStatus(navigator.onLine && this.reachable() > 0 ? 'no-screen' : 'offline');
    }, 12000);
  }

  protected rejoin(): void {
    super.rejoin();
    if (this.code) this.startBeacon();
  }

  protected onArrive(m: ScreenMsg, from: string): void {
    if (m.t === 'welcome') {
      if (this.other !== from) {
        this.adopt(from);
        window.clearTimeout(this.waitTimer);
        this.setStatus('connected');
        this.sendMsg(hello(), { both: true });
      }
      return;
    }
    if (from === this.other) this.onMessage(m);
  }

  protected onGone(): void {
    this.setStatus('reconnecting');
  }

  protected onTick(): void {}

  /** Say goodbye and leave promptly so the screen pauses straight away. */
  close(): void {
    if (this.other) this.sendMsg({ t: 'bye' }, { both: true });
    window.clearInterval(this.beacon);
    this.beacon = 0;
    this.code = '';
    // Give the goodbye a moment to leave before the sockets close.
    window.setTimeout(() => {
      if (!this.code) this.leave();
    }, 150);
    this.drop();
  }

  send(msg: ControllerMsg): void {
    if (this.other) this.sendMsg(msg, { both: msg.t !== 'input' });
  }

  protected setStatus(status: LinkStatus): void {
    this.status = status;
    this.onStatusChange(status);
  }
}

function hello(): ControllerMsg {
  return { t: 'hello', v: 1, device: navigator.userAgent.slice(0, 80) };
}
