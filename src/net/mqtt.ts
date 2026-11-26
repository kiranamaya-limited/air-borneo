/**
 * The always-works path: messages relayed through public MQTT brokers over secure WebSockets.
 * Both devices only need ordinary outbound internet (any Wi-Fi, 4G/5G, hotel or venue network),
 * so this carries the game whenever a direct WebRTC link can't be made. We connect to several
 * brokers at once and publish to all of them, so one being down or blocked doesn't matter.
 */
import mqtt, { type MqttClient } from 'mqtt';

/** Free public brokers that accept anonymous WebSocket clients. */
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];

export function brokerUrls(): string[] {
  const pinned = import.meta.env.VITE_MQTT_BROKERS;
  return pinned ? pinned.split(',').map((u) => u.trim()).filter(Boolean) : BROKERS;
}

/** A message on the wire, on either path: who sent it, its number, and the game message. */
export interface Envelope<T = unknown> {
  /** Sender's device id (random per page load). */
  f: string;
  /** Sender's message number, for dropping duplicates. */
  i: number;
  m: T;
}

/** Remembers recent message ids per sender so the same message arriving twice is handled once. */
export class Dedupe {
  private readonly seen = new Map<string, Set<number>>();

  /** True the first time a (sender, id) pair is seen. */
  fresh(e: Pick<Envelope, 'f' | 'i'>): boolean {
    let ids = this.seen.get(e.f);
    if (!ids) this.seen.set(e.f, (ids = new Set()));
    if (ids.has(e.i)) return false;
    ids.add(e.i);
    if (ids.size > 400) {
      const keep = [...ids].slice(-200);
      ids.clear();
      for (const k of keep) ids.add(k);
    }
    return true;
  }
}

export function isEnvelope(x: unknown): x is Envelope {
  const e = x as Envelope;
  return !!e && typeof e === 'object' && typeof e.f === 'string' && typeof e.i === 'number' && !!e.m && typeof e.m === 'object';
}

/** Topic names for a pairing code: one for each direction. */
export function topics(code: string): { toScreen: string; toPhone: string } {
  const base = `airborneo-ch/v1/${code}`;
  return { toScreen: `${base}/c`, toPhone: `${base}/s` };
}

export class BrokerLink {
  private readonly clients: MqttClient[];

  constructor(
    private readonly listen: string,
    private readonly speak: string,
    onEnvelope: (e: Envelope) => void,
  ) {
    this.clients = brokerUrls().map((url) => {
      const c = mqtt.connect(url, {
        clientId: `ab-${Math.random().toString(36).slice(2, 12)}`,
        keepalive: 20,
        reconnectPeriod: 2500,
        connectTimeout: 8000,
        clean: true,
      });
      c.on('connect', () => c.subscribe(this.listen, { qos: 0 }));
      c.on('message', (_topic, payload) => {
        try {
          const e = JSON.parse(payload.toString()) as unknown;
          if (isEnvelope(e)) onEnvelope(e);
        } catch {
          /* not ours */
        }
      });
      c.on('error', () => undefined); // reconnects on its own
      return c;
    });
  }

  get connected(): number {
    return this.clients.filter((c) => c.connected).length;
  }

  get total(): number {
    return this.clients.length;
  }

  publish(e: Envelope): void {
    const payload = JSON.stringify(e);
    for (const c of this.clients) if (c.connected) c.publish(this.speak, payload, { qos: 0 });
  }

  /** Reconnect any broker that has dropped (e.g. when the network comes back). */
  reconnect(): void {
    for (const c of this.clients) if (!c.connected) c.reconnect();
  }

  close(): void {
    for (const c of this.clients) c.end(true);
  }
}
