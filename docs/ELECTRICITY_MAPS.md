# Electricity Maps integration

CarbonRoute uses the [Electricity Maps API v3](https://api.electricitymaps.com/v3) as its primary source of real carbon-intensity data.

## Configuration

Set the key in the environment variable `ELECTRICITY_MAPS_API_KEY`, for example in the repository-root `.env` file (git-ignored):

```
ELECTRICITY_MAPS_API_KEY=<your key>
```

The key is sent only in the `auth-token` request header. It is never logged, stored, returned by the API or included in error messages, and tests never use it. Without a key, live endpoints return HTTP 503 with code `NO_API_KEY`; nothing falls back silently to demo data. `GET /api/carbon/provider` reports whether a key is configured (without revealing it).

## Verified capabilities (14-day trial key, 2026-11-12)

Checked with real API calls, not taken from documentation:

| Endpoint | Available | Notes |
|---|---|---|
| `carbon-intensity/latest` | Yes | Hourly, 15-minute, 5-minute; `lifecycle` (default) or `direct` emission factors; zone or latitude/longitude |
| `carbon-intensity/history` | Yes | **Last 24 hours only**; 60/15/5-minute; every point has `isEstimated` and `estimationMethod` |
| `carbon-intensity/forecast` | Yes | Horizons **6, 24, 48, 72 h only** (168 rejected); 60/15/5-minute; points have no uncertainty; `updatedAt` is the issue time; the first point is the current, already-started interval |
| `carbon-intensity/past`, `/past-range` | **No** | "This endpoint is not included in your API trial" |
| `power-breakdown/latest` | Yes | Generation mix, renewable and fossil-free percentages |
| `zones` | Yes | 351 zones in 222 countries; with a key, each zone lists the signals the key can access (`access`) |

All 351 zones list `carbon-intensity/latest`, `/history` and `/forecast` access; none list `carbon-intensity/past-range`.

### Measured values vs provider estimates

In the 24-hour history, values are either measurements (`isEstimated: false`) or Electricity Maps' own estimates (`isEstimated: true`, with an `estimationMethod`). On 2026-11-12:

| Zone | Last 24 h |
|---|---|
| US-CAL-CISO | all measured |
| DE | measured except the most recent ~6 h (estimated, `FORECASTS_HIERARCHY`) |
| GB, IN, IN-NO, IN-SO | all estimated (`TIME_SLICER_AVERAGE`) |

CarbonRoute never labels an estimate as measured. A history point without an explicit `isEstimated: false` is treated as an estimate.

## How CarbonRoute uses the data

- **Forecasts** are stored as snapshots: exact points, issue time (`updatedAt`), fetch time, horizon, granularity, emission-factor type, endpoint and the SHA-256 of the raw response. Scheduling uses the smallest supported horizon that covers the deadline (at most 72 h).
- **No uncertainty is invented.** Electricity Maps forecasts carry none, so live deadline risk is deterministic: a window either finishes before the deadline or it does not (`riskModel: deterministic-no-uncertainty-data`). The synthetic demo trace keeps its labelled synthetic uncertainty model.
- **Observations** are collected from `/history` after the scheduled window has ended, and only within 24 hours of its start (the plan has no `past-range`). Statuses: `COMPLETE`, `PARTIAL`, `PENDING_WINDOW_NOT_FINISHED`, `UNAVAILABLE_WINDOW_MISSED`, `UNAVAILABLE_PROVIDER_ERROR`, `NOT_APPLICABLE_SYNTHETIC`. Missing intervals are listed, never filled in.
- **Forecast error** (forecast − observed, gCO2eq/kWh) is computed only for intervals with both values, and reported separately for measured observations and for provider estimates (the latter is model-vs-model agreement, not error against a measurement).
- **Time zones**: all timestamps are UTC. Each zone carries an IANA time zone from a curated mapping (`backend/src/carbon/zoneTimezones.ts`) for display; zones spanning several time zones or not mapped have `timezone: null` and are shown in UTC.

## Reliability

- 10 s timeout per request; up to 2 retries with exponential backoff for network errors and HTTP 5xx.
- HTTP 429: waits for `Retry-After` when it is 10 s or less, otherwise fails with `RATE_LIMITED` (API status 429). Response headers showed a limit of 2,400 requests; the period is not stated.
- In-memory cache: zones 24 h, other data 5 min. Errors are not cached.
- Errors: `UNSUPPORTED_ZONE` and `INVALID_PARAMETER` → 422; `RATE_LIMITED` → 429; `NO_API_KEY`, `UNAUTHORIZED`, `NOT_IN_PLAN`, `TIMEOUT`, `NETWORK`, `UPSTREAM_ERROR`, `BAD_RESPONSE` → 503.
- Responses are validated: UTC timestamps, sorted, no conflicting duplicates, no gaps or irregular steps, non-negative numeric values.

## API endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/carbon/regions` | Live: zones the key can access (with capabilities and time zone). `?mode=demo`: synthetic demo profiles |
| `GET /api/carbon/forecast?region=&horizon=&mode=` | Hourly forecast used by the scheduler |
| `GET /api/carbon/forecast/snapshot?zone=&horizon=&granularity=` | Raw forecast snapshot (6/24/48/72 h; `5_minutes`, `15_minutes`, `hourly`) |
| `GET /api/carbon/latest?zone=` | Latest value, labelled measured or provider estimate |
| `GET /api/carbon/history?zone=&granularity=` | Last 24 h, each point labelled |
| `GET /api/carbon/power-breakdown?zone=` | Latest generation mix |
| `GET /api/carbon/provider` | Provider configuration and verified limits (no secrets) |
| `POST /api/schedule` | Schedule a job (`jobData.deadlineAt` ISO UTC); returns all policies, the recommendation or `INFEASIBLE`, and stores the snapshot and decision |
| `POST /api/jobs/:id/dispatch` | Execute (Kubernetes) or simulate the job; records the scheduled window |
| `POST /api/jobs/:id/observations` | Collect observations for the scheduled window |
| `GET /api/jobs/:id/report` | Report as JSON, or `?format=html` as a downloadable file |

## Limitations

- The trial key expires after 14 days; after that live endpoints return errors until the licence is renewed.
- Without `past-range`, observations older than 24 hours cannot be retrieved.
- Energy use is an assumption (0.125 kW per requested vCPU, minimum 0.1 kW), so all emissions figures are estimates.
- Without a Kubernetes cluster, execution is simulated (no workload is run); carbon is accounted for the scheduled window.
- The scheduler works at hourly resolution; 15- and 5-minute data are available through the forecast/history endpoints but not yet used for scheduling.
