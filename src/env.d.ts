/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PEER_HOST?: string;
  readonly VITE_PEER_PORT?: string;
  readonly VITE_PEER_PATH?: string;
  /** '1' for the offline demo build: pair through the local server at /peerjs. */
  readonly VITE_PEER_LOCAL?: string;
  /** Comma-separated Nostr relay URLs to pair through (tests); default: Trystero's public relays. */
  readonly VITE_NOSTR_RELAYS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** LAN IPv4 of the dev machine, injected by vite.config.ts for the pairing QR code. */
declare const __DEV_LAN_HOST__: string;
