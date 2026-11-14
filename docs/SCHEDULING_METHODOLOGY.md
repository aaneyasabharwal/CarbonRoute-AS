# CarbonRoute Scheduling Methodology (implemented formulation)

This document describes what the code in `backend/src/services/schedulerService.ts`,
`uncertaintyService.ts`, `energyModel.ts` and `evaluation/oracle.ts` actually does
(engine version `carbonroute-engine-2026-11-p1`). Earlier versions of this document described a
deadline-risk model that used the carbon forecast's standard deviation as a time uncertainty;
that model was dimensionally invalid (audit C1) and was removed in P1.

## 1. Inputs

- One batch job: duration $d$ (whole hours), arrival slot $a$, absolute deadline $D$ (converted to
  hours after the forecast start), requested vCPUs, risk tolerance $\tau \in (0,1)$, and an optional
  **declared** runtime coefficient of variation $cv \in [0, 1]$.
- One forecast snapshot $\hat{C}(0), \dots, \hat{C}(H-1)$ in gCO2eq/kWh, hourly, from Electricity Maps
  (real) or the built-in synthetic demo trace (labelled `synthetic`). The snapshot is stored with the
  decision so it can be replayed.

## 2. Candidate windows

A window starting at slot $t$ covers slots $t, \dots, t+d-1$ and has forecast intensity
$$\bar{C}(t) = \frac{1}{d}\sum_{h=t}^{t+d-1} \hat{C}(h).$$

Candidates are $t \in [a, \min(H, \lfloor D \rfloor) - d]$:

- windows never wrap past the end of the forecast;
- a window containing a missing forecast value is `REJECTED_DATA_GAP` (nothing is filled in);
- the deadline is never moved: if no start slot exists the result is `NO_FEASIBLE_WINDOW`.

Ranking uses the exact $\bar{C}(t)$; values are rounded only for display (2 decimals).

## 3. Deadline risk (runtime only)

Carbon forecast uncertainty changes how much CO2 a window emits, not whether the job finishes on
time, so it is not part of the deadline risk. The runtime is modelled as
$R \sim \mathcal{N}(d, (cv \cdot d)^2)$, giving
$$P_{\text{miss}}(t) = P(t + R > D) = 1 - \Phi\!\left(\frac{D - t - d}{cv \cdot d}\right).$$

- **Exact instants (P8).** $D$ is the exact deadline in hours after the forecast start (fractional,
  not rounded to a slot), and $t$ is the window's **actual** start: the arrival instant for a window in
  the arrival slot, otherwise the slot start. Before P8 the deadline was floored to a whole hour (a
  window ending 32 min before the deadline was treated as having no slack) and the arrival slot was
  measured from the start of its hour (an immediate start looked up to an hour safer than it was).
  Regression tests: `backend/test/scheduling/exactInstants.test.ts`. Benchmark replays use whole hours
  and are unaffected.
- $cv = 0$ (the default): deterministic, $P_{\text{miss}} = 0$ if $t + d \le D$, otherwise 1.
- $cv$ is **declared by the user**; it is not learned. Empirical runtime distributions need recorded
  executions (roadmap M9.1). Start delays are not modelled.
- $\Phi$ is computed with the Numerical Recipes `erfc` approximation (fractional error < 1.2e-7).

A window is **feasible** when it has no data gap and $P_{\text{miss}}(t) \le \tau$.

## 4. Policies (all on the same snapshot and candidates)

| Policy | Rule | Notes |
|---|---|---|
| Immediate | $t = a$ | Reference baseline |
| EDF | $t = a$ | Identical to Immediate for a single job; reported with `equivalentTo: immediate`. EDF only differs when several jobs compete (queue mode, not implemented). |
| Deterministic carbon-aware (Greedy) | $\arg\min \bar{C}(t)$ over gap-free candidates | Ignores deadline risk; may be infeasible |
| CarbonAware baseline | Earliest gap-free candidate starting by $\lfloor D\rfloor - d - b$ with $\bar{C}(t) \le$ the 25th percentile of those candidates, else their minimum; buffer $b = \max(1, \min(3, \mathrm{round}(0.25 \cdot \text{slack})))$ | Conventional heuristic; the threshold uses only the windows it may choose (M3.11) |
| **CarbonRoute (risk-constrained)** | $\arg\min \bar{C}(t)$ over **feasible** candidates, ties to the earliest | If no candidate is feasible the decision is `INFEASIBLE_RISK` with no recommendation (there is no "safety fallback") |
| Cost-aware | — | **Unavailable**: no electricity-price provider is configured (dependency D7) |
| Oracle (hindsight) | $\arg\min$ realized intensity over candidates | **Offline evaluation only** (`evaluation/oracle.ts`, `GET /api/jobs/:id/oracle`). Needs realized observations covering every candidate; otherwise unavailable. Never used to schedule. |

## 5. Energy and emissions

Energy is an **assumption**: $P = \max(0.1, 0.125 \cdot \text{vCPU})$ kW and $E = P \cdot d$ kWh
(`energyModel.ts`, shared by the engine and the workflow). Estimated emissions = $\bar{C}(t) \cdot E$
and are always labelled "assumed energy". Realized emissions are only reported when a measured energy
value exists. Savings versus Immediate are $(\bar{C}_{\text{imm}} - \bar{C}_{\text{rec}}) / \bar{C}_{\text{imm}}$.

## 6. After execution

Observations for the scheduled and Immediate windows are collected from the provider (never
invented) and compared with the forecast using time-weighted averages over the exact window
(`evaluation/timeWeighting.ts`, `forecastEvaluation.ts`). Forecast-error metrics (MAE, RMSE, bias)
are computed only over intervals that have both a forecast and an observation.

## 7. Known limitations

- Hourly start slots and whole-hour durations only.
- Single-job scheduling; no capacity reservations or queues.
- Deadline risk depends on a declared runtime CV, not on measured runtimes.
- No calibrated carbon-forecast uncertainty: Electricity Maps forecasts carry none, and the synthetic
  trace's σ is synthetic. Calibration needs held-out forecast-versus-realized data (roadmap M9.2).
