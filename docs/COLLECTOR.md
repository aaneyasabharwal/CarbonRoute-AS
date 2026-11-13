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

## Restarting or resuming safely

The collector keeps no state besides the output files, so resuming is starting it again.

1. Check step 1 above. **Do not start a second collector** while one is running.
2. Do not delete, rename or edit existing `.jsonl` files. New runs append to the file of the current
   UTC date (a new file starts at 00:00 UTC).
3. Start it again with the same `--out` folder (command above). Run numbers start again at 1; this is
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
