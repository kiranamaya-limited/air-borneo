/** The people on board AB 101, and what they say when you fly them around. */
import type { Reaction } from './comfort';

/** Little moments from the cabin, shown along the route (by route station tag). */
export const CABIN_STORIES: { at: string; offset: number; text: string }[] = [
  { at: 'climb', offset: 300, text: 'Row 3 · Aisyah finished her degree in KL last week. Today she goes home for good.' },
  { at: 'kl', offset: 300, text: 'Row 7 · Pakcik Jalil waves goodbye to the Twin Towers. His grandchildren are waiting in Kuching.' },
  { at: 'hills', offset: 900, text: 'Row 12 · The Entingan family are going home to the longhouse for Gawai.' },
  { at: 'islands', offset: 300, text: 'Row 15 · Daniel has worked in KL for two years. His mum is cooking laksa tonight.' },
  { at: 'storm-out', offset: 200, text: 'Row 9 · Little Amir is asleep. His father hasn’t seen him in three months.' },
  { at: 'sarawak', offset: 400, text: 'Row 4 · “Look, Santubong!” Nenek Siti knows she’s nearly home.' },
  { at: 'kuching', offset: 200, text: 'The whole cabin is at the windows: the river, the golden Dewan, home.' },
];

/** What passengers shout for each kind of reaction. */
export const REACTION_LINES: Record<Reaction, string[]> = {
  gasp: ['Whoa!', 'Oof!', 'My coffee!', 'Ooh…', 'Hey!', 'Steady!'],
  whoa: ['Whoaaa!', 'My stomach!', 'Ugh, heavy!'],
  scream: ['AAAH!', 'We’re falling!', 'Eeek!', 'Mak!'],
  vomit: ['Sick bag, please!', 'Bleurgh…', 'Not again…'],
  nervous: ['Are we lost?', 'Is this the way to Kuching?', 'Uh… captain?'],
  lightning: ['Was that lightning?!', 'Did you see that?!'],
  happy: ['So smooth', 'Best flight ever!', 'Lovely view', 'Barely felt a thing!', 'Nearly home!'],
  applause: ['Bravo, captain!', 'What a landing!'],
};

export function lineFor(r: Reaction, rand = Math.random): string {
  const lines = REACTION_LINES[r];
  return lines[Math.floor(rand() * lines.length)];
}
