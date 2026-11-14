import React, { useState } from 'react';
import {
  Network,
  Layers,
  GitBranch,
  Cpu,
  ArrowRight,
  Shield,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  Play,
  Terminal,
  Activity,
  Zap,
  Server,
  Cloud,
  Box,
} from 'lucide-react';

export const SystemDesignPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'use-cases' | 'sequences' | 'class-diagram'>('use-cases');
  const [selectedUseCase, setSelectedUseCase] = useState<number>(0);
  const [selectedSequence, setSelectedSequence] = useState<number>(0);

  // 4 Use Cases
  const useCases = [
    {
      id: 'UC-01',
      title: 'Workload Registration & Constraint Validation',
      actor: 'ML Engineer / Batch Client',
      goal: 'Submit synthetic or trace-derived batch workload with strict runtime, memory, deadline, and risk constraints.',
      preconditions: 'Client has authenticated; API gateway is accessible.',
      trigger: 'POST /api/jobs or web scheduler preset invocation',
      mainFlow: [
        'Client submits job payload { name, durationHours, deadlineHours, riskTolerance, region, cpuCores, memoryGb }.',
        'API Controller parses parameters and invokes Validator.',
        'System verifies runtime constraint feasibility: deadline >= submission + duration.',
        'System verifies risk tolerance threshold tau in (0.01, 0.50].',
        'Generates UUID v4 and registers workload entity with state PENDING.',
        'Emits WorkloadRegistered event and returns 201 Created with initial state.',
      ],
      exceptions: [
        'E1: Deadline < Duration -> Rejection with 422 Unprocessable Entity (Infeasible deadline).',
        'E2: Invalid zone/region identifier -> Fallback to default CAISO (US-CAL-CISO).',
      ],
      postconditions: 'Workload is queued in in-memory state repository ready for carbon scheduling evaluation.',
    },
    {
      id: 'UC-02',
      title: 'Horizon-Dependent Carbon & Uncertainty Forecasting',
      actor: 'CarbonRoute Scheduler Core / Grid Signal Provider',
      goal: 'Acquire 24-hour regional grid carbon intensity signal with calibrated forecast error growth over time.',
      preconditions: 'Target ISO/RTO regional grid zone identified (e.g., CAISO, ERCOT, Germany, Northern India).',
      trigger: 'Scheduler requests intensity profile for scheduling window [t_now, t_now + 24h].',
      mainFlow: [
        'CarbonService queries Electricity Maps API endpoint /v3/carbon-intensity/forecast.',
        'If the API key is missing or the quota is exceeded, the request fails with a clear error (no silent synthetic substitute).',
        'Extracts hourly forecast points: I_forecast(t) in gCO2eq/kWh.',
        'UncertaintyService applies horizon error scaling: sigma(t) = sigma_0 * (1 + beta * (t - t_0)^gamma).',
        'Computes 95% confidence intervals [mu(t) - 1.96*sigma(t), mu(t) + 1.96*sigma(t)].',
        'Returns calibrated forecast envelope { dataMode, points: [HourlyCarbonPoint] } to Decision Engine.',
      ],
      exceptions: [
        'E1: Grid API rate-limit/timeout -> error returned (QUOTA_GUARD / provider error); the user may switch to demo mode, labelled synthetic.',
      ],
      postconditions: '24-hour mean carbon forecast and hourly uncertainty standard deviation matrix available in memory.',
    },
    {
      id: 'UC-03',
      title: 'Multi-Policy Benchmarking & Risk-Aware Decision',
      actor: 'CarbonRoute Decision Engine',
      goal: 'Evaluate 5 competing scheduling policies side-by-side and select optimal execution slot adhering to risk constraint.',
      preconditions: 'Feasible WorkloadJob registered and 24h forecast envelope loaded.',
      trigger: 'POST /api/schedule with jobId and policy options.',
      mainFlow: [
        'SchedulerService instantiates 5 policy evaluators: Immediate, EDF, Deterministic Carbon, CarbonAware Baseline, CarbonRoute.',
        'Evaluates Immediate: start at t=0, compute cumulative emissions, risk = 0%.',
        'Evaluates EDF: start as soon as scheduled, prioritize earliest deadline, compute emissions.',
        'Evaluates Deterministic: search for slot with lowest mean carbon intensity, ignoring uncertainty.',
        'Evaluates CarbonAware Baseline: evaluate heuristic threshold window savings.',
        'Evaluates CarbonRoute: optimize start slot t* = argmin E[Carbon(t)] subject to P(violation) <= tau.',
        'Calculates comparative carbon savings percentage relative to Immediate baseline.',
        'Emits SchedulingDecision with selected optimal slot, trade-off matrix, and mathematical risk proof.',
      ],
      exceptions: [
        'E1: Zero slack available (deadline = duration) -> All policies converge to immediate dispatch with risk = 0%.',
      ],
      postconditions: 'Optimal start slot selected; decision record logged with complete comparative telemetry.',
    },
    {
      id: 'UC-04',
      title: 'Kubernetes Job Dispatch, Sandbox Execution & Telemetry',
      actor: 'K8s Connector / Execution Worker Sandbox',
      goal: 'Translate scheduling decision into container execution, stream live logs, and collect empirical carbon accounting.',
      preconditions: 'Job reaches scheduled start time t* and dispatch is triggered.',
      trigger: 'POST /api/jobs/:id/dispatch',
      mainFlow: [
        'K8sConnector renders Kubernetes batch/v1 Job specification with resource limits and environment variables.',
        'Probes Kubernetes cluster connection via client / kubectl.',
        'If cluster is online: dispatches Job to carbonroute-jobs namespace in Minikube/K8s.',
        'If cluster is offline: gracefully falls back to local isolated process sandbox runner.',
        'Streams container execution epochs: [Epoch 1/5], [Epoch 2/5] ... to live log buffer.',
        'Tracks actual execution duration and computes realized carbon emissions.',
        'Calculates true empirical savings vs Immediate baseline and updates job state to COMPLETED.',
        'Emits execution metrics to Results Dashboard.',
      ],
      exceptions: [
        'E1: Cluster unavailable -> Explicitly sets clusterMode = "offline_fallback" and executes via local runner without failure.',
      ],
      postconditions: 'Execution recorded (Kubernetes or simulated); forecast vs observed intensity available after collection.',
    },
  ];

  // 5 Sequence Diagrams
  const sequences = [
    {
      id: 'SQ-01',
      title: 'End-to-End Scheduling Flow',
      description: 'Complete lifecycle from user submission through carbon forecast, multi-policy evaluation, Kubernetes dispatch, to live log results.',
      steps: [
        { from: 'User / Web UI', to: 'API Controller', label: '1. POST /api/jobs (Submit Workload params)', type: 'req' },
        { from: 'API Controller', to: 'CarbonService', label: '2. fetchForecast(region, horizon=24h)', type: 'req' },
        { from: 'CarbonService', to: 'ElectricityMaps / Trace', label: '3. Query Live Grid / Fallback Calibrated Trace', type: 'req' },
        { from: 'ElectricityMaps / Trace', to: 'CarbonService', label: '4. Raw Forecast Array I(t)', type: 'res' },
        { from: 'CarbonService', to: 'UncertaintyService', label: '5. calibrateUncertainty(I(t), horizon)', type: 'req' },
        { from: 'UncertaintyService', to: 'API Controller', label: '6. Calibrated Forecast + Sigma(t) Envelope', type: 'res' },
        { from: 'API Controller', to: 'SchedulerService', label: '7. evaluateAllPolicies(job, forecastEnvelope)', type: 'req' },
        { from: 'SchedulerService', to: 'API Controller', label: '8. 5-Policy Comparison + CarbonRoute Decision', type: 'res' },
        { from: 'API Controller', to: 'User / Web UI', label: '9. Render Forecast Bar Chart + Policy Comparison Table', type: 'res' },
        { from: 'User / Web UI', to: 'API Controller', label: '10. POST /api/jobs/:id/dispatch (Trigger Execution)', type: 'req' },
        { from: 'API Controller', to: 'K8sConnector', label: '11. dispatchJob(jobSpec, decision)', type: 'req' },
        { from: 'K8sConnector', to: 'K8s Cluster / Sandbox', label: '12. Execute Workload Pod & Stream Epoch Logs', type: 'req' },
        { from: 'K8s Cluster / Sandbox', to: 'K8sConnector', label: '13. Final Exit Code 0 + Realized Duration', type: 'res' },
        { from: 'K8sConnector', to: 'API Controller', label: '14. Execution Record + Realized Carbon Accounting', type: 'res' },
        { from: 'API Controller', to: 'User / Web UI', label: '15. Render Real-Time Terminal Logs & Final Results', type: 'res' },
      ],
    },
    {
      id: 'SQ-02',
      title: 'Horizon Uncertainty Calibration & Risk Modeling',
      description: 'How uncertainty standard deviation grows with forecast horizon and how deadline violation probability is computed.',
      steps: [
        { from: 'SchedulerService', to: 'UncertaintyService', label: '1. Request uncertainty model for region', type: 'req' },
        { from: 'UncertaintyService', to: 'UncertaintyService', label: '2. Compute sigma(t) = sigma_0 * (1 + beta * (t - t_0)^gamma)', type: 'internal' },
        { from: 'UncertaintyService', to: 'UncertaintyService', label: '3. Calculate 95% Confidence Bounds: mu +/- 1.96*sigma', type: 'internal' },
        { from: 'SchedulerService', to: 'UncertaintyService', label: '4. computeRisk(startSlot, duration, deadline, sigma)', type: 'req' },
        { from: 'UncertaintyService', to: 'UncertaintyService', label: '5. P(violation) = 0.5 * erfc(Slack / (sqrt(2) * sigma_eff))', type: 'internal' },
        { from: 'UncertaintyService', to: 'SchedulerService', label: '6. Return Risk Probability P(violation) in [0, 1]', type: 'res' },
      ],
    },
    {
      id: 'SQ-03',
      title: 'Multi-Policy Competitive Evaluation Sequence',
      description: 'Parallel computation of Immediate, EDF, Deterministic, CarbonAware Baseline, and CarbonRoute policies.',
      steps: [
        { from: 'SchedulerService', to: 'ImmediatePolicy', label: '1. evaluate(job): start=0, emissions=E[C(0)], risk=0', type: 'req' },
        { from: 'ImmediatePolicy', to: 'SchedulerService', label: '2. Immediate Result Record', type: 'res' },
        { from: 'SchedulerService', to: 'EDFPolicy', label: '3. evaluate(job): prioritize deadline urgency', type: 'req' },
        { from: 'EDFPolicy', to: 'SchedulerService', label: '4. EDF Result Record', type: 'res' },
        { from: 'SchedulerService', to: 'DeterministicPolicy', label: '5. evaluate(job): min sum(I_mean(t)), risk ignored', type: 'req' },
        { from: 'DeterministicPolicy', to: 'SchedulerService', label: '6. Deterministic Result Record (Risk may be high!)', type: 'res' },
        { from: 'SchedulerService', to: 'CarbonAwareBaseline', label: '7. evaluate(job): heuristic threshold shift', type: 'req' },
        { from: 'CarbonAwareBaseline', to: 'SchedulerService', label: '8. Baseline Result Record', type: 'res' },
        { from: 'SchedulerService', to: 'CarbonRoutePolicy', label: '9. evaluate(job): min E[C(t)] s.t. Risk <= tau', type: 'req' },
        { from: 'CarbonRoutePolicy', to: 'SchedulerService', label: '10. Optimal Feasible Decision + Savings %', type: 'res' },
      ],
    },
    {
      id: 'SQ-04',
      title: 'Kubernetes Dispatch & Resilient Sandbox Fallback',
      description: 'Connector checks for Minikube/Docker cluster; falls back cleanly to local sandbox if cluster is offline.',
      steps: [
        { from: 'API Controller', to: 'K8sConnector', label: '1. dispatch(jobRecord, decision)', type: 'req' },
        { from: 'K8sConnector', to: 'K8sConnector', label: '2. probeCluster(): check kubectl / API socket', type: 'internal' },
        { from: 'K8sConnector', to: 'K8sConnector', label: '3. Cluster Offline detected -> fallback mode', type: 'internal' },
        { from: 'K8sConnector', to: 'LocalSandboxRunner', label: '4. spawnLocalProcess(docker/workload/workload.py)', type: 'req' },
        { from: 'LocalSandboxRunner', to: 'K8sConnector', label: '5. Stream stdout: [Epoch 1/5] Running batch...', type: 'stream' },
        { from: 'LocalSandboxRunner', to: 'K8sConnector', label: '6. Stream stdout: [Epoch 5/5] Workload Complete', type: 'stream' },
        { from: 'LocalSandboxRunner', to: 'K8sConnector', label: '7. Process exit code: 0', type: 'res' },
        { from: 'K8sConnector', to: 'API Controller', label: '8. Final Execution Record (mode: offline_fallback)', type: 'res' },
      ],
    },
    {
      id: 'SQ-05',
      title: 'Telemetry Collection & Carbon Accounting',
      description: 'Calculation of realized vs baseline emissions and dashboard metric updates.',
      steps: [
        { from: 'K8sConnector', to: 'API Controller', label: '1. Emit completion event with durationSec', type: 'req' },
        { from: 'API Controller', to: 'API Controller', label: '2. Compute Realized Carbon = sum(I_actual * kWh)', type: 'internal' },
        { from: 'API Controller', to: 'API Controller', label: '3. Compute Savings % = (Baseline - Realized) / Baseline', type: 'internal' },
        { from: 'API Controller', to: 'ExperimentStore', label: '4. Persist run to experiments benchmark log', type: 'req' },
        { from: 'ExperimentStore', to: 'API Controller', label: '5. Acknowledged', type: 'res' },
        { from: 'API Controller', to: 'Web UI', label: '6. Push results to UI Dashboard', type: 'res' },
      ],
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      {/* Header */}
      <div className="space-y-3 pb-6 border-b border-slate-800">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
          <Network className="w-3.5 h-3.5" />
          <span>Formal Software Engineering Specification</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-mono">
          System Design &amp; Architectural Modeling
        </h1>
        <p className="text-sm text-slate-400 max-w-4xl leading-relaxed">
          UML design specifications for the CarbonRoute vertical slice. Includes 4 Use Case models, 5 Sequence execution flows, and a complete Object-Oriented Class Model representing all core entities, schedulers, and connector interfaces.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center space-x-2 border-b border-slate-800 pb-3 font-mono text-xs overflow-x-auto">
        <button
          onClick={() => setActiveTab('use-cases')}
          className={`px-4 py-2 rounded-lg font-bold transition-all flex items-center space-x-2 shrink-0 ${
            activeTab === 'use-cases'
              ? 'bg-emerald-500 text-slate-950 shadow-sm'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>4 Use Case Models</span>
        </button>
        <button
          onClick={() => setActiveTab('sequences')}
          className={`px-4 py-2 rounded-lg font-bold transition-all flex items-center space-x-2 shrink-0 ${
            activeTab === 'sequences'
              ? 'bg-emerald-500 text-slate-950 shadow-sm'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <GitBranch className="w-3.5 h-3.5" />
          <span>5 Sequence Diagrams</span>
        </button>
        <button
          onClick={() => setActiveTab('class-diagram')}
          className={`px-4 py-2 rounded-lg font-bold transition-all flex items-center space-x-2 shrink-0 ${
            activeTab === 'class-diagram'
              ? 'bg-emerald-500 text-slate-950 shadow-sm'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>Detailed Class Diagram (UML)</span>
        </button>
      </div>

      {/* TAB 1: 4 USE CASES */}
      {activeTab === 'use-cases' && (
        <div className="space-y-8">
          {/* Sub Navigation for Use Cases */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {useCases.map((uc, idx) => (
              <button
                key={uc.id}
                onClick={() => setSelectedUseCase(idx)}
                className={`p-4 rounded-xl text-left border transition-all ${
                  selectedUseCase === idx
                    ? 'bg-emerald-500/15 border-emerald-500/50 shadow-sm ring-1 ring-emerald-500/30'
                    : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                  <span className={`font-bold ${selectedUseCase === idx ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {uc.id}
                  </span>
                  <span className="text-slate-500 font-normal">Use Case</span>
                </div>
                <h4 className="text-xs font-bold text-white leading-snug">{uc.title}</h4>
              </button>
            ))}
          </div>

          {/* Active Use Case Detail Card */}
          {(() => {
            const uc = useCases[selectedUseCase];
            return (
              <div className="glass-card rounded-2xl p-6 sm:p-8 border border-slate-800 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-800">
                  <div>
                    <span className="text-xs font-mono font-bold text-emerald-400">{uc.id} Specification</span>
                    <h2 className="text-2xl font-bold text-white font-mono">{uc.title}</h2>
                  </div>
                  <div className="flex items-center space-x-2 text-xs font-mono">
                    <span className="px-2.5 py-1 rounded bg-slate-900 text-slate-300 border border-slate-800">
                      Primary Actor: <strong className="text-emerald-400">{uc.actor}</strong>
                    </span>
                  </div>
                </div>

                {/* Grid Metadata */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1">
                    <span className="font-mono text-[10px] text-slate-400 uppercase font-bold">Goal</span>
                    <p className="text-slate-200 leading-relaxed">{uc.goal}</p>
                  </div>
                  <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1">
                    <span className="font-mono text-[10px] text-slate-400 uppercase font-bold">Preconditions</span>
                    <p className="text-slate-200 leading-relaxed">{uc.preconditions}</p>
                  </div>
                  <div className="p-3.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1">
                    <span className="font-mono text-[10px] text-slate-400 uppercase font-bold">Trigger</span>
                    <p className="text-slate-200 font-mono text-[11px] leading-relaxed">{uc.trigger}</p>
                  </div>
                </div>

                {/* Main Success Scenario */}
                <div className="space-y-3">
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400">
                    Main Success Scenario (Flow of Events)
                  </h3>
                  <div className="space-y-2">
                    {uc.mainFlow.map((step, idx) => (
                      <div
                        key={idx}
                        className="flex items-start space-x-3 p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs"
                      >
                        <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center font-mono font-bold text-[10px] shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <p className="text-slate-200 leading-relaxed font-sans">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Exceptions & Postconditions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                  <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
                    <span className="font-mono text-xs font-bold text-amber-400 flex items-center space-x-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Exceptions &amp; Edge Cases</span>
                    </span>
                    <ul className="space-y-1.5 text-xs text-slate-300">
                      {uc.exceptions.map((ex, i) => (
                        <li key={i} className="font-mono text-[11px] text-amber-300/90 leading-relaxed">
                          &bull; {ex}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2">
                    <span className="font-mono text-xs font-bold text-emerald-400 flex items-center space-x-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Postconditions</span>
                    </span>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {uc.postconditions}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* TAB 2: 5 SEQUENCE DIAGRAMS */}
      {activeTab === 'sequences' && (
        <div className="space-y-8">
          {/* Sub Navigation for Sequence Diagrams */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
            {sequences.map((seq, idx) => (
              <button
                key={seq.id}
                onClick={() => setSelectedSequence(idx)}
                className={`p-3.5 rounded-xl text-left border transition-all ${
                  selectedSequence === idx
                    ? 'bg-emerald-500/15 border-emerald-500/50 shadow-sm ring-1 ring-emerald-500/30'
                    : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                  <span className={`font-bold ${selectedSequence === idx ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {seq.id}
                  </span>
                  <span className="text-slate-500">Flow</span>
                </div>
                <h4 className="text-xs font-bold text-white leading-snug line-clamp-2">{seq.title}</h4>
              </button>
            ))}
          </div>

          {/* Active Sequence Visualizer */}
          {(() => {
            const seq = sequences[selectedSequence];
            return (
              <div className="glass-card rounded-2xl p-6 sm:p-8 border border-slate-800 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-800">
                  <div>
                    <span className="text-xs font-mono font-bold text-emerald-400">{seq.id} Execution Sequence</span>
                    <h2 className="text-2xl font-bold text-white font-mono">{seq.title}</h2>
                    <p className="text-xs text-slate-400 mt-1 max-w-3xl">{seq.description}</p>
                  </div>
                  <span className="text-xs font-mono text-slate-400 px-3 py-1 rounded bg-slate-900 border border-slate-800 shrink-0">
                    {seq.steps.length} Synchronous &amp; Async Steps
                  </span>
                </div>

                {/* Visual Sequence Timeline */}
                <div className="space-y-2 font-mono text-xs">
                  {seq.steps.map((step, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-2 hover:border-emerald-500/40 transition-colors"
                    >
                      <div className="flex items-center space-x-3">
                        <span className="w-6 h-6 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold text-[11px] shrink-0">
                          {idx + 1}
                        </span>
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-0.5 rounded bg-slate-900 text-sky-300 border border-slate-800 font-bold text-[11px]">
                            {step.from}
                          </span>
                          <ArrowRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="px-2 py-0.5 rounded bg-slate-900 text-emerald-300 border border-slate-800 font-bold text-[11px]">
                            {step.to}
                          </span>
                        </div>
                      </div>

                      <div className="pl-9 md:pl-0 flex items-center space-x-2">
                        <span className="text-slate-200 text-xs font-sans font-medium">{step.label}</span>
                        <span
                          className={`text-[9px] uppercase px-1.5 py-0.5 rounded border ${
                            step.type === 'req'
                              ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                              : step.type === 'res'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : step.type === 'stream'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                              : 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                          }`}
                        >
                          {step.type}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* TAB 3: CLASS DIAGRAM (UML) */}
      {activeTab === 'class-diagram' && (
        <div className="space-y-8">
          <div className="glass-card rounded-2xl p-6 sm:p-8 border border-slate-800 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-800">
              <div>
                <span className="text-xs font-mono font-bold text-emerald-400">Object-Oriented Domain Model</span>
                <h2 className="text-2xl font-bold text-white font-mono">CarbonRoute Core Class Hierarchy</h2>
                <p className="text-xs text-slate-400 mt-1 max-w-3xl">
                  UML structural schema demonstrating domain models, scheduler policy polymorphism, probability models, and execution connector abstractions.
                </p>
              </div>
              <span className="text-xs font-mono text-emerald-400 px-3 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 shrink-0">
                TypeScript / Python Pydantic Alignment
              </span>
            </div>

            {/* UML Architecture Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Class 1: WorkloadJob */}
              <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden text-xs font-mono">
                <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <Box className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-bold text-white">WorkloadJob</span>
                  </div>
                  <span className="text-[10px] text-slate-500">&laquo;Entity&raquo;</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="space-y-1 text-slate-300">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Attributes</div>
                    <div>+ id: string (UUIDv4)</div>
                    <div>+ name: string</div>
                    <div>+ durationHours: number</div>
                    <div>+ deadlineHours: number</div>
                    <div>+ riskTolerance: number [0..1]</div>
                    <div>+ region: GridZone</div>
                    <div>+ cpuCores: number</div>
                    <div>+ memoryGb: number</div>
                    <div>+ status: JobStatus</div>
                    <div>+ submittedAt: Date</div>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 space-y-1 text-emerald-300">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Methods</div>
                    <div>+ validateConstraints(): boolean</div>
                    <div>+ calculateSlack(currentTime): number</div>
                    <div>+ toKubernetesJobSpec(): object</div>
                  </div>
                </div>
              </div>

              {/* Class 2: CarbonForecast & UncertaintyModel */}
              <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden text-xs font-mono">
                <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <Activity className="w-3.5 h-3.5 text-sky-400" />
                    <span className="font-bold text-white">UncertaintyModel</span>
                  </div>
                  <span className="text-[10px] text-slate-500">&laquo;Service&raquo;</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="space-y-1 text-slate-300">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Attributes</div>
                    <div>+ baseStdDev: number (sigma_0)</div>
                    <div>+ horizonGrowthBeta: number</div>
                    <div>+ horizonGrowthGamma: number</div>
                    <div>+ confidenceZ: number = 1.96</div>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 space-y-1 text-sky-300">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Methods</div>
                    <div>+ computeStdDev(horizonHours): number</div>
                    <div>+ computeBounds(mu, sigma): [low, high]</div>
                    <div>+ computeDeadlineRisk(slack, sigma): number</div>
                    <div>+ erfcChebyshev(x): number</div>
                  </div>
                </div>
              </div>

              {/* Class 3: ISchedulerPolicy (Interface) */}
              <div className="rounded-xl bg-slate-950 border border-emerald-500/40 overflow-hidden text-xs font-mono shadow-sm">
                <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <Zap className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-bold text-white">ISchedulerPolicy</span>
                  </div>
                  <span className="text-[10px] text-emerald-400 font-bold">&laquo;Interface&raquo;</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="space-y-1 text-slate-300">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Properties</div>
                    <div>+ policyId: string</div>
                    <div>+ policyName: string</div>
                    <div>+ isRiskAware: boolean</div>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 space-y-1 text-emerald-300">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Contract</div>
                    <div>+ evaluate(job, forecast, uncertainty): PolicyResult</div>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Implementations</div>
                    <div className="grid grid-cols-2 gap-1 text-[10px]">
                      <span className="text-slate-300">&bull; ImmediatePolicy</span>
                      <span className="text-slate-300">&bull; EDFPolicy</span>
                      <span className="text-slate-300">&bull; DeterministicPolicy</span>
                      <span className="text-slate-300">&bull; CarbonAwareBaseline</span>
                      <span className="text-emerald-400 font-bold col-span-2">&bull; CarbonRoutePolicy</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Class 4: SchedulingDecision */}
              <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden text-xs font-mono">
                <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <FileCode className="w-3.5 h-3.5 text-purple-400" />
                    <span className="font-bold text-white">SchedulingDecision</span>
                  </div>
                  <span className="text-[10px] text-slate-500">&laquo;ValueObject&raquo;</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="space-y-1 text-slate-300">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Attributes</div>
                    <div>+ decisionId: string</div>
                    <div>+ jobId: string</div>
                    <div>+ selectedPolicy: string</div>
                    <div>+ recommendedStartTime: Date</div>
                    <div>+ delayHours: number</div>
                    <div>+ expectedEmissionsGrams: number</div>
                    <div>+ deadlineViolationRisk: number</div>
                    <div>+ carbonSavingsPercent: number</div>
                    <div>+ evaluatedPolicies: PolicyResult[]</div>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 space-y-1 text-purple-300">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Methods</div>
                    <div>+ isSLACompliant(tau): boolean</div>
                    <div>+ getAlternative(policyId): PolicyResult</div>
                  </div>
                </div>
              </div>

              {/* Class 5: IK8sConnector */}
              <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden text-xs font-mono">
                <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <Server className="w-3.5 h-3.5 text-amber-400" />
                    <span className="font-bold text-white">IK8sConnector</span>
                  </div>
                  <span className="text-[10px] text-amber-400 font-bold">&laquo;Interface&raquo;</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="space-y-1 text-slate-300">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Attributes</div>
                    <div>+ clusterMode: "minikube" | "offline_fallback"</div>
                    <div>+ namespace: string</div>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 space-y-1 text-amber-300">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Contract</div>
                    <div>+ probeClusterStatus(): Promise&lt;ClusterStatus&gt;</div>
                    <div>+ dispatchJob(jobSpec): Promise&lt;ExecutionRecord&gt;</div>
                    <div>+ streamLogs(jobId, callback): void</div>
                    <div>+ terminateJob(jobId): Promise&lt;boolean&gt;</div>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 text-[11px] text-slate-400">
                    <div className="text-[10px] text-slate-500 uppercase font-bold mb-1">Implementations</div>
                    <div className="space-y-0.5 text-[10px]">
                      <div className="text-slate-300">&bull; KubernetesClusterConnector (Minikube)</div>
                      <div className="text-amber-400">&bull; LocalSandboxConnector (Offline Fallback)</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Class 6: K8sJobExecutionRecord */}
              <div className="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden text-xs font-mono">
                <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center space-x-1.5">
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-bold text-white">ExecutionRecord</span>
                  </div>
                  <span className="text-[10px] text-slate-500">&laquo;Entity&raquo;</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="space-y-1 text-slate-300">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Attributes</div>
                    <div>+ executionId: string</div>
                    <div>+ jobId: string</div>
                    <div>+ k8sJobName: string</div>
                    <div>+ podStatus: "Pending" | "Running" | "Succeeded"</div>
                    <div>+ actualDurationSec: number</div>
                    <div>+ realizedEmissionsGrams: number</div>
                    <div>+ baselineEmissionsGrams: number</div>
                    <div>+ trueSavingsPercent: number</div>
                    <div>+ logOutput: string[]</div>
                  </div>
                  <div className="pt-2 border-t border-slate-800/80 space-y-1 text-emerald-300">
                    <div className="text-[10px] text-slate-500 uppercase font-bold">Methods</div>
                    <div>+ computeRealizedEmissions(): number</div>
                    <div>+ appendLogLine(line: string): void</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
