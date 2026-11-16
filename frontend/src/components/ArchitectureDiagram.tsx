import React, { useState } from 'react';
import {
  Database,
  Activity,
  Cpu,
  Terminal,
  Server,
  BarChart3,
  CheckCircle2,
  ArrowRight,
  Shield,
  Layers,
  Sparkles,
  Info,
} from 'lucide-react';

export const ArchitectureDiagram: React.FC = () => {
  const [selectedLayer, setSelectedLayer] = useState<string>('scheduling');

  const layers = [
    {
      id: 'data',
      name: '1. Data Layer',
      icon: Database,
      badge: 'Inputs & Traces',
      color: 'border-emerald-500/40 text-emerald-400 bg-emerald-950/20',
      activeColor: 'bg-emerald-500/20 border-emerald-500 text-emerald-300',
      components: [
        'Carbon Data Provider (Electricity Maps / National Grid API)',
        'Forecast Carbon Intensity ($g\\text{CO}_2\\text{eq}/\\text{kWh}$)',
        'Realised Carbon Intensity (Ground Truth History)',
        'Synthetic Batch Workload Traces (Arrival, Duration, Deadline, SLRs)',
      ],
      description:
        'Ingests high-resolution spatial-temporal electricity carbon intensity forecasts alongside historical realised data. Synthesizes standardized workload traces for reproducible experimentation.',
      inputs: 'Raw grid signals, historical emissions databases, workload trace configs',
      outputs: 'Normalized forecast vectors, error history, structured job queues',
    },
    {
      id: 'modelling',
      name: '2. Modelling & Calibration Layer',
      icon: Activity,
      badge: 'Deadline-Risk Estimation',
      color: 'border-teal-500/40 text-teal-400 bg-teal-950/20',
      activeColor: 'bg-teal-500/20 border-teal-500 text-teal-300',
      components: [
        'Deadline-Risk Estimator: P(miss) from the declared runtime variability (CV)',
        'Forecast Error Measurement (MAE / RMSE / bias by lead time; descriptive, not part of the risk)',
        'Risk Calibration (planned: needs recorded runtimes)',
        'Reliability metrics (Brier score / ECE: planned)',
      ],
      description:
        'Estimates the deadline-miss probability of each candidate window from the user-declared runtime variability (CV): P(miss) = 1 - Phi((D - t - d) / (CV d)). Carbon forecast error is measured separately and does not enter this risk; calibration needs recorded runtimes and is planned.',
      inputs: 'Job duration, deadline, candidate start, declared runtime CV',
      outputs: 'Model-based (not calibrated) deadline-miss probability per candidate window',
    },
    {
      id: 'scheduling',
      name: '3. Scheduling & Optimization Layer',
      icon: Cpu,
      badge: 'Core Optimizer',
      color: 'border-cyan-500/40 text-cyan-400 bg-cyan-950/20',
      activeColor: 'bg-cyan-500/20 border-cyan-500 text-cyan-300',
      components: [
        'Hard Constraint Enforcer (Arrival time, Execution duration, Deadline bounds)',
        'Soft Penalty / Objective Function (Emissions, Electricity cost, Waiting delay)',
        'Constrained Formulation ($P(\\text{violation}) \\le \\tau$)',
        'Baseline Engines (Immediate, EDF, Cost-Aware, Standard Carbon-Aware, Oracle)',
      ],
      description:
        'Solves the constrained carbon optimization problem. Evaluates candidate execution windows against hard deadline constraints and service-level risk tolerance $\\tau$, outputting an optimal dispatch window and mathematical justification.',
      inputs: 'Workload requirements, calibrated risk bounds, emissions weights',
      outputs: 'Optimal start time $t_{\\text{start}}$, target region, risk score, decision rationale',
    },
    {
      id: 'api',
      name: '4. API & Integration Layer',
      icon: Terminal,
      badge: 'REST Services',
      color: 'border-blue-500/40 text-blue-400 bg-blue-950/20',
      activeColor: 'bg-blue-500/20 border-blue-500 text-blue-300',
      components: [
        'RESTful Scheduling API (`POST /api/v1/schedule`)',
        'Decision Explanation Service',
        'Health & Telemetry Endpoints',
        'Authentication & Access Token Middleware',
      ],
      description:
        'Provides a clean, modular REST interface for container orchestrators and batch queues to submit workload specifications and retrieve optimal dispatch windows with human-readable and machine-parseable explanations.',
      inputs: 'JSON workload requests (image, CPU/memory, duration, deadline, risk tolerance)',
      outputs: 'Scheduling decision response, explanation JSON, dispatch webhook trigger',
    },
    {
      id: 'execution',
      name: '5. Workload Execution Layer',
      icon: Server,
      badge: 'Runtime Connector',
      color: 'border-indigo-500/40 text-indigo-400 bg-indigo-950/20',
      activeColor: 'bg-indigo-500/20 border-indigo-500 text-indigo-300',
      components: [
        'Workload Connector (Modular execution driver)',
        'Kubernetes Job Manifest Generator (`batch/v1 Job`)',
        'Argo Workflows / GitHub Actions Runners Integration (Modular targets)',
        'Simulated execution when no cluster is connected (no workload runs)',
      ],
      description:
        'Dispatches the job as a Kubernetes Job when the user clicks Dispatch and a cluster is connected; otherwise records a labelled simulation. Emissions are estimates (assumed energy model), never measured.',
      inputs: 'Scheduled start trigger, container spec, resource allocations',
      outputs: 'Running Kubernetes Job, completion logs, execution audit records',
    },
    {
      id: 'evaluation',
      name: '6. Evaluation & Dashboard Layer',
      icon: BarChart3,
      badge: 'Benchmarking & Validation',
      color: 'border-emerald-500/40 text-emerald-400 bg-emerald-950/20',
      activeColor: 'bg-emerald-500/20 border-emerald-500 text-emerald-300',
      components: [
        'Discrete-Time Experiment Simulator',
        'Multi-Seed Statistical Benchmark Suite',
        'Interactive Analytics Dashboard',
        'Reliability Diagrams & Sensitivity Analysis Plots',
      ],
      description:
        'Enables reproducible evaluation across regions, workload classes, and forecast error levels. Renders carbon reduction, deadline violation rates, and Brier calibration curves.',
      inputs: 'Completed benchmark runs, simulated vs realised outcomes',
      outputs: 'Statistical comparison tables, confidence intervals, interactive visualization charts',
    },
  ];

  const current = layers.find((l) => l.id === selectedLayer) || layers[2];

  return (
    <div className="space-y-6">
      {/* Diagram Interactive Layout */}
      <div className="glass-card rounded-xl p-6 border border-slate-800/80">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-emerald-400" />
            <h3 className="text-base font-bold text-white font-mono">
              Layered System Architecture Flow
            </h3>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            Click any layer to inspect technical responsibilities
          </span>
        </div>

        {/* Visual Pipeline Stack */}
        <div className="grid grid-cols-1 md:grid-cols-6 gap-2 pt-2">
          {layers.map((layer, index) => {
            const Icon = layer.icon;
            const isSelected = layer.id === selectedLayer;
            return (
              <button
                key={layer.id}
                onClick={() => setSelectedLayer(layer.id)}
                className={`p-3 rounded-lg border text-left transition-all flex flex-col justify-between ${
                  isSelected
                    ? layer.activeColor + ' shadow-lg scale-[1.02]'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Icon className="w-4 h-4" />
                    <span className="text-[10px] font-mono opacity-75">0{index + 1}</span>
                  </div>
                  <div className="font-semibold text-xs text-white leading-snug">
                    {layer.name.replace(/^\d+\.\s*/, '')}
                  </div>
                </div>
                <div className="mt-3 text-[10px] font-mono text-slate-400 truncate">
                  {layer.badge}
                </div>
              </button>
            );
          })}
        </div>

        {/* Flow Indicator Arrow Bar */}
        <div className="hidden md:flex items-center justify-between px-6 pt-3 text-[11px] font-mono text-slate-500">
          <span>Data Ingestion</span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-600" />
          <span>Uncertainty Bounds</span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-600" />
          <span>Constraint Solver</span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-600" />
          <span>REST API</span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-600" />
          <span>k8s Connector</span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-600" />
          <span>Evaluation</span>
        </div>
      </div>

      {/* Layer Detail Inspector */}
      <div className="glass-card rounded-xl p-6 border border-slate-800/80 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <current.icon className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h4 className="text-base font-bold text-white font-mono">{current.name}</h4>
              <span className="text-xs text-emerald-400 font-mono">{current.badge}</span>
            </div>
          </div>
          <span className="text-xs px-2.5 py-1 rounded bg-slate-900 text-slate-400 border border-slate-800 font-mono">
            Modular Component
          </span>
        </div>

        <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
          {current.description}
        </p>

        {/* Sub-Components List */}
        <div>
          <h5 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2 font-mono">
            Key Architectural Subsystems &amp; Modules
          </h5>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {current.components.map((c, i) => (
              <div
                key={i}
                className="p-2.5 rounded bg-slate-900/80 border border-slate-800 flex items-center space-x-2 text-xs text-slate-200"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>{c}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Input / Output Spec */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs font-mono">
          <div className="p-3 bg-slate-900/70 rounded border border-slate-800">
            <span className="text-slate-400 block text-[10px] uppercase font-bold mb-1">Inputs:</span>
            <span className="text-slate-300">{current.inputs}</span>
          </div>
          <div className="p-3 bg-slate-900/70 rounded border border-slate-800">
            <span className="text-slate-400 block text-[10px] uppercase font-bold mb-1">Outputs:</span>
            <span className="text-emerald-300">{current.outputs}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
