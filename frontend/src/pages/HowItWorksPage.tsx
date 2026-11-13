import React, { useState } from 'react';
import {
  Play,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Layers,
  Activity,
  Shield,
  Zap,
  Server,
  Terminal,
  TrendingDown,
  BarChart3,
  GitBranch,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';

export const HowItWorksPage: React.FC = () => {
  const [activeStep, setActiveStep] = useState<number>(0);

  const steps = [
    {
      step: '01',
      title: 'Workload Registration & Profiling',
      subtitle: 'Declaring execution constraints and SLA boundaries',
      icon: Cpu,
      badge: 'Input Phase',
      color: 'text-emerald-400',
      description:
        'Batch workloads arrive with specific operational requirements: estimated runtime duration Delta_t, hard completion deadline D, target grid region, compute resources (cores/memory), and risk tolerance threshold tau.',
      math: '\\text{Constraint: } D \\ge t_{\\text{now}} + \\Delta t \\quad \\text{and} \\quad \\tau \\in (0.01, 0.50]',
      details: [
        'Clients declare duration, deadline, CPU cores, and memory footprint.',
        'The scheduler verifies feasibility: if slack S = D - (t + Delta_t) < 0, the job is immediately rejected as infeasible.',
        'Workload state is initialized as PENDING with a unique UUID v4 identifier.',
      ],
      output: 'Validated Workload Spec with non-negative initial slack.',
    },
    {
      step: '02',
      title: 'Carbon Grid Signal Ingestion',
      subtitle: 'Querying live forecasts, or the labelled synthetic demo trace',
      icon: Activity,
      badge: 'Grid Ingestion',
      color: 'text-sky-400',
      description:
        'The scheduler queries regional grid carbon intensity forecasts I(t) across a 24-hour horizon. Real forecasts come from the Electricity Maps REST API. Synthetic hourly profiles (CAISO, ERCOT, Germany, Northern India) are used only in explicit demo mode and are labelled synthetic.',
      math: 'I_{\\text{forecast}}(t) \\in [g\\text{CO}_2\\text{eq}/\\text{kWh}], \\quad t \\in [t_0, t_0 + 24\\text{h}]',
      details: [
        'Connects to live Electricity Maps API with zone identifier (e.g. US-CAL-CISO).',
        'A missing API key or provider failure is reported as an error; nothing is silently replaced by synthetic data.',
        'Extracts hourly carbon intensity points and establishes the temporal intensity envelope.',
      ],
      output: '24-hour hourly carbon intensity time-series vector.',
    },
    {
      step: '03',
      title: 'Forecast Uncertainty (not part of deadline risk)',
      subtitle: 'Why carbon-forecast error does not enter the deadline risk',
      icon: GitBranch,
      badge: 'Uncertainty Modeling',
      color: 'text-purple-400',
      description:
        'Carbon-forecast error changes how much CO2 a window emits, not whether the job finishes on time. An earlier version used the forecast standard deviation as a time uncertainty; that was dimensionally invalid and was removed.',
      math: '\\bar{C}(t) = \\frac{1}{d}\\sum_{h=t}^{t+d-1} \\hat{C}(h)',
      details: [
        'Electricity Maps forecasts carry no uncertainty; the demo trace band is synthetic.',
        'Forecast error is measured after the fact (MAE, RMSE, bias by lead time) on collected data.',
        'A forecast-error correction model exists but is not trained yet: insufficient data.',
      ],
      output: 'Mean forecast intensity of every candidate window.',
    },
    {
      step: '04',
      title: 'Feasibility & Slack Window Analysis',
      subtitle: 'Computing valid dispatch intervals before deadline expiration',
      icon: Layers,
      badge: 'Temporal Constraints',
      color: 'text-amber-400',
      description:
        'Before testing any scheduling slot t_start, the scheduler calculates remaining slack. If dispatching at t_start would prevent completion before deadline D, that slot is eliminated from the candidate set.',
      math: 'S(t_{\\text{start}}) = D - (t_{\\text{start}} + \\Delta t) \\ge 0',
      details: [
        'Candidate start slots are bounded: t_start in [t_now, D - Delta_t].',
        'As t_start approaches the latest possible start time, available slack drops to zero.',
        'Slots beyond the deadline boundary are marked infeasible with violation probability 1.0 (100%).',
      ],
      output: 'Set of temporally feasible candidate dispatch slots.',
    },
    {
      step: '05',
      title: 'Tail Probability Deadline Violation Risk',
      subtitle: 'Estimating SLA failure probability under forecast and runtime variance',
      icon: Shield,
      badge: 'Risk Quantification',
      color: 'text-rose-400',
      description:
        'The runtime is modelled as normal with the declared coefficient of variation cv. With cv = 0 (the default) the risk is 0 or 1.',
      math: 'P_{\\text{miss}}(t) = 1 - \\Phi\\left(\\frac{D - t - d}{cv \\cdot d}\\right)',
      details: [
        'cv is declared by the user, not learned from recorded runtimes.',
        'When slack is large relative to cv * d, the risk approaches 0.',
        'With zero slack the risk is 50%; start delays are not modelled.',
      ],
      output: 'Model-based deadline-miss risk for every candidate slot (not empirically calibrated).',
    },
    {
      step: '06',
      title: 'Multi-Policy Competitive Benchmarking',
      subtitle: 'Evaluating 5 scheduling algorithms on the exact same workload',
      icon: BarChart3,
      badge: 'Comparative Evaluation',
      color: 'text-emerald-400',
      description:
        'CarbonRoute does not evaluate its algorithm in isolation. For every job, it evaluates 5 distinct policies simultaneously: Immediate Dispatch, Earliest Deadline First (EDF), Deterministic Carbon-Aware, CarbonAware Baseline, and CarbonRoute.',
      math: '\\text{Policies: } \\{\\text{Immediate}, \\text{EDF}, \\text{Deterministic}, \\text{Baseline}, \\text{CarbonRoute}\\}',
      details: [
        'Immediate: dispatches at t=0 (0% savings, 0% risk baseline).',
        'EDF: dispatches immediately or based on earliest deadline.',
        'Deterministic Carbon: picks the lowest forecast window and ignores deadline risk.',
        'CarbonAware Baseline: applies simple heuristic shifting.',
        'CarbonRoute: balances emissions reduction with hard risk threshold.',
      ],
      output: 'Comprehensive 5-way comparative performance matrix.',
    },
    {
      step: '07',
      title: 'Risk-Constrained Optimization Decision',
      subtitle: 'Selecting the optimal dispatch slot adhering to risk budget',
      icon: Zap,
      badge: 'Decision Engine',
      color: 'text-cyan-400',
      description:
        'CarbonRoute selects the optimal dispatch hour t* that minimizes expected emissions E[Carbon(t)] strictly subject to the condition that deadline breach risk does not exceed the user tolerance tau.',
      math: 't^* = \\arg\\min_{t \\in \\mathcal{T}_{\\text{feasible}}} \\mathbb{E}[C(t)] \\quad \\text{subject to } P(\\text{violation}(t)) \\le \\tau',
      details: [
        'If the lowest-carbon window has risk > tau, CarbonRoute picks the lowest-carbon window within tau; if none exists the result is INFEASIBLE_RISK (no fallback).',
        'Calculates projected percentage carbon savings vs. Immediate baseline.',
        'Generates formal scheduling decision record with full mathematical audit trail.',
      ],
      output: 'Recommended start slot t* (or an explicit infeasible result) with its explanation.',
    },
    {
      step: '08',
      title: 'Kubernetes Job Spec Generation',
      subtitle: 'Translating scheduling decision into production batch/v1 manifest',
      icon: Server,
      badge: 'Container Orchestration',
      color: 'text-blue-400',
      description:
        'When the user dispatches the job, the K8s Connector generates a complete Kubernetes batch/v1 Job YAML with container image, resource limits, carbon metadata labels, and environment parameters.',
      math: '\\text{apiVersion: batch/v1, kind: Job, spec: \\{ backoffLimit: 2, restartPolicy: Never \\}}',
      details: [
        'Configures container image (e.g. ghcr.io/carbonroute/workload-synthetic:latest).',
        'Applies CPU and memory limits based on user job specifications.',
        'Injects JOB_ID, EPOCHS, and TARGET_ZONE environment variables.',
        'Assigns metadata annotations for carbon auditability.',
      ],
      output: 'Valid Kubernetes Job specification manifest.',
    },
    {
      step: '09',
      title: 'Execution Dispatch & Sandbox Fallback',
      subtitle: 'Kubernetes submission when a cluster is reachable, otherwise simulated',
      icon: Terminal,
      badge: 'Execution Layer',
      color: 'text-emerald-400',
      description:
        'The connector probes cluster readiness. If Minikube or Kubernetes is reachable, the manifest is submitted to the cluster. If the cluster is offline, CarbonRoute cleanly falls back to an isolated local sandbox process, streaming real container logs without crashing.',
      math: '\\text{Cluster Status: Active (Minikube)} \\iff \\text{Offline Fallback (Local Sandbox)}',
      details: [
        'Checks cluster connectivity using Kubernetes API client.',
        'If cluster is online: creates Job resource in carbonroute-jobs namespace.',
        'If no cluster is reachable: clusterMode is "offline_fallback" and the execution is simulated; no workload process runs.',
        'Dispatch happens when the user clicks Dispatch, not automatically at the recommended time.',
      ],
      output: 'Execution record (Kubernetes or simulated) and its log lines.',
    },
    {
      step: '10',
      title: 'Carbon Accounting & Empirical Verification',
      subtitle: 'Comparing realized emissions against counterfactual immediate baseline',
      icon: TrendingDown,
      badge: 'Accounting & Audit',
      color: 'text-teal-400',
      description:
        'After the scheduled window has passed, the user collects realized carbon intensity from the provider for the scheduled and Immediate windows and compares it with the forecast.',
      math: '\\Delta C = C_{\\text{immediate}} - C_{\\text{realized}} = \\int_0^{\\Delta t} I(t) dt - \\int_{t^*}^{t^*+\\Delta t} I(t) dt',
      details: [
        'Energy is an assumed model (0.125 kW per vCPU), not a measurement.',
        'Each observation is labelled measured or provider estimate.',
        'Realized emissions are reported only when measured energy exists (none yet).',
      ],
      output: 'Downloadable forecast-vs-observed report.',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      {/* Header */}
      <div className="space-y-3 pb-6 border-b border-slate-800">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
          <Play className="w-3.5 h-3.5" />
          <span>Complete System Lifecycle</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-mono">
          How CarbonRoute Works
        </h1>
        <p className="text-sm text-slate-400 max-w-4xl leading-relaxed">
          The 10-step vertical slice lifecycle from batch job submission, carbon intensity forecasting, horizon uncertainty modeling, and 5-policy benchmarking to Kubernetes dispatch, sandbox execution, and realized carbon accounting.
        </p>
      </div>

      {/* Interactive Step Navigator */}
      <div className="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-10 gap-2 font-mono text-xs">
        {steps.map((st, idx) => {
          const Icon = st.icon;
          const isActive = activeStep === idx;
          return (
            <button
              key={st.step}
              onClick={() => setActiveStep(idx)}
              className={`p-2.5 rounded-xl border text-center transition-all flex flex-col items-center justify-center space-y-1 ${
                isActive
                  ? 'bg-emerald-500/20 border-emerald-500/50 ring-1 ring-emerald-500/40 text-emerald-300 shadow-sm'
                  : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-1">
                <span className="font-bold text-[11px]">{st.step}</span>
              </div>
              <Icon className="w-4 h-4" />
              <span className="text-[9px] truncate w-full font-medium">{st.title.split(' ')[0]}</span>
            </button>
          );
        })}
      </div>

      {/* Active Step Detailed Card */}
      {(() => {
        const s = steps[activeStep];
        const Icon = s.icon;
        return (
          <div className="glass-card rounded-2xl p-6 sm:p-10 border border-slate-800 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
              <div className="flex items-start space-x-4">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-mono font-bold text-emerald-400 uppercase">Step {s.step}</span>
                    <span className="text-slate-600">&bull;</span>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">
                      {s.badge}
                    </span>
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-white font-mono mt-0.5">{s.title}</h2>
                  <p className="text-xs text-slate-400 mt-1">{s.subtitle}</p>
                </div>
              </div>

              <div className="flex items-center space-x-2 text-xs font-mono">
                <button
                  disabled={activeStep === 0}
                  onClick={() => setActiveStep(activeStep - 1)}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-30"
                >
                  &larr; Prev
                </button>
                <button
                  disabled={activeStep === steps.length - 1}
                  onClick={() => setActiveStep(activeStep + 1)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-30"
                >
                  Next &rarr;
                </button>
              </div>
            </div>

            {/* Description & Formula Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400">
                  Step Mechanics &amp; Overview
                </h3>
                <p className="text-sm text-slate-200 leading-relaxed">{s.description}</p>

                <div className="space-y-2 pt-2">
                  <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-400">
                    Key Execution Details
                  </h4>
                  <div className="space-y-2 text-xs">
                    {s.details.map((d, i) => (
                      <div key={i} className="flex items-start space-x-2.5 text-slate-300">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{d}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-sky-400">
                  Mathematical Formulation &amp; Output
                </h3>

                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs space-y-2">
                  <span className="text-[10px] uppercase text-slate-500 font-bold block">Governing Equation</span>
                  <div className="p-3 rounded bg-slate-900/90 border border-slate-800/80 text-emerald-300 text-sm overflow-x-auto">
                    <code>{s.math}</code>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs space-y-1.5">
                  <span className="text-[10px] uppercase text-slate-500 font-bold block">Produced Artifact / Output</span>
                  <p className="text-slate-200 leading-relaxed">{s.output}</p>
                </div>
              </div>
            </div>

            {/* Try in Prototype CTA */}
            <div className="pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-xs text-slate-400">
                Want to observe this step running live against actual grid traces and container sandboxes?
              </div>
              <Link
                to="/prototype"
                className="inline-flex items-center px-4 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs hover:bg-emerald-400 font-mono transition-all shadow-sm group"
              >
                <span>Experience in Interactive Prototype</span>
                <ArrowRight className="w-4 h-4 ml-1.5 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
          </div>
        );
      })()}

      {/* Architecture Flow Diagram */}
      <div className="glass-card rounded-2xl p-6 sm:p-8 border border-slate-800 space-y-6">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <span className="text-xs font-mono font-bold text-emerald-400">End-to-End Architecture</span>
            <h3 className="text-xl font-bold text-white font-mono">10-Stage Pipeline Overview</h3>
          </div>
          <span className="text-xs font-mono text-slate-400 px-2.5 py-1 rounded bg-slate-900 border border-slate-800">
            Linear Execution Pipeline
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 font-mono text-xs">
          {steps.map((st) => (
            <div
              key={st.step}
              onClick={() => setActiveStep(parseInt(st.step, 10) - 1)}
              className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 hover:border-emerald-500/40 cursor-pointer transition-all space-y-2 group"
            >
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-bold text-emerald-400">Step {st.step}</span>
                <span className="text-slate-500 group-hover:text-slate-300 transition-colors">&rarr;</span>
              </div>
              <h4 className="font-bold text-slate-200 text-xs line-clamp-1">{st.title}</h4>
              <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed font-sans">{st.subtitle}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
