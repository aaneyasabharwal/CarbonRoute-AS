# CarbonRoute: Prototype Milestone Vertical Slice Implementation Specification

> **Superseded (P1, November 2026).** The deadline-risk model described below (forecast σ divided by 100 used as a time uncertainty, horizon dispersion, uncertainty multiplier) was dimensionally invalid (audit C1) and has been removed, as have the wrap-around and fill-in behaviours. The implemented formulation is in [SCHEDULING_METHODOLOGY.md](SCHEDULING_METHODOLOGY.md). The test output below is historical and is not produced by the current code. The current documentation is listed in the README (P6).

**Team:** TriFlux  
**Course:** UCS503 Final-Year Project  
**System Version:** 1.0.0 (Prototype Vertical Slice)  
**Verification Date:** September 2026  

---

## Table of Contents
1. [Exact Mathematical Formulation](#1-exact-mathematical-formulation)
2. [Why Uncertainty Matters: Concrete Numerical Example](#2-why-uncertainty-matters-concrete-numerical-example)
3. [The 5 Evaluated Scheduling Policies](#3-the-5-evaluated-scheduling-policies)
4. [Carbon Forecast Ingestion: Live API vs Calibrated Demo Traces](#4-carbon-forecast-ingestion-live-api-vs-calibrated-demo-traces)
5. [Mathematical Tail-Risk Formulation](#5-mathematical-tail-risk-formulation)
6. [Workload Container Simulation & 5-Epoch Lifecycle](#6-workload-container-simulation--5-epoch-lifecycle)
7. [Realized Carbon Accounting & Error Calculation](#7-realized-carbon-accounting--error-calculation)
8. [Kubernetes Manifest Mapping (batch/v1 Job)](#8-kubernetes-manifest-mapping-batchv1-job)
9. [Resilient Execution Architecture: Minikube vs Local Sandbox](#9-resilient-execution-architecture-minikube-vs-local-sandbox)
10. [Local Execution Instructions](#10-local-execution-instructions)
11. [Automated Test Suite Verification](#11-automated-test-suite-verification)
12. [Empirical Sensitivity Matrix](#12-empirical-sensitivity-matrix)
13. [Academic Limitations & Roadmap to Final Submission](#13-academic-limitations--roadmap-to-final-submission)

---

## 1. Exact Mathematical Formulation

CarbonRoute solves a **chance-constrained stochastic discrete optimization problem** for flexible batch workloads.

Given:
- A batch job arriving at arrival time $t_{\text{arr}}$ (normalized to $t=0$)
- Required continuous execution duration $\Delta t \in \mathbb{N}^+$ (hours)
- Maximum allowable completion deadline $D \in \mathbb{N}^+$ (hours)
- Upper-bound deadline violation risk tolerance $\tau \in (0, 1)$ (e.g., $\tau = 0.05$ for a 5% SLA risk threshold)
- Forecasted carbon intensity profile $\hat{I}(t)$ for lookahead horizon hours $t \in [0, H-1]$
- Horizon-dependent forecast variance $\sigma_{\text{carbon}}^2(t)$

The optimization objective minimizes expected carbon emissions over the job's execution duration subject to hard deadline and risk constraints:

$$\min_{t \in \mathcal{T}_{\text{cand}}} \bar{I}(t, \Delta t) = \frac{1}{\Delta t} \sum_{h=t}^{t+\Delta t - 1} \hat{I}(h)$$

Subject to:
1. **Completion Deadline Constraint:**
   $$t + \Delta t \le D$$
2. **Chance Constraint on Deadline Violation:**
   $$P(\text{violation} \mid t, \Delta t, D, \sigma) \le \tau$$
3. **Earliest Arrival Time:**
   $$t \ge t_{\text{arr}}$$

Where $\mathcal{T}_{\text{cand}} = \{ t \in \mathbb{N} \mid 0 \le t \le D - \Delta t \text{ and } P(\text{violation} \mid t) \le \tau \}$.

If no candidate window satisfies $P(\text{violation}) \le \tau$, CarbonRoute falls back to the window that minimizes violation risk:
$$t^* = \arg\min_{t \in \{0, \dots, D-\Delta t\}} P(\text{violation} \mid t)$$

---

## 2. Why Uncertainty Matters: Concrete Numerical Example

Deterministic carbon schedulers optimize solely against point forecasts $\hat{I}(t)$, ignoring variance growth over time. This leads to severe SLA violations when scheduling distant windows.

### Concrete Scenario:
- **Workload:** ML model training requiring $\Delta t = 2$ hours, submitted at $t=0$, with deadline $D = 12$ hours.
- **Risk Tolerance:** $\tau = 0.05$ (maximum 5% probability of missing the deadline).
- **Carbon Profile:** Solar duck curve with evening peak ($320\text{ gCO}_2/\text{kWh}$ at $t=0$) and deep solar trough ($160\text{ gCO}_2/\text{kWh}$ between $t=8$ and $t=10$).

### Decision Under Low Forecast Uncertainty ($\sigma_{\text{time}} = 0.8\text{ hours}$ at $t=8$):
- Start at $t=8$, finishes at $t=10$.
- Temporal slack: $S = 12 - (8 + 2) = 2.0\text{ hours}$.
- Normalized deviation: $z = \frac{S}{\sigma} = \frac{2.0}{0.8} = 2.5$.
- Tail violation risk: $P(\text{violation}) = 0.5 \cdot \text{erfc}(2.5 / \sqrt{2}) \approx 0.0062$ (0.62%).
- **Decision:** $0.62\% \le 5\%$ risk limit $\implies$ **Delay to $t=8$ is accepted**. Carbon savings: **50%**.

### Decision Under High Forecast Uncertainty ($\sigma_{\text{time}} = 2.5\text{ hours}$ at $t=8$):
- Start at $t=8$, finishes at $t=10$.
- Temporal slack remains identical: $S = 2.0\text{ hours}$.
- Normalized deviation: $z = \frac{S}{\sigma} = \frac{2.0}{2.5} = 0.80$.
- Tail violation risk: $P(\text{violation}) = 0.5 \cdot \text{erfc}(0.80 / \sqrt{2}) \approx 0.2119$ (21.19%).
- **Deterministic Scheduler:** Still chooses $t=8$ because it only sees $160\text{ gCO}_2/\text{kWh}$, suffering an unacceptable 21.2% risk of missing the deadline.
- **CarbonRoute Scheduler:** Rejects $t=8$ because $21.19\% > 5\%$. It shifts execution to an earlier window (e.g. $t=2$ or $t=4$) where $\sigma_{\text{time}}$ is smaller, guaranteeing $P(\text{violation}) \le 5\%$.

**Takeaway:** Identical point forecasts produce different optimal scheduling decisions when uncertainty is taken into account.

---

## 3. The 5 Evaluated Scheduling Policies

CarbonRoute evaluates five distinct scheduling policies on every incoming workload:

| Policy ID | Policy Name | Mathematical Selection Rule | Description |
|---|---|---|---|
| `immediate` | Immediate Execution | $t = 0$ | Standard FIFO baseline. Dispatches immediately upon submission regardless of grid conditions. |
| `edf` | Earliest Deadline First (EDF) | $t = 0$ (single-node) | Classic real-time scheduling policy prioritizing workloads with closest deadline. In batch queues, dispatches immediately if capacity exists. |
| `deterministic_carbon` | Deterministic Carbon-Aware | $t^* = \arg\min_{t \le D - \Delta t} \bar{I}(t, \Delta t)$ | Greedily chooses the candidate window with the absolute lowest forecast carbon intensity, completely ignoring forecast variance and deadline risk. |
| `carbonaware_baseline` | CarbonAware Baseline | $t^* = \min \{ t \le D - \Delta t \mid \bar{I}(t, \Delta t) \le I_{\text{threshold}} \}$ | Heuristic threshold policy (e.g. shifting workload if current carbon is above the daily 25th percentile threshold). |
| `carbonroute_uncertainty` | **CarbonRoute (Proposed)** | $t^* = \arg\min_{t \in \mathcal{T}_{\text{cand}}} \bar{I}(t, \Delta t)$ subject to $P(\text{violation} \mid t) \le \tau$ | **Uncertainty-aware policy:** Finds the lowest carbon window that provably respects the user's deadline risk tolerance $\tau$. |

---

## 4. Carbon Forecast Ingestion: Live API vs Calibrated Demo Traces

CarbonRoute provides a clean provider interface (`ICarbonDataProvider` in `carbonService.ts`):

```typescript
export interface ICarbonDataProvider {
  getForecast(region: string, horizonHours: number): Promise<CarbonForecastData>;
  isLive(): boolean;
}
```

### Modes of Operation:
1. **Live Mode (`dataMode: 'live'`):**
   - Active when an `ELECTRICITY_MAPS_API_KEY` is present in the server environment.
   - Queries the official Electricity Maps REST API (`https://api.electricitymap.org/v3/carbon-intensity/forecast`).
   - Extracts real-time hourly forecasts and empirical prediction intervals.
2. **Demo Trace Mode (`dataMode: 'demo'`):**
   - Active if no API key is configured or when running offline.
   - Serves calibrated 24-hour profiles grounded in historical regional grid characteristics:
     - **CAISO (`US-CAL-CISO`):** California solar duck-curve with steep midday drops (150–190 gCO2/kWh) and evening thermal ramp-ups (320–340 gCO2/kWh).
     - **ERCOT (`US-TEX-ERCO`):** Texas overnight wind surges with low nocturnal intensity.
     - **DE (`DE`):** Germany mixed wind and solar profile.
     - **IN-NO (`IN-NO`):** Northern India high thermal baseload with midday solar mitigation.
   - Monotonically increasing horizon dispersion:
     $$\sigma_{\text{carbon}}(t) = \sigma_{\text{base}} + 0.5 \cdot \sqrt{t}$$

Every API response explicitly reports `dataMode: 'live' | 'demo'` to guarantee complete academic transparency.

---

## 5. Mathematical Tail-Risk Formulation

To prevent dimensional inconsistency between time (hours) and carbon intensity (gCO2eq/kWh), CarbonRoute derives completion variance in the **time domain** ($\sigma_{\text{completion}}$ in hours):

$$\sigma_{\text{completion}} = \max\left(0.25, \left( \sigma_{\text{runtime}} + \sigma_{\text{horizon}} \right) \times \text{multiplier}\right)$$

Where:
- $\sigma_{\text{runtime}} = 0.15 \times \Delta t$ (runtime execution variability, e.g. stragglers and I/O wait)
- $\sigma_{\text{horizon}} = \frac{\sigma_{\text{carbon}}(t)}{100} \sqrt{t}$ (temporal uncertainty growth over scheduling lookahead horizon $t$)

### Temporal Slack:
For a candidate start time $t$, expected completion is $t_{\text{finish}} = t + \Delta t$. The temporal slack before deadline $D$ is:
$$S(t) = D - (t + \Delta t)$$

- If $S(t) < 0 \implies \text{Job cannot complete before deadline} \implies P(\text{violation}) = 1.0$.
- If $S(t) \ge 0$, normalized deviation (Z-score) is:
  $$z = \frac{S(t)}{\sigma_{\text{completion}}}$$

### Chebyshev Rational Approximation for erfc:
Under Gaussian completion time distribution $\mathcal{N}(t+\Delta t, \sigma_{\text{completion}}^2)$, the upper-tail probability of completing after deadline $D$ is:
$$P(\text{completion} > D) = \Phi(-z) = \frac{1}{2} \operatorname{erfc}\left(\frac{z}{\sqrt{2}}\right)$$

We implement the Chebyshev rational polynomial approximation for $\operatorname{erfc}(x)$ accurate to $1.2 \times 10^{-7}$ across all $x \ge 0$:
$$\operatorname{erfc}(x) \approx t \cdot \exp\left( -x^2 + \sum_{k=0}^{9} c_k t^k \right), \quad t = \frac{1}{1 + 0.5 x}$$

This guarantees smooth, bounded, and deterministic tail probability estimates across all inputs.

---

## 6. Workload Container Simulation & 5-Epoch Lifecycle

When a workload is dispatched, CarbonRoute's `dispatchJob` connector initiates container execution. To provide clear observable feedback, the workload progresses through 5 deterministic computation epochs:

```
[CarbonRoute Dispatcher] Initiating job dispatch for job-base-case
[Sandbox Pod] Container started in namespace carbonroute-jobs.
[Workload] Executing command: python /app/workload.py --epochs 5
[Epoch 1/5] Processing batch tensor computations... (20% complete)
[Epoch 2/5] Processing batch tensor computations... (40% complete)
[Epoch 3/5] Processing batch tensor computations... (60% complete)
[Epoch 4/5] Processing batch tensor computations... (80% complete)
[Epoch 5/5] Processing batch tensor computations... (100% complete)
[Workload] Batch completed cleanly with exit code 0.
[CarbonRoute Accounting] Realized carbon: 286 gCO2eq/kWh.
```

Each epoch simulates 20% of the active compute workload, exercising the container process, capturing stdout/stderr, and updating execution state from `scheduled` $\to$ `running` $\to$ `completed`.

---

## 7. Realized Carbon Accounting & Error Calculation

Upon workload completion, CarbonRoute queries the realized carbon intensity at the actual start hour:

$$I_{\text{realized}} = I_{\text{forecast}}(t^*) + \epsilon, \quad \epsilon \sim \mathcal{N}(0, \sigma_{\text{carbon}}^2(t^*))$$

CarbonRoute computes and logs the forecast carbon error:

$$\text{CarbonError} = I_{\text{realized}} - I_{\text{predicted}}$$

- **Negative Error ($\text{CarbonError} < 0$):** Realized grid was cleaner than predicted.
- **Positive Error ($\text{CarbonError} > 0$):** Realized grid was more carbon-intensive than predicted.

Both predicted and realized figures are displayed side-by-side in the web UI and recorded in the audit trail.

---

## 8. Kubernetes Manifest Mapping (batch/v1 Job)

`K8sConnector.generateJobManifest(job, scheduledHour)` converts workload parameters directly into standard Kubernetes specifications:

| User Input Field | Kubernetes Manifest Location | Example Transformed Value |
|---|---|---|
| Workload Name | `metadata.name` | `carbonroute-job-base-case` |
| Container Image / Command | `spec.template.spec.containers[0].image` & `command` | `carbonroute/test-workload:latest` or `['sh', '-c', ...]` |
| CPU Cores | `resources.requests.cpu` & `resources.limits.cpu` | `"2"` |
| Memory (MB) | `resources.requests.memory` & `resources.limits.memory` | `"1024Mi"` |
| Job ID | Label: `carbonroute.io/job-id` & Env: `CARBONROUTE_JOB_ID` | `job-base-case` |
| Scheduled Hour | Label: `carbonroute.io/scheduled-hour` | `T+2` |
| Restart Policy | `spec.template.spec.restartPolicy` | `Never` |

The generated manifest can be inspected in the web UI via the **"Inspect K8s Manifest"** modal and copied directly to run with `kubectl apply -f manifest.yaml`.

---

## 9. Resilient Execution Architecture: Minikube vs Local Sandbox

CarbonRoute incorporates resilient cluster autodetection:
1. Probes cluster via `kubectl cluster-info --request-timeout=1s`.
2. **Minikube Live Mode:** If cluster responds, creates the namespace `carbonroute-jobs`, applies the manifest via `kubectl apply`, and streams pod logs via `kubectl logs -f`.
3. **Local Sandbox Fallback:** If Kubernetes is offline (e.g. during local developer evaluation or CI/CD pipelines), CarbonRoute automatically switches to the sandboxed runner. It spawns the containerized task in an isolated local runner, streams epoch logs, tracks runtime duration, and records realized carbon without throwing connection exceptions.
4. **Notice Badge:** The execution UI displays `clusterMode: 'offline_fallback'` or `'minikube'` and explains the runtime environment.

---

## 10. Local Execution Instructions

### Prerequisites:
- Node.js v18+ and npm
- (Optional) Minikube or local Kubernetes cluster
- (Optional) Electricity Maps API key

### Steps:
```bash
# 1. Clone repository
git clone https://github.com/yuvika-nagpal/CarbonRoute.git
cd CarbonRoute

# 2. Build backend
cd backend
npm install
npm run build
npm start &

# 3. Build & start frontend
cd ../frontend
npm install
npm run build
npm run preview
```
Visit `http://localhost:4173/prototype` in your browser.

---

## 11. Automated Test Suite Verification

To run the complete automated test suite validating all vertical slice stages:

```bash
node tests/prototype_vertical_slice_test.cjs
```

### Expected Output:
```
🧪 ========================================================
🧪 CarbonRoute: Prototype Milestone Vertical Slice Verification
🧪 ========================================================
      Verified 6 top-level function exports successfully.
  ✅ PASS: Exports: Top-level function exports exist and are callable
  ✅ PASS: Step 1: Carbon forecast returns 24 calibrated hourly points with confidence bounds
  ✅ PASS: Step 2: Uncertainty sigma(t) monotonically expands across the 24h horizon
  ✅ PASS: Step 3: Chebyshev erfc correctly bounds deadline risk between 0 and 1
  ✅ PASS: Test A: Base Case (2h runtime, 12h deadline, 5% risk) executes complete vertical slice
  ✅ PASS: Test B: Same forecast with different uncertainty shifts decision conservatively
  ✅ PASS: Test C: Workload runtime sensitivity (2h vs 6h) shrinks feasible set and computes continuous window averages
  ✅ PASS: Test D: Deadline sensitivity (12h vs 8h) shrinks candidate set and elevates tail risk
  ✅ PASS: Test E: Risk tolerance sensitivity dynamically adjusts acceptable window set

========================================================
🎯 Prototype Vertical Slice Test Results: 9 PASSED, 0 FAILED
========================================================
```

---

## 12. Empirical Sensitivity Matrix

The following table summarizes the dynamic sensitivity test outcomes produced by the automated test suite:

| Test ID | Test Description | Input Parameter Variation | Resulting Behavior | Dynamic Adaptation |
|---|---|---|---|---|
| **Test A** | Base Case | $\Delta t=2\text{h}, D=12\text{h}, \tau=5\%$ | Immediate: $303\text{ gCO}_2$, CarbonRoute: $283\text{ gCO}_2$ | Dispatches at $T+2$ with $0.00\%$ risk, achieving $6.6\%$ carbon reduction. |
| **Test B** | Same Forecast, Different Uncertainty | Baseline $\sigma$ vs $2.4\times \sigma$ | Distant window risk increases from $18.1\%$ to $36.4\%$ | Optimal window remains conservative to guarantee $P(\text{violation}) \le \tau$. |
| **Test C** | Workload Duration Sensitivity | $\Delta t = 2\text{h}$ vs $\Delta t = 6\text{h}$ ($D=12\text{h}$) | Max start shifts from $T+10$ down to $T+6$; 6h avg at $T+0 = 297\text{ gCO}_2$ | $6\text{h}$ job selects $T+0$ to avoid late-window deadline breach. |
| **Test D** | Deadline Tightening | $D = 12\text{h}$ vs $D = 8\text{h}$ ($\Delta t=2\text{h}$) | Slack at $T+6$ drops from $4\text{h}$ to $0\text{h}$; risk jumps from $0\%$ to $50\%$ | Limits candidate slots to $T \le 6$, preventing deadline overflow. |
| **Test E** | Risk Tolerance Sensitivity | $\tau = 1\%$ (strict) vs $\tau = 20\%$ (relaxed) | Strict selects $T+2$ ($283\text{ gCO}_2$, $0\%$ risk); Relaxed selects $T+8$ ($250\text{ gCO}_2$, $10.6\%$ risk) | Relaxed tolerance admits deeper green window, saving an extra $33\text{ gCO}_2/\text{kWh}$. |

---

## 13. Academic Limitations & Roadmap to Final Submission

### Current Prototype Limitations:
1. **Uncertainty Calibration:** Uncertainty variance is currently parameterized via regional historical standard deviations and square-root horizon expansion, rather than full ensemble weather forecasting or Brier-calibrated conformal prediction.
2. **Workload Model:** Workloads are modeled as non-preemptible, single-node batch tasks. Preemption, checkpoint-restart, and distributed multi-node gang scheduling are deferred to Milestone 2.
3. **Cluster Dispatch:** Kubernetes integration submits individual batch `Jobs`. Multi-cluster scheduling across geographically distributed regions is simulated via regional trace routing.

### Roadmap to Final Submission:
- **Milestone 2 (Weeks 3–6):** Discrete-event simulator core for 10,000+ synthetic job benchmark traces.
- **Milestone 3 (Weeks 7–10):** Empirical conformal prediction intervals and Brier score calibration on real historical Electricity Maps feeds.
- **Milestone 4 (Weeks 11–14):** Multi-region workload shifting across CAISO, ERCOT, and Germany with transmission losses and pricing co-optimization.
- **Milestone 5 (Weeks 15–16):** Final empirical thesis report and reproducible benchmark repository.
