# CarbonRoute Prototype Milestone: Viva & Demonstration Walkthrough (superseded)

> **Superseded (P6, November 2026).** This walkthrough describes the September prototype, including the removed deadline-risk model ("horizon uncertainty"), a local sandbox runner that does not run workloads, and a test script that has been retired. Use [DEMO.md](DEMO.md) for the current demonstration.

This document outlines the official script and presentation flow for demonstrating the **CarbonRoute Prototype Milestone** to your course supervisor and evaluation committee.

---

## 🎯 Key Academic Requirements Met

1. **Working Vertical Slice:** Complete end-to-end integration:
   `Job Submission -> Carbon Forecast -> Horizon Uncertainty -> 5 Schedulers -> CarbonRoute Decision -> Kubernetes Dispatch & Sandbox -> Live Container Logs -> Results Dashboard`.
2. **Academic & Tone Integrity:**
   - No fake claims or impossible guarantees.
   - Accurate framing: *"CarbonRoute estimates and calibrates deadline-violation risk to support SLA-aware scheduling."*
   - Transparent Data Mode badge (`LIVE` vs `DEMO`).
3. **Resilient Cluster Dispatch:**
   - Works immediately whether Kubernetes/Minikube is running or offline.
   - Live streaming terminal showing container progress epochs.
4. **Full Architectural & UML Alignment:**
   - 4 Use Case Diagrams (UC-01 to UC-04).
   - 5 Sequence Diagrams (SQ-01 to SQ-05).
   - 1 Detailed UML Class Diagram.

---

## 🧭 Live Demo Script (Step-by-Step)

### Phase 1: The Research Problem & Brand Elevation (Home Page)
1. Navigate to the website homepage (`/`).
2. Show the **"PROTOTYPE MILESTONE ACTIVE"** badge.
3. Highlight the 3 primary navigation actions:
   - **Launch Prototype** (Primary green CTA)
   - **Explore Project**
   - **Planning V1** (Preserved historical archive)
4. Scroll to the **Interactive 8-Step Pipeline Visualizer**:
   - Click through steps (Job Submission -> Carbon Forecast -> Horizon Uncertainty -> 5 Schedulers -> CarbonRoute Decision -> K8s Dispatch -> Live Execution -> Results Dashboard).
   - Explain how each stage passes strongly typed models into the next.
5. Point out the **"Prototype Milestone: What is Built vs Future Roadmap"** comparison table, demonstrating transparency.

---

### Phase 2: Complete Interactive Vertical Slice (`/prototype`)
1. Click **Prototype** in the top navbar (or click **Launch Prototype**).
2. **Workload Presets:**
   - Click one of the preloaded presets (e.g. **"LLM Fine-Tuning Batch"** or **"Database Backup Pipeline"**).
   - Notice how Duration (3h), Deadline (14h), Region (CAISO), Cores (8), and Risk Tolerance $\tau$ (5%) auto-populate.
3. **Carbon Intensity & Uncertainty Chart:**
   - Explain the 24-hour bar chart:
     - CAISO has a classic **solar duck-curve** (high morning/evening carbon, steep drop mid-day during hours 10–15).
     - Each bar displays both the predicted intensity and the **widening uncertainty whiskers** $\sigma(t)$.
     - Show the **"Data Mode: Local Demo Trace"** badge (or **"Live Electricity Maps"** if an API key is provided).
4. **Evaluate 5 Schedulers:**
   - Click **"Evaluate 5 Schedulers"**.
   - Review the side-by-side comparison table:
     1. **Immediate:** Dispatches at $t=0$ (310 gCO2/kWh, 0% savings, 0% risk).
     2. **EDF:** Dispatches immediately due to earliest deadline priority.
     3. **Deterministic Carbon-Aware:** Picks hour +12 with absolute lowest carbon (140 gCO2), but observe the **risk penalty** if slack is tight.
     4. **CarbonAware Baseline:** Evaluates heuristic threshold shifting.
     5. **CarbonRoute Uncertainty-Aware:** Picks the optimal green window (+10h, 170 gCO2/kWh) with risk $\le \tau$ (e.g. 7.7% $\le$ 8%).
   - Highlight the **Expected Carbon Savings**: e.g., **45.2% reduction vs Immediate!**
5. **Sensitivity Demonstration (Same Forecast, Different Risk Tolerance):**
   - Scroll down to the **"Same Forecast, Different Risk Tolerance"** interactive comparison:
     - Slide risk tolerance to **Conservative ($\tau = 1\%$)**: CarbonRoute schedules at $+9\text{h}$ with **0.19% risk** and **29% savings**.
     - Slide risk tolerance to **Aggressive ($\tau = 30\%$)**: CarbonRoute delays to $+10\text{h}$ with **7.74% risk** and **45.2% savings**.
     - This visually proves that CarbonRoute is genuinely uncertainty-aware and risk-calibrated!

---

### Phase 3: Real Kubernetes Dispatch & Container Execution
1. Click **"Dispatch to Execution Worker"**.
2. **Cluster Health & Fallback Badge:**
   - If Minikube is running: shows `Cluster: Active (Minikube)`.
   - If Minikube is offline: shows `Cluster: Offline Fallback (Local Sandbox Runner)`.
3. **Inspect Generated Kubernetes Job YAML:**
   - Click **"Inspect Generated Kubernetes batch/v1 Manifest"**.
   - Show the evaluator the production Kubernetes specification: `apiVersion: batch/v1`, `kind: Job`, resource limits (CPU/memory), and `carbonroute.io/*` audit labels.
4. **Watch Live Container Progress Epochs:**
   - Point to the live terminal window.
   - Observe real execution logs streaming in real-time:
     ```
     [CarbonRoute Dispatcher] Initiating job dispatch for test-job-001
     [Sandbox Pod] Container started.
     [Workload] Executing: python /app/workload.py --epochs 5
     [Epoch 1/5] Processing batch matrix tensors... (20% complete)
     [Epoch 2/5] Processing batch matrix tensors... (40% complete)
     ...
     [Epoch 5/5] Processing batch matrix tensors... (100% complete)
     [Workload] Execution finished cleanly with exit code 0.
     [CarbonRoute Accounting] Realized carbon: 175 gCO2eq/kWh.
     ```
5. **Results Dashboard & Empirical Carbon Accounting:**
   - Show the final completed telemetry cards:
     - Realized Carbon vs Immediate Baseline.
     - Actual Execution Duration (e.g., 6.2s).
     - True Empirical Savings % recorded in the benchmark database.

---

### Phase 4: Software Engineering & System Design (`/system-design`)
1. Click **System Design** in the top navbar.
2. **4 Use Case Diagrams:**
   - Click through UC-01 (Workload Registration), UC-02 (Carbon Ingestion), UC-03 (Multi-Policy Decision), UC-04 (Kubernetes Dispatch).
   - Show actors, triggers, preconditions, main flow steps, exceptions, and postconditions.
3. **5 Sequence Diagrams:**
   - Switch to the Sequence tab.
   - Walk through SQ-01 (End-to-End Vertical Slice Flow) and SQ-02 (Uncertainty Calibration Flow).
4. **UML Class Diagram:**
   - Switch to the Class Diagram tab.
   - Highlight the polymorphic `ISchedulerPolicy` interface and its 5 concrete implementations (`ImmediatePolicy`, `EDFPolicy`, `DeterministicPolicy`, `CarbonAwareBaseline`, `CarbonRoutePolicy`).
   - Highlight `UncertaintyModel`, `IK8sConnector`, and `K8sJobExecutionRecord`.

---

### Phase 5: Technical Architecture (`/architecture`) & How It Works (`/how-it-works`)
1. Open **How It Works (`/how-it-works`)**:
   - Step through the 10-stage lifecycle.
   - Highlight the mathematical formulations displayed for each step (horizon dispersion $\sigma(t)$, Chebyshev tail probability $\operatorname{erfc}$, and risk-constrained optimization $t^*$).
2. Open **Architecture (`/architecture`)**:
   - Inspect the 10-layer architectural stack.

---

### Phase 6: Codebase & Automated Test Execution
In the terminal, run the automated verification suite to prove code quality:

```bash
node tests/prototype_vertical_slice_test.cjs
```

Show the committee the **7/7 PASSED** test results validating all components.
