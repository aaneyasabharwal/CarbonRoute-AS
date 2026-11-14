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

- **Folder lock.** Every collector entry point (`npm run collect`, and any wrapper, which must
  call `runCollectorCli`/`runCollector` in `backend/src/scripts/collectElectricityMaps.ts`) takes the
  folder lock before anything else, including before checking the API key. Details:
  `backend/src/scripts/collectorLock.ts`.

### How the lock works (since the P7 adversarial review)

- The owner keeps a listening socket open on `127.0.0.1:<port>`, where the port (20000–29999) is
  derived from the folder's real path (case-insensitive on Windows). The operating system allows only
  one process to listen on that address and port, so **two collectors can never both hold the lock**,
  in any interleaving.
- The operating system frees the port when the owner ends in any way: normal exit, crash, Ctrl-C or
  SIGKILL. There are no lock files, no heartbeat, no timeouts and no process-id checks, so a crash
  leaves nothing stale, and **sleep/resume, a frozen process, a clock jump or a reused process id
  cannot let a second collector take over** while the first is alive.
- Every append is fenced: the collector checks it still owns the lock immediately before writing each
  record, with no waiting in between, and stops (exit code 4) if it does not.
- Nothing is ever deleted to take or release the lock, so no collector can remove another's lock.
- Exit codes: 0 done, 2 no API key, **3 another collector holds the lock**, 4 no longer owner.
- The lock never opens the `.jsonl` files; collection only appends to them.
- Transition: a collector still running the previous version (old `.collector.lock.<n>` files naming
  a live process) also blocks a new start.

### Evidence

- `backend/test/collector/collectorLock.test.ts`: 8 separate processes starting at the same instant
  with no lock files, with stale/empty old-style lock files, with a live holder, and with a live
  old-style holder; SIGKILL and crash of the holder; a holder frozen for 5 s is never taken over;
  ownership lost mid-run writes no further record; the CLI and a wrapper, each run as a separate
  process, refuse while the folder is held; a static check that nothing else writes collection files.
- `backend/test/stress/collectorLockStress.cjs` (also in CI): many rounds of processes contending
  continuously with random holds, frozen event loops and random SIGKILLs of holders, checked by an
  independent exclusive-file oracle. With `STRESS_BROKEN_LOCK=1` (a lock that always grants) the
  oracle reports violations, showing it can detect overlap.
- The previous lock (commit c204f90) was shown to be unsafe: a live collector whose lease looked stale
  kept appending after another took over (4 records), and its tidy-up deleted a newer owner's lock.

### Remaining limitations

- Both collectors must run on the **same machine**. The lock does not protect a folder on a network
  share or synchronised drive (OneDrive, SMB) written from two machines; do not do that.
- If an unrelated program happens to listen on the folder's port, the collector refuses to start
  (it never shares). Rename the collection folder to get a different port.
- A script that writes collection files without going through `runCollector` bypasses the lock. The
  sprint wrapper (`em-collector.cjs`) only delegates to `runCollectorCli`.

### Recovery when a start is refused (exit code 3)

1. Read the message: it names the holder's pid and start time (or says the port is used by another
   program).
2. Check that process:
   ```powershell
   Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" | Select-Object ProcessId, Name, CommandLine, CreationDate
   ```
3. If it is a running collector: do nothing; collection is already happening.
4. If you want to stop it, stop that process (Ctrl-C or end the task). The lock is free as soon as it
   has exited; there is nothing to delete. Never delete or edit the `.jsonl` files.
5. After the first run of a new collector, check with `npm run coverage` that records were appended.

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
- 21:06 UTC: after 9 runs (90 records, checksum unchanged) that collector was stopped between runs
  and replaced by one using the socket lock for the remaining 16 runs (same 25-run plan). Its first
  run appended 10/10 records; a second `npm run collect` was refused with exit code 3 and added
  nothing. The leftover old lock file (dead process) was removed; no `.jsonl` file was changed.
- **Seven days of data have not been collected.** The forecast-error model needs at least 7 days
  (see [ML.md](ML.md)); collection must be restarted after the 25th run and kept running without gaps.
- The Electricity Maps trial key expires around 26–27 November 2026. After that, collection stops
  until a new key is configured.
