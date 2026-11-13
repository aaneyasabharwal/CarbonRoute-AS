# 🌿 CarbonRoute: Prototype Milestone

> **Uncertainty-Aware Batch Workload Scheduling Under Carbon Forecast Errors**  
> *Final-Year Capstone / Software Engineering Project (UCS503)*  
> **Course Supervisor:** Sukhpal Singh  
> **Research Team (TriFlux):** Yuvika Nagpal (1024030141), Kumkum Gupta (1024030144), Aaneya Sabharwal (1024030147)  
> **Current Milestone:** `PROTOTYPE MILESTONE (VERIFIED WORKING VERTICAL SLICE)`

---

## 🚀 Working Prototype Milestone (Software Vertical Slice)

The Prototype Milestone implements an integrated, verifiable end-to-end software vertical slice:

```
[Workload Submission] (duration, deadline, CPU/RAM, risk tolerance tau)
        │
        ▼
[Regional Carbon Forecast] (Electricity Maps API / Calibrated 24h ISO Traces)
        │
        ▼
[Deadline-Risk Check] (deterministic, or declared runtime variability; see docs/SCHEDULING_METHODOLOGY.md)
        │
        ▼
[5 Schedulers Evaluated] (Immediate, EDF, Deterministic, Baseline, CarbonRoute)
        │
        ▼
[CarbonRoute Decision Engine] (min E[Carbon(t)] subject to P(violation) <= tau)
        │
        ▼
[Kubernetes Connector & Fallback Runner] (batch/v1 Job manifest or local sandbox)
        │
        ▼
[Container Execution & Live Streaming Logs] (Progress epochs streamed to UI)
        │
        ▼
[Empirical Carbon Accounting & Dashboard] (Time-weighted observed intensity vs Immediate baseline; realized emissions only with recorded energy)
```

---

## 🌐 Public Website & Navigation Structure (11 Pages)

1. **Home (`/`):** Primary brand portal, active milestone banner, 3 CTAs (`Launch Prototype`, `Explore Project`, `Planning V1`), interactive 8-step pipeline visualizer, and verified milestone breakdown.
2. **Project Specification (`/project`):** Scientific problem formulation, research gap, 10 formal objectives, boundaries, and mathematical formulations.
3. **How It Works (`/how-it-works`):** Interactive 10-step lifecycle deep dive with governing mathematical equations and produced output artifacts.
4. **Architecture (`/architecture`):** 10-layer architectural stack from React Web UI through Carbon Services, Uncertainty Modeling, and Schedulers to Kubernetes dispatch.
5. **Interactive Prototype (`/prototype`):** Working vertical slice featuring preset workloads, custom parameter controls, live 24h carbon intensity chart with uncertainty envelopes, 5-policy comparative table, CarbonRoute decision card, Kubernetes manifest generator, live streaming terminal, and sensitivity experiments.
6. **Experiments & Benchmarks (`/experiments`):** 5-dimensional evaluation protocol (Grid Regions, Workload Classes, Scale, Error Levels, Seeds) and academic integrity notice.
7. **System Design (`/system-design`):** Formal software engineering UML models:
   - **4 Use Cases:** Workload Registration (UC-01), Carbon Ingestion (UC-02), Multi-Policy Decision (UC-03), Kubernetes Dispatch (UC-04).
   - **5 Sequence Diagrams:** End-to-End Vertical Slice (SQ-01), Uncertainty Calibration (SQ-02), Multi-Policy Benchmarking (SQ-03), Resilient Sandbox Fallback (SQ-04), Carbon Accounting (SQ-05).
   - **Detailed Class Diagram (UML):** Complete entity hierarchy, interfaces, value objects, and service contracts.
8. **Development Roadmap (`/roadmap`):** 17-week phased development tracking.
9. **Team TriFlux (`/team`):** Member bios, student roll numbers, and technical divisions.
10. **Resources & Deliverables (`/resources`):** Document repository for whitepapers, trace schemas, and architecture files.
11. **Planning V1 Archive (`/presentations/planning/v1`):** Archived official 25-slide presentation with in-browser PDF viewer.

---

## ⚡ 5 Scheduling Policies Implemented

| # | Policy Name | Classification | Strategy & Logic | Deadline Risk Handling |
|---|---|---|---|---|
| 1 | **Immediate Execution** | Naive Baseline | Dispatches immediately at arrival ($t=0$). | Risk = 0% (zero temporal delay). |
| 2 | **Earliest Deadline First (EDF)** | Classical Baseline | Prioritizes earliest deadline jobs; dispatches immediately if unconstrained. | Risk = 0% to minimal. |
| 3 | **Deterministic Carbon-Aware** | Heuristic Benchmark | Seeks the absolute lowest mean carbon intensity window, ignoring forecast error. | **High Risk** (often selects windows close to deadline, risking SLA breaches). |
| 4 | **CarbonAware Baseline** | Shifted Heuristic | Evaluates heuristic threshold shifting within safe window. | Moderate risk. |
| 5 | **CarbonRoute Uncertainty-Aware** | Proposed System | Solves $t^* = \arg\min \mathbb{E}[C(t)]$ subject to $P(\text{violation}(t)) \le \tau$. | **Guarded**: strictly bound by user risk tolerance $\tau$. |

---

## 🔌 Kubernetes Integration & Resilient Sandbox Runner

- **Kubernetes Batch Manifest:** Generates production `batch/v1` Job YAML specs with CPU/memory limits, restart policies, and carbon audit metadata labels.
- **Minikube Support:** If Minikube or Docker Kubernetes is running, CarbonRoute submits jobs directly to the `carbonroute-jobs` namespace.
- **Resilient Fallback Mode:** If no cluster is running, CarbonRoute detects offline status, sets `clusterMode = 'offline_fallback'`, and runs the workload via an isolated local subprocess sandbox runner (`docker/workload/workload.py`), streaming stdout progress epochs to the UI terminal without crashing.
- **Starting Minikube (Optional):**
  ```bash
  minikube start
  kubectl create namespace carbonroute-jobs
  ```

---

## 🌍 Real Carbon Data (Electricity Maps)

Live mode uses the Electricity Maps API v3 for 351 grid zones: real forecasts (6–72 h), the last 24 h of history (each value labelled **measured** or **provider estimate**), latest values and power breakdown. Set `ELECTRICITY_MAPS_API_KEY` in your local `.env` (git-ignored). Each scheduling decision stores the exact forecast snapshot it used. After the scheduled window, observations are collected and compared with the forecast (measured and estimated values reported separately), and a downloadable report is generated. Verified capabilities, limitations and endpoints: [docs/ELECTRICITY_MAPS.md](docs/ELECTRICITY_MAPS.md).

---

## 🧪 Automated Verification Test Suite

Run the backend test suite (Vitest, no build or running server needed; see [backend/test/README.md](backend/test/README.md)):

```bash
cd backend && npm test
```

Run the frontend test suite (Vitest + React Testing Library; see [frontend/test/README.md](frontend/test/README.md)):

```bash
cd frontend && npm test
```

Continuous integration ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs the backend and frontend typechecks, tests and builds on Node 20 for every pull request into `fix/prototype-flaws` or `main`, and on pushes to those branches and to `task/**` branches.

The original script below is kept until the ported tests are reviewed. It requires a built `backend/dist`:

```bash
node tests/prototype_vertical_slice_test.cjs
```

**Results (historical, before P1; the risk functions in Steps 2-3 were removed as invalid, see docs/SCHEDULING_METHODOLOGY.md):**
```
🧪 CarbonRoute: Prototype Milestone Vertical Slice Verification
  ✅ PASS: Step 1: Carbon forecast returns 24 calibrated hourly points with confidence bounds
  ✅ PASS: Step 2: Uncertainty sigma(t) monotonically expands across the 24h horizon
  ✅ PASS: Step 3: Chebyshev erfc correctly bounds deadline risk between 0 and 1
  ✅ PASS: Step 4: All 5 scheduling policies evaluated simultaneously with valid metrics
  ✅ PASS: Step 5: Same forecast with high vs conservative risk tolerance produces different decisions
  ✅ PASS: Step 6: Kubernetes batch/v1 manifest contains correct specs and metadata
  ✅ PASS: Step 7: Dispatch workload and stream progress logs to completion

🎯 Prototype Vertical Slice Test Results: 7 PASSED, 0 FAILED
```

---

## 🛠️ Local Development & Deployment

### Run Frontend
```bash
cd frontend
npm install
npm run dev      # Local dev at http://localhost:5173
npm run build    # Production Vite build
```

### Run Node.js / Express Backend
```bash
cd backend
npm install
npm run dev      # Local dev at http://localhost:5000
npm run build    # Compile TypeScript
npm start        # Production server
```

### Run Standalone Python FastAPI Service (Optional)
```bash
cd fastapi_service
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

---

## 👥 Team TriFlux (UCS503)

| Member | Roll Number | Focus Area |
|---|---|---|
| **Yuvika Nagpal** | 1024030141 | Grid Carbon Intensity Service & Workload Profiling |
| **Kumkum Gupta** | 1024030144 | 5-Policy Schedulers, Uncertainty & Tail Risk Modeling |
| **Aaneya Sabharwal** | 1024030147 | Backend Controllers, Kubernetes Connector & Prototype UI |
