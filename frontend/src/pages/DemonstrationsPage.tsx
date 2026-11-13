import React, { useState } from 'react';
import { FeasibilityDemoVisualizer } from '../components/FeasibilityDemoVisualizer';
import {
  Play,
  Server,
  Zap,
  CheckCircle2,
  Terminal,
  ArrowRight,
  Cpu,
  Layers,
  Code2,
  ExternalLink,
} from 'lucide-react';

export const DemonstrationsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'feasibility' | 'kubernetes'>('feasibility');

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
      {/* Header */}
      <div className="space-y-3 pb-6 border-b border-slate-800">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
          <Play className="w-3.5 h-3.5" />
          <span>Interactive Demonstrations</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-mono">
          Core Feasibility &amp; Kubernetes Demonstrations
        </h1>
        <p className="text-sm text-slate-400 max-w-3xl leading-relaxed">
          Explore the live feasibility model demonstrating uncertainty-driven decision shifts and the production Kubernetes batch workload connector pipeline.
        </p>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center space-x-2 font-mono text-xs">
        <button
          onClick={() => setActiveTab('feasibility')}
          className={`px-4 py-2.5 rounded-xl border transition-all flex items-center space-x-2 ${
            activeTab === 'feasibility'
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 font-bold shadow-sm'
              : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
          }`}
        >
          <Zap className="w-4 h-4 text-emerald-400" />
          <span>1. Uncertainty Feasibility Demo (Scenario A vs B)</span>
        </button>

        <button
          onClick={() => setActiveTab('kubernetes')}
          className={`px-4 py-2.5 rounded-xl border transition-all flex items-center space-x-2 ${
            activeTab === 'kubernetes'
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 font-bold shadow-sm'
              : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-white'
          }`}
        >
          <Server className="w-4 h-4 text-teal-400" />
          <span>2. Kubernetes Batch Workload Connector</span>
        </button>
      </div>

      {/* Content 1: Feasibility Visualizer */}
      {activeTab === 'feasibility' && (
        <div className="space-y-6">
          <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300 space-y-1">
            <span className="font-bold text-white font-mono block">Experiment Objective:</span>
            <p className="leading-relaxed">
              Demonstrate that CarbonRoute makes <em>different</em> scheduling decisions when forecast uncertainty changes, even when the underlying point-predicted carbon intensity profile is 100% identical.
            </p>
          </div>

          <FeasibilityDemoVisualizer />
        </div>
      )}

      {/* Content 2: Kubernetes Workload Connector Spec */}
      {activeTab === 'kubernetes' && (
        <div className="space-y-8">
          <div className="glass-card rounded-2xl p-8 border border-slate-800/80 space-y-6">
            <div className="space-y-1">
              <span className="text-xs font-mono font-semibold uppercase tracking-wider text-emerald-400">
                Software Execution Architecture
              </span>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight font-mono">
                Real Workload Dispatch to Kubernetes Jobs
              </h2>
              <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
                Rather than stopping at discrete simulations, CarbonRoute connects to production container orchestrators.
              </p>
            </div>

            {/* Step-by-Step Connector Pipeline */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 pt-2">
              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
                <span className="text-[10px] font-mono text-emerald-400 font-bold block uppercase">Step 01</span>
                <h4 className="font-bold text-white font-mono">Job Submission</h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  User/CI submits container spec: image, duration (2h), deadline (12h), risk limit (&tau;=0.05).
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
                <span className="text-[10px] font-mono text-emerald-400 font-bold block uppercase">Step 02</span>
                <h4 className="font-bold text-white font-mono">CarbonRoute API</h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  API ingests workload, queries the regional forecast and computes deadline risk from the declared runtime variability.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-emerald-500/50 bg-emerald-950/20 space-y-2 text-xs">
                <span className="text-[10px] font-mono text-emerald-300 font-bold block uppercase">Step 03 (Core)</span>
                <h4 className="font-bold text-emerald-300 font-mono">Constraint Solver</h4>
                <p className="text-slate-300 text-[11px] leading-relaxed font-mono">
                  Selects optimal green dispatch window satisfying hard deadlines and P(violation) &le; &tau;.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
                <span className="text-[10px] font-mono text-emerald-400 font-bold block uppercase">Step 04</span>
                <h4 className="font-bold text-white font-mono">Decision Explanation</h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Generates machine and human-readable audit record detailing emissions savings vs risk tradeoff.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2 text-xs">
                <span className="text-[10px] font-mono text-emerald-400 font-bold block uppercase">Step 05</span>
                <h4 className="font-bold text-white font-mono">k8s Job Execution</h4>
                <p className="text-slate-400 text-[11px] leading-relaxed">
                  Connector applies manifest to Kubernetes cluster when scheduled window commences.
                </p>
              </div>
            </div>

            {/* Sample Kubernetes Job Manifest & API Response */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 text-xs font-mono">
              <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <span className="text-slate-400 block text-[11px] uppercase font-bold text-emerald-400">
                  Sample Scheduling API Response (`POST /api/v1/schedule`)
                </span>
                <pre className="text-slate-300 overflow-x-auto text-[11px] leading-relaxed p-2 bg-slate-900/80 rounded">
{`{
  "jobId": "batch-ml-inference-882",
  "scheduledWindow": {
    "start": "2026-08-18T04:00:00Z",
    "end": "2026-08-18T06:00:00Z"
  },
  "metrics": {
    "predictedCarbon": 172.5,
    "carbonUnit": "gCO2eq/kWh",
    "estimatedDeadlineRisk": 0.048,
    "riskTolerance": 0.05
  },
  "explanation": "Shifted +4h to capture offshore wind peak while keeping modelled deadline-miss risk <= 5% (illustrative example)."
}`}
                </pre>
              </div>

              <div className="p-5 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <span className="text-slate-400 block text-[11px] uppercase font-bold text-teal-400">
                  Generated Kubernetes Manifest (`batch/v1 Job`)
                </span>
                <pre className="text-slate-300 overflow-x-auto text-[11px] leading-relaxed p-2 bg-slate-900/80 rounded">
{`apiVersion: batch/v1
kind: Job
metadata:
  name: carbonroute-job-882
  labels:
    carbonroute.org/scheduled-window: "T+4"
    carbonroute.org/risk-score: "0.048"
spec:
  template:
    spec:
      containers:
      - name: workload-runner
        image: python:3.11-slim
        command: ["python", "run_model.py"]
      restartPolicy: OnFailure`}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
