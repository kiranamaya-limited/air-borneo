/** The people on board AB 101, and what they say when you fly them around. */
import type { Reaction } from './comfort';

/** Little moments from the cabin, shown along the route (by route station tag). */
export const CABIN_STORIES: { at: string; offset: number; text: string }[] = [
  { at: 'climb', offset: 300, text: '🧳 Row 3 · Aisyah is flying home to Singapore for her sister’s wedding.' },
  { at: 'city', offset: 300, text: '👋 Row 7 · Nenek Siti’s first flight. She’s waving at Kuching below.' },
  { at: 'river', offset: 900, text: '📸 Row 12 · The Tan family spot the Sarawak River winding to the sea.' },
  { at: 'coast', offset: 500, text: '⛰️ Row 15 · “Look, Mount Santubong!” A honeymoon couple share the window.' },
  { at: 'islands-2', offset: 200, text: '💼 Row 2 · Daniel has a meeting in Singapore at 3. He trusts you.' },
  { at: 'squall', offset: 200, text: '🧒 Row 9 · Little Amir is asleep. Let’s keep it that way.' },
];

/** What passengers shout for each kind of reaction. */
export const REACTION_LINES: Record<Reaction, string[]> = {
  gasp: ['Whoa!', 'Oof!', 'My coffee!', 'Ooh…', 'Hey!', 'Steady!'],
  whoa: ['Whoaaa!', 'My stomach!', 'Ugh, heavy!'],
  scream: ['AAAH!', 'We’re falling!', 'Eeek!', 'Mak!'],
  vomit: ['🤮 Sick bag, please!', 'Bleurgh…', '🤢 Not again…'],
  nervous: ['Are we lost?', 'Is this the way to Singapore?', 'Uh… captain?'],
  lightning: ['Was that lightning?!', '⚡ Did you see that?!'],
  happy: ['So smooth 😴', 'Best flight ever!', 'Lovely view 😊', 'Barely felt a thing!'],
  applause: ['👏👏👏 Bravo, captain!', '👏 What a landing!'],
};

export function lineFor(r: Reaction, rand = Math.random): string {
  const lines = REACTION_LINES[r];
  return lines[Math.floor(rand() * lines.length)];
}
