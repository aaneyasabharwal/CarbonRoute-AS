# Published results (staging)

Copies of the latest replay benchmark and forecast-error model evaluation, served read-only by the
staging backend (`BENCHMARK_RESULTS_DIR`, `ML_RESULTS_DIR` in `render.yaml`) so the Results and
Dashboard pages show real results.

- `benchmark-results/benchmark-2026-11-13T23-48-22-308Z.json`: 60 real Electricity Maps forecast
  snapshots, 170 realized values (0.40 days), synthetic workloads. **Not statistically conclusive.**
- `ml-results/ml-2026-11-13T23-48-23-207Z.json`: status `insufficient-data`; **no model was trained.**

They contain aggregate statistics only (no user data, no keys, no raw provider responses). The raw
collection stays outside the repository (`../CarbonRoute-AS-data/em-collection`, see COLLECTOR.md).
Regenerate with `npm run benchmark` / `npm run ml` in `backend/` and copy the new files here.
