import React, { useState } from 'react';
import {
  Layers,
  Cpu,
  Globe,
  Database,
  Zap,
  Activity,
  ShieldCheck,
  Flame,
  BarChart3,
  Terminal,
  Server,
  HardDrive,
  Code2,
  ExternalLink,
  Info,
  GitBranch,
  TrendingDown,
  Box,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { Link } from 'react-router-dom';

export const ArchitecturePage: React.FC = () => {
  const [selectedLayer, setSelectedLayer] = useState<string>('decision-engine');

  const layers = [
    {
      id: 'client-layer',
      num: '01',
      name: 'Client Interface Layer',
      tech: 'React 18 + TypeScript + Vite + Tailwind CSS',
      icon: Code2,
      color: 'text-emerald-400',
      summary: 'Responsive research portal, 8-step pipeline visualizer, live prototype runner, and presentation archive.',
      details: 'Provides parameter customization (duration, deadline, CPU, RAM, risk tolerance tau), visual 24-hour carbon forecast bar chart with uncertainty envelopes, 5-policy comparative performance table, and streaming terminal output.',
    },
    {
      id: 'api-layer',
      num: '02',
      name: 'API Gateway & Controllers',
      tech: 'Node.js Express / Python FastAPI REST Service',
      icon: Terminal,
      color: 'text-sky-400',
      summary: 'RESTful endpoints for workload registration, carbon forecasting, multi-policy evaluation, and job dispatching.',
      details: 'Implements modular routes (/api/jobs, /api/schedule, /api/carbon/forecast, /api/jobs/:id/dispatch, /api/jobs/:id/status). Handles payload validation, CORS headers, error trapping, and state persistence.',
    },
    {
      id: 'carbon-service',
      num: '03',
      name: 'Carbon Signal Ingestion Service',
      tech: 'Electricity Maps API + Calibrated ISO Traces',
      icon: Activity,
      color: 'text-teal-400',
      summary: 'Acquires 24-hour regional marginal carbon intensity forecasts in gCO2eq/kWh.',
      details: 'Queries live Electricity Maps REST API with regional zone identifiers (e.g. US-CAL-CISO, US-TEX-ERCO, DE, IN-NO). Provider failures are returned as errors; the synthetic demo trace is used only in explicit demo mode.',
    },
    {
      id: 'uncertainty-model',
      num: '04',
      name: 'Horizon Uncertainty Modeling',
      tech: 'Parametric Error Dispersion Model',
      icon: GitBranch,
      color: 'text-purple-400',
      summary: 'Models variance growth over the 24-hour look-ahead horizon sigma(t).',
      details: 'Calculates standard deviation using sigma(t) = sigma_0 * (1 + beta * (t - t_0)^gamma). Computes 95% confidence intervals [mu - 1.96*sigma, mu + 1.96*sigma] to capture widening forecast inaccuracy as jobs are shifted further into the future.',
    },
    {
      id: 'scheduling-engine',
      num: '05',
      name: '5-Policy Benchmark Engine',
      tech: 'Modular Polymorphic Solver Suite',
      icon: Zap,
      color: 'text-amber-400',
      summary: 'Evaluates 5 competing scheduling algorithms on the exact same batch workload.',
      details: 'Simultaneously evaluates: (1) Immediate Dispatch (t=0 baseline), (2) Earliest Deadline First (EDF), (3) Deterministic Carbon-Aware (minimizes mean intensity ignoring variance), (4) CarbonAware Baseline (heuristic threshold window), and (5) CarbonRoute.',
    },
    {
      id: 'risk-calibrator',
      num: '06',
      name: 'Tail Risk Probability Quantifier',
      tech: 'Chebyshev erfc Gaussian Tail Approximation',
      icon: ShieldCheck,
      color: 'text-rose-400',
      summary: 'Estimates deadline violation probability P(violation) for any candidate dispatch slot.',
      details: 'Evaluates P(violation) = 0.5 * erfc(Slack / (sqrt(2) * sigma)). Ensures that delayed green windows are rejected if available execution slack is insufficient to absorb forecast runtime drift.',
    },
    {
      id: 'decision-engine',
      num: '07',
      name: 'CarbonRoute Decision Engine',
      tech: 'Constrained Optimization Core',
      icon: Box,
      color: 'text-emerald-400',
      summary: 'Selects the optimal start hour t* that minimizes expected emissions subject to P(violation) <= tau.',
      details: 'Computes comparative carbon savings percentage relative to Immediate baseline. Formulates a mathematical audit trail explaining why the chosen slot was selected over the deterministic absolute minimum.',
    },
    {
      id: 'k8s-generator',
      num: '08',
      name: 'Kubernetes Job Manifest Generator',
      tech: 'Kubernetes batch/v1 Specification Engine',
      icon: Server,
      color: 'text-blue-400',
      summary: 'Translates scheduling decisions into declarative Kubernetes Job YAML specifications.',
      details: 'Configures container image, restartPolicy: Never, backoffLimit: 2, resource requests and limits (cpu, memory), environment variables (JOB_ID, REGION, EPOCHS), and carbon metadata annotations.',
    },
    {
      id: 'resilient-connector',
      num: '09',
      name: 'Resilient Execution Connector',
      tech: 'kubectl (Minikube / any cluster) or simulated execution',
      icon: HardDrive,
      color: 'text-cyan-400',
      summary: 'Dispatches workload to active Kubernetes cluster or falls back cleanly to local sandbox.',
      details: 'Probes cluster readiness. If reachable, submits Job to carbonroute-jobs namespace. If cluster is offline, sets clusterMode = "offline_fallback" and executes workload.py in an isolated local subprocess sandbox, streaming stdout live.',
    },
    {
      id: 'telemetry-accounting',
      num: '10',
      name: 'Empirical Carbon Accounting & Telemetry',
      tech: 'Realized Energy & Emission Tracker',
      icon: TrendingDown,
      color: 'text-teal-400',
      summary: 'Calculates realized emissions and validates empirical percentage carbon reduction.',
      details: 'Aggregates actual execution duration, multiplies by regional grid intensity at runtime, compares against the counterfactual immediate dispatch baseline, and stores the record in the benchmark experiments store.',
    },
  ];

  const activeLayer = layers.find((l) => l.id === selectedLayer) || layers[6];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      {/* Top Banner */}
      <div className="border-b border-slate-800 pb-6 space-y-2">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
          <Layers className="w-3.5 h-3.5" />
          <span>Implemented System Architecture</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-mono">
          CarbonRoute 10-Layer System Architecture
        </h1>
        <p className="text-sm sm:text-base text-slate-400 max-w-4xl leading-relaxed">
          The architecture connecting client interfaces, carbon intensity services, horizon uncertainty modeling, polymorphic scheduling policies, Kubernetes batch dispatch, and empirical carbon accounting.
        </p>
      </div>

      {/* Interactive 10-Layer Grid */}
      <div className="glass-card rounded-2xl p-6 sm:p-8 border border-slate-800 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-800">
          <div>
            <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">
              Component Topology
            </span>
            <h2 className="text-xl sm:text-2xl font-bold text-white font-mono">
              10-Layer Architectural Stack
            </h2>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            Click any layer to inspect implementation details
          </span>
        </div>

        {/* 10 Layer Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {layers.map((l) => {
            const Icon = l.icon;
            const isSelected = selectedLayer === l.id;
            return (
              <button
                key={l.id}
                onClick={() => setSelectedLayer(l.id)}
                className={`p-3.5 rounded-xl text-left transition-all flex flex-col justify-between space-y-2 border ${
                  isSelected
                    ? 'bg-emerald-500/20 border-emerald-500/60 ring-1 ring-emerald-500/40 shadow-sm'
                    : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold text-slate-500">Layer {l.num}</span>
                  <Icon className={`w-4 h-4 ${isSelected ? 'text-emerald-400' : 'text-slate-400'}`} />
                </div>
                <div>
                  <h3 className={`font-bold text-xs font-mono line-clamp-1 ${isSelected ? 'text-emerald-300' : 'text-white'}`}>
                    {l.name}
                  </h3>
                  <span className="text-[10px] text-slate-400 font-mono truncate block mt-0.5">{l.tech.split(' ')[0]}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Layer Inspector Box */}
        <div className="p-6 rounded-xl bg-slate-950/90 border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                <activeLayer.icon className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center space-x-2 text-xs font-mono">
                  <span className="text-emerald-400 font-bold">Layer {activeLayer.num}</span>
                  <span className="text-slate-600">&bull;</span>
                  <span className="text-slate-400">{activeLayer.tech}</span>
                </div>
                <h3 className="text-lg font-bold text-white font-mono">{activeLayer.name}</h3>
              </div>
            </div>

            <Link
              to="/prototype"
              className="inline-flex items-center px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs font-mono hover:bg-emerald-400 transition-all shrink-0"
            >
              <span>Test in Prototype</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Link>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs font-mono">
            <div className="space-y-1.5">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Functional Role</span>
              <p className="text-slate-200 text-sm font-sans leading-relaxed">{activeLayer.summary}</p>
            </div>

            <div className="space-y-1.5">
              <span className="text-[10px] text-emerald-400 uppercase font-bold block">Implementation Architecture</span>
              <p className="text-slate-300 font-sans leading-relaxed text-xs">{activeLayer.details}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Dual Stack Diagram (Frontend + Backend + Execution) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Card 1: Frontend & Gateway */}
        <div className="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center space-x-2 pb-3 border-b border-slate-800">
            <Code2 className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-white font-mono text-sm">Frontend &amp; API Layer</h3>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="font-bold text-slate-200">React 18 + Vite Web UI</span>
              <p className="text-slate-400 font-sans text-[11px]">Interactive controls, live chart envelopes, streaming container console.</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="font-bold text-slate-200">Express / FastAPI Gateway</span>
              <p className="text-slate-400 font-sans text-[11px]">RESTful prototype endpoints, schema validation, CORS security.</p>
            </div>
          </div>
        </div>

        {/* Card 2: Computational Core */}
        <div className="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center space-x-2 pb-3 border-b border-slate-800">
            <Zap className="w-4 h-4 text-sky-400" />
            <h3 className="font-bold text-white font-mono text-sm">Carbon &amp; Scheduling Core</h3>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="font-bold text-slate-200">Electricity Maps + Traces</span>
              <p className="text-slate-400 font-sans text-[11px]">Carbon intensity forecasts (live) or a labelled synthetic demo trace.</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="font-bold text-slate-200">5-Policy Decision Suite</span>
              <p className="text-slate-400 font-sans text-[11px]">Immediate, EDF, Deterministic, Baseline, and CarbonRoute solvers.</p>
            </div>
          </div>
        </div>

        {/* Card 3: Execution & Accounting */}
        <div className="glass-card rounded-2xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center space-x-2 pb-3 border-b border-slate-800">
            <Server className="w-4 h-4 text-purple-400" />
            <h3 className="font-bold text-white font-mono text-sm">Execution &amp; Verification</h3>
          </div>
          <div className="space-y-2 text-xs font-mono">
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="font-bold text-slate-200">Kubernetes batch/v1 Spec</span>
              <p className="text-slate-400 font-sans text-[11px]">Declarative Job manifests with CPU/RAM bounds and metadata tags.</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
              <span className="font-bold text-slate-200">Cluster / Sandbox Runner</span>
              <p className="text-slate-400 font-sans text-[11px]">Live pod execution or local process sandbox streaming real epoch stdout.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
