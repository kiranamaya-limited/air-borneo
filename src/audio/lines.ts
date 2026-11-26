/**
 * Everything the crew says out loud, in one place. The same list (lines.json) feeds the voice
 * generator (scripts/voices.py), which records each line as a clip in public/voice/<id>.mp3.
 */
import lines from './lines.json';

export type VoiceKind = 'pa' | 'callout';
export interface VoiceLine {
  id: string;
  kind: VoiceKind;
  text: string;
  /** Phonetic respelling for the voice generator (Malay and local names); the game shows `text`. */
  say?: string;
}

export const VOICE_LINES = lines as VoiceLine[];

const byId = new Map(VOICE_LINES.map((l) => [l.id, l]));
const byText = new Map(VOICE_LINES.map((l) => [l.text, l]));

/** The text of a line, by id. */
export function line(id: string): string {
  const l = byId.get(id);
  if (!l) throw new Error(`No voice line "${id}"`);
  return l.text;
}

/** The recorded line for some spoken text, if there is one. */
export function voiceFor(text: string): VoiceLine | undefined {
  return byText.get(text);
}
