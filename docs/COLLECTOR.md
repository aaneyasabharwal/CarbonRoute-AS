# Electricity Maps data collector: running, checking, restarting

The forecast-accuracy evaluation, the replay benchmark, the forecast-error model and the demo all
read the files written by the collector. Collected data cannot be re-fetched later: the plan only
serves the **last 24 h of history** and no past forecasts. A gap in collection is a permanent gap
in the dataset.

## What it does

```bash
cd backend && npm run build
npm run collect -- --out ../../CarbonRoute-AS-data/em-collection --zones DE,GB,US-CAL-CISO,IN-NO,FR --runs 25 --interval-min 60
```

- Every run makes 2 calls per zone (24 h forecast, last 24 h of history): 10 calls per run for 5 zones,
  well under the server-wide budget (`EM_MAX_CALLS_PER_HOUR=120`, `EM_MAX_CALLS_PER_DAY=1500`).
- One JSON line per call is **appended** to `collection-<UTC date>.jsonl`. Failed calls are recorded as
  failures (`ok: false`, error code); nothing is filled in.
- The API key is read from the repository-root `.env` (`ELECTRICITY_MAPS_API_KEY`) and is never written
  or printed.
- Output is outside the repository. Never move it into the repository or commit it.

- **Folder lock (P7).** Every collector entry point (`npm run collect`, and any wrapper, which must
  call `runCollectorCli`/`runCollector` from `backend/src/scripts/collectElectricityMaps.ts`) takes the
  folder lock before doing anything, including before checking the API key. Details:
  `backend/src/scripts/collectorLock.ts`.

### How the lock works

- The lock is a sequence of files `<out>/.collector.lock.<n>`; the highest `n` is current. To take it,
  a collector atomically **creates** the next number. Only one process can create a given number, so
  two collectors that start at the same instant, even when both find an old stale lock, cannot both
  win. Nothing is deleted in order to take a lock.
- The holder refreshes its file (heartbeat) every 30 s. A holder is live only if its file was touched
  in the last 3 minutes **and** its process exists. A crashed collector, or a reused process id
  (Windows can give an old id to another program), therefore stops counting after at most 3 minutes.
  An empty, freshly created lock file counts as live (when unsure, refuse).
- Before every run the collector checks it still owns the lock. If the computer slept long enough
  for another collector to take over, the old one stops with exit code **4** without writing.
- Exit codes: 0 done, 2 no API key, **3 another collector holds the lock**, 4 lock lost.
- The lock never opens the `.jsonl` files; collection only appends to them.

Verified by tests (`backend/test/collector/collectorLock.test.ts`): 6 separate processes starting at
the same instant, with and without a stale lock (exactly one wins); dead and reused process ids;
lost lock; the CLI started as a separate process (wrapper invocation) refusing while another
process holds the lock. In a 15-trial stress run (8 processes each) exactly one won every time; the
previous single-file lock let 3 of 6 processes in one of three trials.

### Remaining limitations

- Liveness uses file modification times on the same machine. Do not put the collection folder on a
  network or synced drive (OneDrive, SMB), where timestamps and atomic creation may not be reliable.
- After a crash, a new collector can start only once the old heartbeat is 3 minutes old.
- A script that writes collection files without going through `runCollector` bypasses the lock.
  The sprint wrapper (`em-collector.cjs`) was replaced on 2026-11-13 20:50 UTC by a delegate that
  calls `runCollectorCli`; the earlier standalone wrapper is retired.

### Recovery when a start is refused (exit code 3)

1. Read the pid and start time in the message.
2. Check whether that process is a collector:
   ```powershell
   Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" | Select-Object ProcessId, Name, CommandLine, CreationDate
   ```
3. If it **is** a running collector: do nothing; collection is already happening.
4. If it is not: wait 3 minutes and start again (its heartbeat will be stale). Only if the refusal
   persists, delete the `.collector.lock.*` files (never the `.jsonl` files) and start again.
5. After the first run, check with `npm run coverage` that records were appended and none failed.

## Checking that it is healthy

1. Exactly one collector process is running (two would double-count calls and interleave lines):
   ```powershell
   Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*collect*' } | Select-Object ProcessId, CreationDate
   ```
2. The newest run is less than ~70 minutes old and has no failures. From `backend/` after a build:
   ```bash
   npm run coverage -- --data ../../CarbonRoute-AS-data/em-collection
   ```
   It prints records, failed calls, realized hours, missing hours and measured share per zone.

## Backing up

Copy, never move, and verify:

```bash
D=../../CarbonRoute-AS-data; B=$D/backups/em-collection-$(date -u +%Y%m%dT%H%MZ)
mkdir -p $B && cp -p $D/em-collection/*.jsonl $B/
(cd $D/em-collection && sha256sum *.jsonl) | diff - <(cd $B && sha256sum *.jsonl) && echo verified
```

Backup taken 2026-11-13 19:52 UTC: `backups/em-collection-20261113T1952Z` (70 records, checksums
verified).

## Restarting or resuming safely

The collector keeps no state besides the output files, so resuming is starting it again.

1. Check step 1 above. **Do not start a second collector** while one is running.
2. Do not delete, rename or edit existing `.jsonl` files. New runs append to the file of the current
   UTC date (a new file starts at 00:00 UTC).
3. Start it again with the same `--out` folder. For the 7 days the model needs, from `backend/`:
   `npm run collect -- --out ../../CarbonRoute-AS-data/em-collection --runs 168 --interval-min 60`
   (1,680 calls over 7 days, 10 per hour, inside the 120/hour and 1,500/day budget). Run numbers start again at 1; this is
   expected and harmless, because every record carries its `runAt` timestamp and all analyses use
   timestamps, not run numbers.
4. Keep the computer awake while collecting (sleep stops the process; on wake it does not catch up).
5. Re-check after the first run with `npm run coverage`.

A gap of more than 24 h between runs can never be filled. Gaps shorter than 24 h are recovered for
realized values (the next history call returns the last 24 h) but not for forecasts.

## Status (2026-11-13)

- Collection started 2026-11-13 13:32 UTC for DE, GB, US-CAL-CISO, IN-NO and FR, hourly, 25 runs
  (planned end about 2026-11-14 13:32 UTC). At 19:33 UTC: 7 runs, 70 calls, 0 failures, 6.0 h span.
- 20:50 UTC: after 8 runs (80 records, checksum unchanged) the standalone wrapper was stopped between
  runs and replaced by the lock-respecting delegate for the remaining 17 runs (same 25-run plan,
  ending about 2026-11-14 12:50 UTC). Its first run at 20:50 appended 10/10 records; a second
  `npm run collect` against the same folder was refused with exit code 3 and added nothing.
- **Seven days of data have not been collected.** The forecast-error model needs at least 7 days
  (see [ML.md](ML.md)); collection must be restarted after the 25th run and kept running without gaps.
- The Electricity Maps trial key expires around 26–27 November 2026. After that, collection stops
  until a new key is configured.
