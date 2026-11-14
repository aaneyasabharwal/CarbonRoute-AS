/**
 * P15: the site must not claim more than the system does. Without a cluster the
 * execution is a labelled simulation (no workload runs, no "local sandbox"),
 * energy is an assumption (no measured or "empirical" savings), and the old
 * horizon sigma(t) uncertainty model was removed (risk uses a declared runtime cv).
 * Scans the source, because many pages show only one step or tab at a time.
 */
import { describe, it, expect } from 'vitest';

const SOURCES = import.meta.glob<string>('../../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const FORBIDDEN: RegExp[] = [
  /sandbox/i,
  /horizon uncertainty/i,
  /sigma_0|sigma\(t\)/i,
  /empirical (carbon|savings)/i,
  /realized carbon (accounting|emissions)/i,
  /minimi[sz]e realized/i,
  /real container/i,
  /actual carbon emissions/i,
  // P16: the runtime-CV risk does not model carbon forecast uncertainty
  /different uncertainty|(low|high) uncertainty/i,
  /uncertainty pushes risk/i,
  /models forecast error variance/i,
  /erfc\(slack/i,
  /calibrated violation probability/i,
];

describe('no overstated claims in the site text', () => {
  const entries = Object.entries(SOURCES);

  it('scans the source files', () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it.each(FORBIDDEN.map((r) => [String(r), r] as const))('no match for %s', (_label, pattern) => {
    const hits: string[] = [];
    for (const [file, text] of entries) {
      text.split(/\r?\n/).forEach((line, i) => {
        if (pattern.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
