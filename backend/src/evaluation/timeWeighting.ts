/**
 * Time-weighted carbon intensity over a window.
 *
 * Each value covers an interval [start, start + intervalMinutes). Its weight is the number of
 * minutes that interval overlaps the window, so partial first and last intervals count only
 * for the time actually inside the window.
 *
 * Rules (never silently invent data):
 *  - Timestamps must be ISO-8601 with a time zone (Z or an offset); they are compared in UTC.
 *  - A duplicated interval start, or two intervals that overlap, is an error.
 *  - A part of the window with no interval is reported as missing; the average is then null
 *    (missing time is never treated as zero), unless `allowPartial` is set, in which case the
 *    average covers the observed minutes only and `complete` is false.
 *  - Values must be finite and non-negative.
 */

export interface TimedValue {
  /** Interval start, ISO-8601 with a time zone. */
  datetime: string;
  value: number;
  /** Interval length in minutes (60 for hourly data). */
  intervalMinutes: number;
}

export interface WindowSegment {
  intervalStart: string;
  overlapStart: string;
  overlapEnd: string;
  overlapMinutes: number;
  value: number;
}

export interface TimeWeightedResult {
  /** Time-weighted average, or null when the window is not fully covered. */
  value: number | null;
  complete: boolean;
  windowMinutes: number;
  coveredMinutes: number;
  segments: WindowSegment[];
  /** Parts of the window with no interval, in UTC. */
  missing: { start: string; end: string }[];
}

export type TimeWeightingErrorCode =
  | 'INVALID_WINDOW'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_VALUE'
  | 'INVALID_INTERVAL'
  | 'DUPLICATE_INTERVAL'
  | 'OVERLAPPING_INTERVALS';

export class TimeWeightingError extends Error {
  constructor(public readonly code: TimeWeightingErrorCode, message: string) {
    super(message);
    this.name = 'TimeWeightingError';
  }
}

const ZONED_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Parses an ISO-8601 timestamp that carries a time zone; returns epoch milliseconds (UTC). */
export function parseZonedTimestamp(value: string, field = 'timestamp'): number {
  if (typeof value !== 'string' || !ZONED_ISO.test(value)) {
    throw new TimeWeightingError('INVALID_TIMESTAMP', `${field} must be ISO-8601 with a time zone (Z or ±hh:mm): "${String(value)}"`);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new TimeWeightingError('INVALID_TIMESTAMP', `${field} is not a valid date: "${value}"`);
  return ms;
}

const iso = (ms: number) => new Date(ms).toISOString();
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export function timeWeightedAverage(
  window: { startUtc: string; endUtc: string },
  values: TimedValue[],
  opts: { allowPartial?: boolean } = {}
): TimeWeightedResult {
  const wStart = parseZonedTimestamp(window.startUtc, 'window start');
  const wEnd = parseZonedTimestamp(window.endUtc, 'window end');
  if (!(wEnd > wStart)) throw new TimeWeightingError('INVALID_WINDOW', 'The window end must be after its start.');

  const intervals = values
    .map((v) => {
      const start = parseZonedTimestamp(v.datetime, 'interval start');
      if (!(Number.isFinite(v.intervalMinutes) && v.intervalMinutes > 0)) {
        throw new TimeWeightingError('INVALID_INTERVAL', `Interval at ${v.datetime} has an invalid length (${v.intervalMinutes} min).`);
      }
      if (!(Number.isFinite(v.value) && v.value >= 0)) {
        throw new TimeWeightingError('INVALID_VALUE', `Interval at ${v.datetime} has an invalid value (${v.value}).`);
      }
      return { start, end: start + v.intervalMinutes * 60_000, value: v.value };
    })
    .sort((a, b) => a.start - b.start);

  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i].start === intervals[i - 1].start) {
      throw new TimeWeightingError('DUPLICATE_INTERVAL', `Two values are given for the interval starting ${iso(intervals[i].start)}.`);
    }
    if (intervals[i].start < intervals[i - 1].end) {
      throw new TimeWeightingError(
        'OVERLAPPING_INTERVALS',
        `The interval starting ${iso(intervals[i].start)} overlaps the one starting ${iso(intervals[i - 1].start)}.`
      );
    }
  }

  const segments: WindowSegment[] = [];
  const missing: { start: string; end: string }[] = [];
  let cursor = wStart;
  let weighted = 0;
  let covered = 0;
  for (const it of intervals) {
    const s = Math.max(it.start, wStart);
    const e = Math.min(it.end, wEnd);
    if (e <= s) continue; // no overlap with the window
    if (s > cursor) missing.push({ start: iso(cursor), end: iso(s) });
    const minutes = (e - s) / 60_000;
    segments.push({ intervalStart: iso(it.start), overlapStart: iso(s), overlapEnd: iso(e), overlapMinutes: round(minutes, 4), value: it.value });
    weighted += it.value * minutes;
    covered += minutes;
    cursor = Math.max(cursor, e);
  }
  if (cursor < wEnd) missing.push({ start: iso(cursor), end: iso(wEnd) });

  const windowMinutes = (wEnd - wStart) / 60_000;
  const complete = missing.length === 0;
  const value = covered > 0 && (complete || opts.allowPartial) ? round(weighted / covered) : null;
  return { value, complete, windowMinutes: round(windowMinutes, 4), coveredMinutes: round(covered, 4), segments, missing };
}
