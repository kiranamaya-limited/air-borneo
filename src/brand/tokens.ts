/**
 * AirBorneo design tokens: the single source of colour and type for the game.
 *
 * Built from public reports of the AirBorneo identity ("Wings of Unity" logo, "Borneo For You"
 * tagline, white fuselage with the Sarawak flag's red, yellow and black). airborneo.com was not
 * reachable when this was written, so swap in the official values here (and in brand.css) once
 * they are available.
 */
export const brand = {
  name: 'AirBorneo',
  tagline: 'Borneo For You',
  colors: {
    white: '#ffffff',
    cloud: '#f4f5f7',
    mist: '#e6e8ec',
    slate: '#5b6270',
    ink: '#111216',
    red: '#d21f2c',
    yellow: '#ffc629',
    black: '#111216',
    good: '#1fa463',
    sea: '#0b5c7a',
    forest: '#1f4d2b',
  },
  fonts: {
    ui: "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
    // B612 was designed by Airbus for cockpit displays (ATR is an Airbus/Leonardo partnership).
    instrument: "'B612 Mono', 'B612', ui-monospace, monospace",
  },
} as const;

export const flight = {
  callsign: 'AirBorneo 101',
  flightNo: 'AB 101',
  from: { code: 'KCH', icao: 'WBGG', name: 'Kuching International', city: 'Kuching' },
  to: { code: 'SIN', icao: 'WSSS', name: 'Singapore Changi', city: 'Singapore' },
  distanceNm: 381, // great-circle KCH-SIN
  blockTime: '1h 30m',
  aircraft: 'ATR 72-500F',
  cargo: 'Fresh Sarawak seafood & fruit',
} as const;
