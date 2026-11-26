/** Title (pairing), results and pause screens. */
import QRCode from 'qrcode';
import { brand } from '../brand/tokens';
import type { Summary } from '../game/scoring';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class Screens {
  private readonly title = $('title');
  private readonly results = $('results');
  private readonly paused = $('paused');
  private readonly loading = $('loading');
  private readonly status = $('pair-status');

  hideLoading(): void {
    this.loading.classList.add('done');
    window.setTimeout(() => this.loading.remove(), 700);
  }

  showTitle(visible: boolean, best = 0): void {
    this.title.classList.toggle('hidden', !visible);
    $('title-best').textContent = best > 0 ? `Your best: ${best.toLocaleString()} pts` : '';
  }

  async setPairing(code: string, url: string): Promise<void> {
    const shown = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
    $('pair-code').textContent = shown;
    $('pause-code').textContent = shown;
    $('pair-url').textContent = url.replace(/^https?:\/\//, '');
    const opts = { margin: 1, color: { dark: brand.colors.ink, light: '#ffffff' } };
    await QRCode.toCanvas($<HTMLCanvasElement>('qr'), url, { ...opts, width: 230 });
    await QRCode.toCanvas($<HTMLCanvasElement>('qr-paused'), url, { ...opts, width: 180 });
  }

  pairStatus(text: string, cls: 'ok' | 'warn' | 'bad'): void {
    this.status.className = `ab-chip ${cls}`;
    (this.status.querySelector('span:last-child') as HTMLElement).textContent = text;
  }

  showPaused(visible: boolean): void {
    this.paused.classList.toggle('hidden', !visible);
  }

  hideResults(): void {
    this.results.classList.add('hidden');
  }

  showResults(sum: Summary, best: number, newBest: boolean, crashReason: string, complaint: string | null): void {
    this.results.classList.remove('hidden');
    $('res-eyebrow').textContent = sum.crashed ? 'Flight not completed' : `Welcome home · Kuching · comfort ${sum.comfort}%`;
    $('res-stars').textContent = '★'.repeat(sum.stars) + '☆'.repeat(5 - sum.stars);
    $('res-rank').textContent = sum.crashed ? crashReason : sum.rank;
    $('res-score').textContent = `${sum.score.toLocaleString()} pts`;
    const bestEl = $('res-best');
    bestEl.textContent = newBest ? 'New personal best!' : `Personal best ${best.toLocaleString()} pts`;
    bestEl.classList.toggle('new', newBest);
    const table = $('res-lines');
    table.innerHTML = '';
    for (const line of sum.lines) {
      const tr = document.createElement('tr');
      const cells = [line.label, line.value, `${line.points > 0 ? '+' : ''}${line.points.toLocaleString()}`];
      cells.forEach((text, i) => {
        const td = document.createElement('td');
        td.textContent = text;
        if (i === 2 && line.points < 0) td.className = 'neg';
        tr.appendChild(td);
      });
      table.appendChild(tr);
    }
    const note = sum.crashed
      ? 'Keep the aircraft on the dotted line and above the terrain. Small, gentle inputs keep everyone safe and happy.'
      : `${sum.happy} of ${sum.passengers} passengers had a lovely flight` +
        (sum.sickBags ? ` · ${sum.sickBags} needed a sick bag` : ' · nobody needed a sick bag') +
        (sum.landing ? `. Touchdown at ${Math.round(sum.landing.fpm)} fpm (${sum.landing.grade}).` : '.') +
        (complaint ? ` Biggest complaint: ${complaint.toLowerCase()}.` : ' Not a single complaint!');
    $('res-note').textContent = note;
  }
}
