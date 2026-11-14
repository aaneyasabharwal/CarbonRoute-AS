import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Zap,
  FileText,
  Compass,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Layers,
  Activity,
  Server,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Users,
  Database,
  BarChart3,
  Flame,
  Globe,
  Sliders,
  Terminal,
  Clock,
  HelpCircle,
  XCircle,
  Milestone,
  Check,
  X,
  Play,
  GitBranch,
  TrendingDown,
} from 'lucide-react';

export const HomePage: React.FC = () => {
  const [activePipelineStep, setActivePipelineStep] = useState<number>(0);

  const builtItems = [
    { title: 'End-to-end scheduler', desc: 'Submit a job, get a decision with an explanation, dispatch it, and download a report; jobs belong to their owner.' },
    { title: 'Global carbon data', desc: 'All 351 Electricity Maps grid zones selectable. Live forecasts where a provider key is configured; otherwise labelled synthetic demo data (own profiles for 4 zones, a generic synthetic trace for the rest).' },
    { title: 'Deadline-risk model', desc: 'P(miss) = 1 - Phi((D - t - d) / (CV d)) from a declared runtime variability CV, at exact deadline and arrival instants.' },
    { title: '5-policy comparison', desc: 'Immediate, EDF, Greedy, CarbonAware baseline and CarbonRoute on the same forecast and candidate windows.' },
    { title: 'Kubernetes dispatch or labelled simulation', desc: 'Kubernetes Job submission when a cluster is connected; otherwise a simulation that runs no workload and says so.' },
    { title: 'Reproducible research pipeline', desc: 'Hourly collector, replay benchmark with confidence intervals, and a forecast-error ML pipeline that refuses to train on too little data.' },
  ];

  const futureRoadmapItems = [
    { title: 'Full Cluster Minikube Testbed', desc: 'Multi-node Kubernetes testbed deployment with live prometheus-node-exporter telemetry.' },
    { title: 'Longer data collection', desc: 'At least 7 days of real forecasts and realized values (1 day so far) so results can become statistically conclusive.' },
    { title: 'Repeated Seed Evaluations', desc: '10 to 30 independent random seed simulation suites for 95% statistical confidence intervals.' },
    { title: 'Risk calibration (not implemented)', desc: 'Brier score / ECE need recorded runtimes and outcomes; no calibration results exist yet (roadmap M9.2).' },
    { title: 'Multi-Job Queue Contention Solver', desc: 'Concurrent batch queue scheduler with multi-tenant capacity and priority preemption.' },
  ];

  const pipelineSteps = [
    {
      id: 1,
      name: 'Job Submission',
      badge: 'Step 1',
      icon: Cpu,
      title: 'Workload Registration & Constraints',
      summary: 'ML Engineer specifies runtime, memory, deadline, and risk tolerance threshold.',
      details: 'Accepts batch specifications including estimated duration Delta_t, deadline D, required compute cores, and risk tolerance tau in (0, 0.5]. The feasibility check rejects jobs whose deadline is earlier than submission + duration.',
      output: 'Validated Workload Spec with non-negative initial slack.',
    },
    {
      id: 2,
      name: 'Carbon Forecast',
      badge: 'Step 2',
      icon: Activity,
      title: 'Regional Carbon Signal Ingestion',
      summary: 'Fetches 24-hour marginal grid carbon intensity forecasts.',
      details: 'Queries live Electricity Maps API for target ISO zone (e.g. CAISO, ERCOT, Germany, Northern India). If the API key is missing or the provider fails, the request fails with an error; the synthetic demo trace is used only when demo mode is selected.',
      output: '24-hour hourly carbon intensity array I(t) in gCO2eq/kWh.',
    },
    {
      id: 3,
      name: 'Horizon Uncertainty',
      badge: 'Step 3',
      icon: GitBranch,
      title: 'Uncertainty & Risk Modeling',
      summary: 'Forecast variance widens over look-ahead horizon.',
      details: 'Applies dispersion equation sigma(t) = sigma_0 * (1 + beta * (t - t_0)^gamma). Computes deadline violation probability P(violation) = 0.5 * erfc(Slack / (sqrt(2) * sigma)) for every candidate slot.',
      output: 'Hourly uncertainty standard deviation vector and 95% confidence bands.',
    },
    {
      id: 4,
      name: '5 Schedulers',
      badge: 'Step 4',
      icon: BarChart3,
      title: 'Multi-Policy Competitive Evaluation',
      summary: 'Evaluates 5 distinct scheduling policies side-by-side.',
      details: 'Computes start time, delay, expected emissions, and violation risk for: (1) Immediate Dispatch, (2) EDF, (3) Deterministic Carbon-Aware, (4) CarbonAware Baseline, and (5) CarbonRoute.',
      output: '5-policy comparative performance matrix.',
    },
    {
      id: 5,
      name: 'CarbonRoute Decision',
      badge: 'Step 5',
      icon: Zap,
      title: 'Risk-Constrained Optimization Decision',
      summary: 'Selects the lowest-carbon slot adhering to risk budget.',
      details: 'Finds optimal start slot t* = argmin E[Carbon(t)] subject to P(violation) <= tau. Rejects deterministic minimum if violation risk exceeds user tolerance.',
      output: 'Optimal start slot t*, expected savings %, and certified risk audit trail.',
    },
    {
      id: 6,
      name: 'K8s Dispatch',
      badge: 'Step 6',
      icon: Server,
      title: 'Kubernetes Job Manifest Generation',
      summary: 'Translates schedule into production batch/v1 manifest.',
      details: 'Generates Kubernetes Job YAML with CPU/memory limits, carbon metadata annotations, and container environment parameters. Probes cluster connectivity via Kubernetes API.',
      output: 'Production Kubernetes batch/v1 Job specification manifest.',
    },
    {
      id: 7,
      name: 'Live Execution',
      badge: 'Step 7',
      icon: Terminal,
      title: 'Resilient Pod Execution & Streaming',
      summary: 'Submits a Kubernetes Job when a cluster is reachable; otherwise the execution is simulated (no workload runs).',
      details: 'If cluster is online: dispatches to carbonroute-jobs namespace. If cluster is offline: gracefully executes in local process sandbox, streaming real stdout epochs [Epoch 1/5] to terminal.',
      output: 'Live streamed execution log buffer with progress epochs.',
    },
    {
      id: 8,
      name: 'Results Dashboard',
      badge: 'Step 8',
      icon: TrendingDown,
      title: 'Carbon Accounting & Telemetry',
      summary: 'Calculates realized emissions vs immediate baseline.',
      details: 'Pulls realized grid intensity during the actual execution window. Computes true empirical carbon savings vs what would have been emitted under immediate baseline dispatch.',
      output: 'Forecast vs observed intensity for the scheduled and Immediate windows (assumed energy model).',
    },
  ];

  return (
    <div className="space-y-20 py-8">
      {/* 1. HERO SECTION */}
      <section className="relative overflow-hidden pt-8 pb-12">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
          {/* Status Badge */}
          <div className="inline-flex items-center space-x-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-bold">LIVE RESEARCH PLATFORM</span>
            <span className="text-slate-500">&bull;</span>
            <span className="text-slate-300 font-semibold">Team TriFlux</span>
            <span className="text-slate-500">&bull;</span>
            <span className="text-slate-400">UCS503 Software Engineering</span>
          </div>

          {/* Hero Title */}
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight font-mono">
              CARBON<span className="text-emerald-400">ROUTE</span>
            </h1>
            <p className="text-xl sm:text-2xl font-bold text-slate-200 tracking-tight max-w-4xl mx-auto leading-snug">
              Uncertainty-Aware Batch Workload Scheduling Under Carbon Forecast Errors
            </p>
          </div>

          {/* Short description */}
          <p className="text-base sm:text-lg text-slate-300 max-w-3xl mx-auto leading-relaxed">
            CarbonRoute is an uncertainty-aware scheduling framework that evaluates carbon intensity forecasts, estimates deadline violation risk, and dispatches batch workloads across Kubernetes clusters or local sandboxes to minimize realized carbon emissions.
          </p>

          {/* 3 CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
            <Link
              to="/scheduler"
              className="inline-flex items-center px-6 py-3.5 rounded-xl bg-emerald-500 text-slate-950 font-bold text-sm hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-950/60 font-mono group"
            >
              <Cpu className="w-4 h-4 mr-2" />
              <span>Open the Scheduler</span>
              <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </Link>

            <Link
              to="/project"
              className="inline-flex items-center px-6 py-3.5 rounded-xl bg-slate-900 text-slate-100 hover:text-white border border-slate-700 hover:border-emerald-500/60 font-bold text-sm transition-all font-mono shadow-md"
            >
              <Compass className="w-4 h-4 mr-2 text-emerald-400" />
              <span>Explore Project</span>
            </Link>

            <Link
              to="/presentations/planning/v1"
              className="inline-flex items-center px-6 py-3.5 rounded-xl bg-slate-900/80 text-slate-400 hover:text-white border border-slate-800 hover:border-slate-700 font-bold text-sm transition-all font-mono"
            >
              <FileText className="w-4 h-4 mr-2 text-slate-400" />
              <span>Planning V1 (Archive)</span>
            </Link>
          </div>
        </div>
      </section>

      {/* 2. INTERACTIVE 8-STEP PIPELINE VISUALIZER */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="glass-card rounded-2xl p-6 sm:p-10 border border-slate-800 space-y-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400">
                End-to-End Vertical Slice Pipeline
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white font-mono tracking-tight">
                How CarbonRoute Works
              </h2>
            </div>
            <Link
              to="/how-it-works"
              className="text-xs font-mono text-emerald-400 hover:text-emerald-300 flex items-center space-x-1 font-bold"
            >
              <span>10-Step Deep Dive &rarr;</span>
            </Link>
          </div>

          {/* Step Selector Buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 font-mono text-xs">
            {pipelineSteps.map((step, idx) => {
              const Icon = step.icon;
              const isSelected = activePipelineStep === idx;
              return (
                <button
                  key={step.id}
                  onClick={() => setActivePipelineStep(idx)}
                  className={`p-2.5 rounded-xl border text-center transition-all flex flex-col items-center justify-center space-y-1 ${
                    isSelected
                      ? 'bg-emerald-500/20 border-emerald-500/60 ring-1 ring-emerald-500/40 text-emerald-300 shadow-sm'
                      : 'bg-slate-900/80 border-slate-800 hover:border-slate-700 text-slate-400 hover:text-white'
                  }`}
                >
                  <span className="text-[10px] font-bold text-slate-500">{step.badge}</span>
                  <Icon className="w-4 h-4" />
                  <span className="text-[10px] truncate w-full font-medium">{step.name}</span>
                </button>
              );
            })}
          </div>

          {/* Active Step Showcase */}
          {(() => {
            const cur = pipelineSteps[activePipelineStep];
            const Icon = cur.icon;
            return (
              <div className="p-6 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2 text-xs font-mono">
                        <span className="text-emerald-400 font-bold">{cur.badge}</span>
                        <span className="text-slate-600">&bull;</span>
                        <span className="text-slate-400">{cur.summary}</span>
                      </div>
                      <h3 className="text-lg sm:text-xl font-bold text-white font-mono">{cur.title}</h3>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 text-xs font-mono">
                    <button
                      disabled={activePipelineStep === 0}
                      onClick={() => setActivePipelineStep(activePipelineStep - 1)}
                      className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-30"
                    >
                      &larr; Prev
                    </button>
                    <button
                      disabled={activePipelineStep === pipelineSteps.length - 1}
                      onClick={() => setActivePipelineStep(activePipelineStep + 1)}
                      className="px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-30"
                    >
                      Next &rarr;
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
                  <div className="space-y-2">
                    <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Operational Logic &amp; Behavior
                    </span>
                    <p className="text-slate-200 leading-relaxed text-sm">{cur.details}</p>
                  </div>

                  <div className="space-y-2 font-mono">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                      Produced Artifact / Output State
                    </span>
                    <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 text-emerald-300">
                      &bull; {cur.output}
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex items-center justify-end">
                  <Link
                    to="/scheduler"
                    className="inline-flex items-center text-xs font-mono font-bold text-emerald-400 hover:text-emerald-300 space-x-1"
                  >
                    <span>Run this step in the Scheduler &rarr;</span>
                  </Link>
                </div>
              </div>
            );
          })()}
        </div>
      </section>

      {/* 3. VERIFIED STATUS vs FUTURE RESEARCH PHASES */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div className="text-center space-y-2 max-w-3xl mx-auto">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Transparent Milestone Delivery</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white font-mono tracking-tight">
              What is Built vs Future Roadmap
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 font-sans">
              CarbonRoute demonstrates a genuine working vertical slice. The system estimates deadline-miss risk from a declared runtime variability; that risk is not yet calibrated against recorded runtimes.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Column A: BUILT AND WORKING */}
            <div className="glass-card rounded-2xl p-6 sm:p-8 border border-emerald-500/40 bg-slate-950/80 space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-emerald-900/60">
                <div className="space-y-1">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold font-mono bg-emerald-950 text-emerald-300 border border-emerald-800 uppercase">
                    Delivered &amp; Verifiable
                  </span>
                  <h3 className="text-xl font-bold text-white font-mono flex items-center space-x-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span>BUILT AND WORKING</span>
                  </h3>
                </div>
                <span className="text-xs font-mono text-emerald-400 bg-emerald-950/80 px-2.5 py-1 rounded border border-emerald-800/80 font-bold">
                  6 Core Modules
                </span>
              </div>

              <div className="space-y-3 font-mono text-xs">
                {builtItems.map((item, idx) => (
                  <div key={idx} className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1 hover:border-emerald-500/30 transition-colors">
                    <div className="flex items-center text-emerald-300 font-bold space-x-2">
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span>{item.title}</span>
                    </div>
                    <p className="text-slate-400 text-[11px] font-sans pl-5 leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Column B: FUTURE RESEARCH & BENCHMARK SUITE */}
            <div className="glass-card rounded-2xl p-6 sm:p-8 border border-amber-500/40 bg-slate-950/80 space-y-6">
              <div className="flex items-center justify-between pb-4 border-b border-amber-900/60">
                <div className="space-y-1">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded text-[10px] font-bold font-mono bg-amber-950 text-amber-300 border border-amber-800 uppercase">
                    Phase 7+ Expansion
                  </span>
                  <h3 className="text-xl font-bold text-white font-mono flex items-center space-x-2">
                    <Clock className="w-5 h-5 text-amber-400" />
                    <span>PLANNED BENCHMARK EXTENSIONS</span>
                  </h3>
                </div>
                <span className="text-xs font-mono text-amber-400 bg-amber-950/80 px-2.5 py-1 rounded border border-amber-800/80 font-bold">
                  Research Pipeline
                </span>
              </div>

              <div className="space-y-3 font-mono text-xs">
                {futureRoadmapItems.map((item, idx) => (
                  <div key={idx} className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800/80 space-y-1 hover:border-amber-500/30 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center text-slate-200 font-bold space-x-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                        <span>{item.title}</span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-900/60">
                        Planned
                      </span>
                    </div>
                    <p className="text-slate-400 text-[11px] font-sans pl-3.5 leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. RESEARCH QUESTION & SCIENTIFIC POSITIONING */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="glass-card rounded-2xl p-8 sm:p-10 border border-slate-800 space-y-8">
          <div className="border-b border-slate-800 pb-4 space-y-1">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400">
              Problem Formulation &amp; Scientific Positioning
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white font-mono tracking-tight">
              Problem Statement &amp; Research Gap
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-xs">
            <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
              <span className="text-amber-400 font-bold uppercase text-[11px] block">Problem</span>
              <p className="text-slate-300 font-sans text-xs leading-relaxed">
                Existing carbon-aware schedulers rely on forecasts that contain non-trivial errors, horizon bias, and stochastic noise. Capacity limits and tight deadlines can cause severe deadline breaches if uncertainty is ignored.
              </p>
            </div>

            <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
              <span className="text-emerald-400 font-bold uppercase text-[11px] block">Research Gap</span>
              <p className="text-slate-300 font-sans text-xs leading-relaxed">
                CarbonRoute estimates deadline-miss risk from a declared runtime coefficient of variation and compares policies with reproducible paired replay benchmarks on collected forecasts.
              </p>
            </div>

            <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5">
              <span className="text-teal-400 font-bold uppercase text-[11px] block">Scientific Position</span>
              <p className="text-slate-300 font-sans text-xs leading-relaxed">
                CarbonRoute does not claim to invent carbon-aware scheduling or guarantee impossible zero-risk deadlines; its contribution is a risk-constrained decision framework with honest evaluation; risk calibration is future work.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. TEAM TRIFLUX PREVIEW */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="glass-card rounded-2xl p-8 border border-slate-800/80 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-emerald-400">
                Software Engineering Team &bull; UCS503
              </span>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight font-mono">
                Team TriFlux
              </h2>
            </div>
            <Link
              to="/team"
              className="inline-flex items-center px-4 py-2 rounded-lg bg-slate-900 text-slate-200 hover:text-white border border-slate-800 hover:border-slate-700 font-mono text-xs font-semibold"
            >
              <Users className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />
              <span>Meet the Team</span>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
              <h3 className="font-bold text-white text-base">Yuvika Nagpal</h3>
              <div className="text-xs text-emerald-400 font-mono">Roll: 1024030141</div>
              <div className="text-xs text-slate-300 font-mono">Backend & System Integration</div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Worked on backend development, live Electricity Maps API integration, carbon-data flow, frontend-backend integration, and integration of the major system components.
              </p>
            </div>

            <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
              <h3 className="font-bold text-white text-base">Aaneya Sabharwal</h3>
              <div className="text-xs text-emerald-400 font-mono">Roll: 1024030147</div>
              <div className="text-xs text-slate-300 font-mono">Frontend & User Interface</div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Worked on frontend development, workload input interface, and carbon forecast and scheduling result visualization.
              </p>
            </div>

            <div className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
              <h3 className="font-bold text-white text-base">Kumkum Gupta</h3>
              <div className="text-xs text-emerald-400 font-mono">Roll: 1024030144</div>
              <div className="text-xs text-slate-300 font-mono">Scheduling & Uncertainty Analysis</div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Worked on scheduling policies, candidate execution-window evaluation, uncertainty analysis, deadline-violation risk, and policy comparison.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 6. CALL TO ACTION */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="glass-card rounded-2xl p-8 md:p-10 border border-emerald-500/30 bg-gradient-to-r from-emerald-950/30 via-slate-900/60 to-teal-950/30 flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl">
          <div className="space-y-2 text-center md:text-left">
            <span className="text-xs font-mono font-bold uppercase tracking-wider text-emerald-400">
              Interactive Vertical Slice Ready
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight font-mono">
              Try the Scheduler Live
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Submit custom batch jobs or preloaded presets, observe live carbon intensity envelopes with horizon uncertainty, compare all 5 scheduling policies, and execute real container workloads.
            </p>
          </div>

          <Link
            to="/scheduler"
            className="shrink-0 px-6 py-3.5 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs hover:bg-emerald-400 transition-all shadow-lg font-mono flex items-center space-x-2"
          >
            <Cpu className="w-4 h-4" />
            <span>Open the Scheduler</span>
            <ArrowRight className="w-4 h-4 ml-1" />
          </Link>
        </div>
      </section>
    </div>
  );
};
