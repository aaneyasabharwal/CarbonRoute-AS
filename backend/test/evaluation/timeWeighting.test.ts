import { describe, it, expect } from 'vitest';
import { timeWeightedAverage, TimedValue } from '../../src/evaluation/timeWeighting';

const hourly = (entries: Array<[string, number]>): TimedValue[] =>
  entries.map(([datetime, value]) => ({ datetime, value, intervalMinutes: 60 }));

describe('timeWeightedAverage', () => {
  it('exact hourly window: the single interval value', () => {
    const r = timeWeightedAverage({ startUtc: '2026-11-12T20:00:00Z', endUtc: '2026-11-12T21:00:00Z' }, hourly([['2026-11-12T20:00:00Z', 123]]));
    expect(r).toMatchObject({ value: 123, complete: true, windowMinutes: 60, coveredMinutes: 60, missing: [] });
    expect(r.segments).toEqual([
      { intervalStart: '2026-11-12T20:00:00.000Z', overlapStart: '2026-11-12T20:00:00.000Z', overlapEnd: '2026-11-12T21:00:00.000Z', overlapMinutes: 60, value: 123 },
    ]);
  });

  it('partial first and last intervals are weighted by the minutes inside the window', () => {
    // 19:45 -> 21:15: 15 min of 19:00 (100), 60 min of 20:00 (200), 15 min of 21:00 (400)
    const r = timeWeightedAverage(
      { startUtc: '2026-11-12T19:45:00Z', endUtc: '2026-11-12T21:15:00Z' },
      hourly([['2026-11-12T19:00:00Z', 100], ['2026-11-12T20:00:00Z', 200], ['2026-11-12T21:00:00Z', 400]])
    );
    expect(r.segments.map((s) => s.overlapMinutes)).toEqual([15, 60, 15]);
    expect(r.value).toBe(216.67); // (100*15 + 200*60 + 400*15) / 90, rounded to 2 decimals
  });

  it('multiple full intervals give the plain mean', () => {
    const r = timeWeightedAverage(
      { startUtc: '2026-11-12T00:00:00Z', endUtc: '2026-11-12T03:00:00Z' },
      hourly([['2026-11-12T00:00:00Z', 90], ['2026-11-12T01:00:00Z', 120], ['2026-11-12T02:00:00Z', 150]])
    );
    expect(r.value).toBe(120);
  });

  it('ignores intervals outside the window and works in any order', () => {
    const r = timeWeightedAverage(
      { startUtc: '2026-11-12T01:00:00Z', endUtc: '2026-11-12T02:00:00Z' },
      hourly([['2026-11-12T03:00:00Z', 999], ['2026-11-12T01:00:00Z', 50], ['2026-11-12T00:00:00Z', 999]])
    );
    expect(r.value).toBe(50);
    expect(r.segments).toHaveLength(1);
  });

  it('missing data is reported and never treated as zero', () => {
    const r = timeWeightedAverage(
      { startUtc: '2026-11-12T00:00:00Z', endUtc: '2026-11-12T03:00:00Z' },
      hourly([['2026-11-12T00:00:00Z', 100], ['2026-11-12T02:00:00Z', 100]])
    );
    expect(r.value).toBeNull();
    expect(r.complete).toBe(false);
    expect(r.coveredMinutes).toBe(120);
    expect(r.missing).toEqual([{ start: '2026-11-12T01:00:00.000Z', end: '2026-11-12T02:00:00.000Z' }]);
    // With allowPartial, the average covers observed minutes only (still 100, not 66.67).
    expect(timeWeightedAverage({ startUtc: '2026-11-12T00:00:00Z', endUtc: '2026-11-12T03:00:00Z' }, hourly([['2026-11-12T00:00:00Z', 100], ['2026-11-12T02:00:00Z', 100]]), { allowPartial: true }).value).toBe(100);
  });

  it('missing start and end of the window are listed', () => {
    const r = timeWeightedAverage({ startUtc: '2026-11-12T00:30:00Z', endUtc: '2026-11-12T03:30:00Z' }, hourly([['2026-11-12T01:00:00Z', 1], ['2026-11-12T02:00:00Z', 1]]));
    expect(r.missing).toEqual([
      { start: '2026-11-12T00:30:00.000Z', end: '2026-11-12T01:00:00.000Z' },
      { start: '2026-11-12T03:00:00.000Z', end: '2026-11-12T03:30:00.000Z' },
    ]);
    expect(timeWeightedAverage({ startUtc: '2026-11-12T00:00:00Z', endUtc: '2026-11-12T01:00:00Z' }, []).value).toBeNull();
  });

  it('rejects duplicated intervals', () => {
    expect(() =>
      timeWeightedAverage({ startUtc: '2026-11-12T00:00:00Z', endUtc: '2026-11-12T01:00:00Z' }, hourly([['2026-11-12T00:00:00Z', 1], ['2026-11-12T00:00:00.000Z', 1]]))
    ).toThrow(expect.objectContaining({ code: 'DUPLICATE_INTERVAL' }));
    // Same instant written with an offset is still a duplicate.
    expect(() =>
      timeWeightedAverage({ startUtc: '2026-11-12T00:00:00Z', endUtc: '2026-11-12T01:00:00Z' }, hourly([['2026-11-12T00:00:00Z', 1], ['2026-11-12T05:30:00+05:30', 2]]))
    ).toThrow(expect.objectContaining({ code: 'DUPLICATE_INTERVAL' }));
  });

  it('rejects overlapping intervals', () => {
    const values: TimedValue[] = [
      { datetime: '2026-11-12T00:00:00Z', value: 1, intervalMinutes: 60 },
      { datetime: '2026-11-12T00:30:00Z', value: 2, intervalMinutes: 15 },
    ];
    expect(() => timeWeightedAverage({ startUtc: '2026-11-12T00:00:00Z', endUtc: '2026-11-12T01:00:00Z' }, values)).toThrow(
      expect.objectContaining({ code: 'OVERLAPPING_INTERVALS' })
    );
  });

  it('handles UTC boundaries: offsets, midnight and month/year rollover', () => {
    // 23:30 IST on 31 Dec = 18:00 UTC; window across UTC midnight into the new year.
    const r = timeWeightedAverage(
      { startUtc: '2026-12-31T23:30:00Z', endUtc: '2027-01-01T00:30:00+00:00' },
      hourly([['2026-12-31T23:00:00Z', 200], ['2027-01-01T05:30:00+05:30', 100]]) // second = 00:00 UTC
    );
    expect(r.segments.map((s) => [s.intervalStart, s.overlapMinutes])).toEqual([
      ['2026-12-31T23:00:00.000Z', 30],
      ['2027-01-01T00:00:00.000Z', 30],
    ]);
    expect(r.value).toBe(150);
  });

  it('supports 15-minute data', () => {
    const q = (m: number, v: number): TimedValue => ({ datetime: new Date(Date.UTC(2026, 10, 12, 0, m)).toISOString(), value: v, intervalMinutes: 15 });
    const r = timeWeightedAverage({ startUtc: '2026-11-12T00:10:00Z', endUtc: '2026-11-12T00:40:00Z' }, [q(0, 100), q(15, 200), q(30, 300)]);
    expect(r.segments.map((s) => s.overlapMinutes)).toEqual([5, 15, 10]);
    expect(r.value).toBe(216.67); // (100*5 + 200*15 + 300*10) / 30, rounded to 2 decimals
  });

  it('rejects invalid windows, timestamps without a time zone and invalid values', () => {
    const w = { startUtc: '2026-11-12T01:00:00Z', endUtc: '2026-11-12T01:00:00Z' };
    expect(() => timeWeightedAverage(w, [])).toThrow(expect.objectContaining({ code: 'INVALID_WINDOW' }));
    expect(() => timeWeightedAverage({ startUtc: '2026-11-12T01:00:00', endUtc: '2026-11-12T02:00:00Z' }, [])).toThrow(
      expect.objectContaining({ code: 'INVALID_TIMESTAMP' })
    );
    const ok = { startUtc: '2026-11-12T00:00:00Z', endUtc: '2026-11-12T01:00:00Z' };
    expect(() => timeWeightedAverage(ok, hourly([['2026-11-12T00:00:00Z', NaN]]))).toThrow(expect.objectContaining({ code: 'INVALID_VALUE' }));
    expect(() => timeWeightedAverage(ok, hourly([['2026-11-12T00:00:00Z', -1]]))).toThrow(expect.objectContaining({ code: 'INVALID_VALUE' }));
    expect(() => timeWeightedAverage(ok, [{ datetime: '2026-11-12T00:00:00Z', value: 1, intervalMinutes: 0 }])).toThrow(
      expect.objectContaining({ code: 'INVALID_INTERVAL' })
    );
  });
});
