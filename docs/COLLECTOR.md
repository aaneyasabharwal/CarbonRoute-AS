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

- **Folder lock (P7).** `npm run collect` takes `<out>/.collector.lock` (process id and start time).
  A second collector pointed at the same folder refuses to start (exit code 3) while the first is
  alive; a lock left behind by a process that no longer exists (crash, reboot) is replaced. The lock
  never touches the `.jsonl` files. The collector started on 2026-11-13 (pid 18848) is a wrapper
  script that predates the lock, so check the process list before starting `npm run collect`.

### Lock limitations (P7 review) and recovery

- **Simultaneous starts.** If two collectors are started at the same instant while a *stale* lock
  exists, both can remove it and both can start. The lock protects against an accidental second
  start, not against two starts in the same millisecond. Start collectors one at a time.
- **Reused process ids (Windows).** Liveness is checked by process id. If the collector died and
  Windows later gave its id to an unrelated process, the lock looks live and the collector refuses
  to start (exit code 3, message names the pid). It never starts a second writer by mistake; it
  errs towards not collecting.
- **Release.** The lock is removed on normal completion and on Ctrl-C. Any other stop (closing the
  window, `kill`, sleep, crash) leaves it behind; the next start replaces it if that process is gone.
- **Wrapper collectors** that do not use `npm run collect` ignore the lock.

Recovery when a start is refused (exit code 3):

1. Read the pid and start time in the message (or in `<out>/.collector.lock`).
2. Check whether that process is a collector:
   ```powershell
   Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" | Select-Object ProcessId, Name, CommandLine, CreationDate
   ```
3. If it **is** a running collector: do nothing; collection is already happening.
4. If it is **not** a collector (another program, or nothing): delete only the lock file,
   `Remove-Item <out>.collector.lock`, and start the collector again. Never delete or edit the
   `.jsonl` files.
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
- **Seven days of data have not been collected.** The forecast-error model needs at least 7 days
  (see [ML.md](ML.md)); collection must be restarted after the 25th run and kept running without gaps.
- The Electricity Maps trial key expires around 26–27 November 2026. After that, collection stops
  until a new key is configured.
