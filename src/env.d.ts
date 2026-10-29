/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PEER_HOST?: string;
  readonly VITE_PEER_PORT?: string;
  readonly VITE_PEER_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** LAN IPv4 of the dev machine, injected by vite.config.ts for the pairing QR code. */
declare const __DEV_LAN_HOST__: string;
