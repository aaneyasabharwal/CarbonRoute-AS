import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Compass,
  FileText,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Zap,
  Activity,
  Layers,
  ArrowRight,
  TrendingDown,
  Clock,
  DollarSign,
  AlertTriangle,
  Flame,
  Milestone,
  Check,
  X,
} from 'lucide-react';

export const ProjectPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('all');

  const objectives = [
    'Build a simulator representing cloud regions, workloads, carbon intensity, cost and capacity.',
    'Implement baseline scheduling policies (Immediate, EDF, Cost-Aware, Deterministic Carbon, Baseline).',
    'Implement carbon-aware scheduling.',
    'Model forecast uncertainty and forecast errors across multiple time horizons.',
    'Develop an uncertainty-aware scheduling approach.',
    'Estimate deadline-violation probability formally: P(deadline violation | scheduling decision).',
    'Evaluate risk calibration using Brier score and Reliability Diagrams.',
    'Perform stress testing under capacity contention and grid volatility.',
    'Build a reproducible benchmark with standardized evaluation traces.',
    'Expose the system through a FastAPI REST API and interactive web dashboard.',
    'Integrate one containerized workload connector (Kubernetes Jobs) later in the project.',
  ];

  const includedScope = [
    'Discrete-event Cloud & Region Simulator',
    'Standardized & Versioned Carbon Traces',
    'Multi-Policy Scheduling Algorithms (6+ policies)',
    'Forecast Uncertainty & Error Distribution Modeling',
    'Deadline-Risk Calibration (Brier Score / ECE)',
    'Parametric Stress Testing Suite',
    'FastAPI REST Service Endpoints',
    'Interactive React Analytics Dashboard',
    'Reproducible Evaluation Benchmark',
    'One Containerized Software Workload Connector (Kubernetes Jobs)',
  ];

  const notIncludedScope = [
    'Physical data-center server / hardware management',
    'Real-time data-center HVAC / power facility control',
    'Live production hypervisor virtual machine migration',
    'Complete proprietary cloud provider (AWS/GCP) replacement',
    'Opaque LLM-based black-box scheduling agent',
  ];

  const schedulingPolicies = [
    {
      name: 'Immediate',
      category: 'Baseline',
      desc: 'Executes incoming batch jobs immediately upon arrival with zero intentional queuing delay.',
      tradeoff: 'High carbon if arriving in peak grid intensity; minimum job latency.',
    },
    {
      name: 'Earliest Deadline First (EDF)',
      category: 'Baseline',
      desc: 'Prioritizes jobs with the nearest completion deadline to minimize overdue probability.',
      tradeoff: 'Strictly deadline-oriented; unaware of carbon intensity or energy cost variations.',
    },
    {
      name: 'Cost-Aware',
      category: 'Baseline',
      desc: 'Schedules workloads during time slots or cloud regions with lowest electricity spot tariffs.',
      tradeoff: 'Minimizes financial expenditure, but may correlate with high-carbon coal/gas peak generation.',
    },
    {
      name: 'Deterministic Carbon-Aware',
      category: 'Heuristic',
      desc: 'Schedules jobs during the minimum point-forecast carbon interval before the deadline.',
      tradeoff: 'Vulnerable to forecast errors; can suffer severe deadline violations when predictions err.',
    },
    {
      name: 'Carbon-Aware Baseline',
      category: 'Heuristic',
      desc: 'Standard heuristic baseline balancing average forecast carbon against basic deadline margins.',
      tradeoff: 'Moderate carbon reduction, but lacks formal mathematical risk calibration under uncertainty.',
    },
    {
      name: 'Uncertainty-Aware (CarbonRoute)',
      category: 'Proposed Core',
      desc: 'Formally models forecast error variance and shifts workloads toward lower-carbon windows while enforcing P(deadline violation | decision) <= tau.',
      tradeoff: 'Carbon-aware placement under an explicit deadline-risk budget (risk not yet calibrated).',
    },
    {
      name: 'Realized-Data Oracle',
      category: 'Reference',
      desc: 'Theoretical solver possessing perfect hindsight of actual realized carbon intensity and capacity.',
      tradeoff: 'Evaluation reference using realized future information. It is not intended as a realistic production scheduler.',
      isOracle: true,
    },
  ];

  const evaluationMetrics = [
    {
      name: 'Carbon Emissions',
      unit: 'gCO2eq / kWh',
      desc: 'Total greenhouse gas emissions consumed by scheduled batch workloads.',
    },
    {
      name: 'Cloud Cost',
      unit: 'USD ($)',
      desc: 'Infrastructure runtime and dynamic electricity tariff costs across regions.',
    },
    {
      name: 'Job Delay',
      unit: 'Minutes / Hours',
      desc: 'Average and tail (p95/p99) waiting time introduced by intentional temporal shifting.',
    },
    {
      name: 'Deadline Violation Rate',
      unit: 'Percentage (%)',
      desc: 'Proportion of submitted batch jobs that exceed their specified deadline.',
    },
    {
      name: 'Risk Calibration',
      unit: 'Brier Score & ECE',
      desc: 'Statistical alignment between predicted violation risk and actual observed violation frequency.',
    },
    {
      name: 'Oracle Regret',
      unit: 'Delta from Optimal',
      desc: 'Performance gap between real-time scheduler decisions and the perfect-hindsight Oracle upper bound.',
    },
    {
      name: 'Runtime / Resource Utilization',
      unit: 'Compute Overhead (ms)',
      desc: 'Algorithmic solving time and compute efficiency during high-concurrency batch dispatch.',
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-16">
      {/* Top Banner */}
      <div className="border-b border-slate-800 pb-6 space-y-2">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
          <Compass className="w-3.5 h-3.5" />
          <span>Project Specification (UCS503)</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-mono">
          CarbonRoute Project Specification
        </h1>
        <p className="text-sm sm:text-base text-slate-400 max-w-3xl leading-relaxed">
          Comprehensive problem formulation, research scope, scheduling policies, uncertainty models, and 17-week roadmap.
        </p>
      </div>

      {/* 1. PROBLEM */}
      <section className="glass-card rounded-2xl p-8 border border-slate-800/80 space-y-4">
        <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">
          Section 01
        </span>
        <h2 className="text-2xl font-bold text-white tracking-tight font-mono">1. Problem</h2>
        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 text-slate-200 text-sm sm:text-base leading-relaxed">
          &ldquo;Carbon-aware batch scheduling attempts to move flexible workloads toward lower-carbon execution opportunities. However, carbon forecasts and cloud conditions are uncertain. CarbonRoute focuses on evaluating scheduling reliability under these uncertainties.&rdquo;
        </div>
      </section>

      {/* 2. MOTIVATION */}
      <section className="glass-card rounded-2xl p-8 border border-slate-800/80 space-y-4">
        <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">
          Section 02
        </span>
        <h2 className="text-2xl font-bold text-white tracking-tight font-mono">2. Motivation</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs sm:text-sm text-slate-300">
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
            <div className="font-bold text-emerald-400 font-mono">Grid Volatility</div>
            <p className="text-slate-400 leading-relaxed">
              Renewable generation fluctuates due to weather and demand. Shifting flexible computation to solar/wind peaks can cut emissions substantially.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
            <div className="font-bold text-rose-400 font-mono">Forecast Inaccuracy</div>
            <p className="text-slate-400 leading-relaxed">
              Real-world carbon forecasts carry significant errors. Schedulers that trust raw point predictions blindly delay jobs into high-carbon or bottlenecked slots.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
            <div className="font-bold text-teal-400 font-mono">Deadline Assurance</div>
            <p className="text-slate-400 leading-relaxed">
              Production workloads cannot tolerate arbitrary delays. CarbonRoute bounds the modelled deadline-miss probability by the user's tolerance; calibrating that probability is planned work.
            </p>
          </div>
        </div>
      </section>

      {/* 3. RESEARCH QUESTION */}
      <section className="glass-card rounded-2xl p-8 border border-emerald-500/40 bg-gradient-to-r from-emerald-950/20 to-slate-900/60 space-y-4">
        <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">
          Section 03 • Core Research Formulation
        </span>
        <h2 className="text-2xl font-bold text-white tracking-tight font-mono">3. Research Question</h2>
        <div className="p-6 rounded-xl bg-slate-950/80 border border-emerald-500/50 text-base sm:text-xl font-medium text-emerald-200 italic leading-relaxed">
          &ldquo;How reliable is carbon-aware scheduling when carbon forecasts, capacity and prices are uncertain, and can deadline-miss risk be calibrated?&rdquo;
        </div>
      </section>

      {/* 4. OBJECTIVES */}
      <section className="glass-card rounded-2xl p-8 border border-slate-800/80 space-y-4">
        <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">
          Section 04
        </span>
        <h2 className="text-2xl font-bold text-white tracking-tight font-mono">4. Objectives</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs sm:text-sm">
          {objectives.map((obj, i) => (
            <div key={i} className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-start space-x-3">
              <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-xs flex items-center justify-center font-bold shrink-0 mt-0.5">
                {i + 1}
              </span>
              <span className="text-slate-300 leading-relaxed">{obj}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 5. SCOPE */}
      <section className="glass-card rounded-2xl p-8 border border-slate-800/80 space-y-6">
        <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">
          Section 05
        </span>
        <h2 className="text-2xl font-bold text-white tracking-tight font-mono">5. Scope</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Included Column */}
          <div className="p-6 rounded-xl bg-slate-900/90 border border-emerald-500/40 space-y-4">
            <div className="flex items-center space-x-2 text-emerald-400 font-mono font-bold text-sm uppercase">
              <Check className="w-4 h-4" />
              <span>INCLUDED IN PROJECT</span>
            </div>
            <ul className="space-y-2.5 text-xs text-slate-300 font-mono">
              {includedScope.map((item, idx) => (
                <li key={idx} className="flex items-start space-x-2">
                  <span className="text-emerald-400 font-bold shrink-0">+</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Not Included Column */}
          <div className="p-6 rounded-xl bg-slate-900/90 border border-rose-900/50 space-y-4">
            <div className="flex items-center space-x-2 text-rose-400 font-mono font-bold text-sm uppercase">
              <X className="w-4 h-4" />
              <span>NOT INCLUDED INITIALLY</span>
            </div>
            <ul className="space-y-2.5 text-xs text-slate-400 font-mono">
              {notIncludedScope.map((item, idx) => (
                <li key={idx} className="flex items-start space-x-2">
                  <span className="text-rose-400 font-bold shrink-0">-</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 6. PROPOSED SYSTEM */}
      <section className="glass-card rounded-2xl p-8 border border-slate-800/80 space-y-4">
        <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">
          Section 06
        </span>
        <h2 className="text-2xl font-bold text-white tracking-tight font-mono">6. Proposed System</h2>
        <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 text-xs sm:text-sm text-slate-300 space-y-3 leading-relaxed">
          <p>
            CarbonRoute simulates workloads and cloud regions, compares scheduling policies, models uncertainty and evaluates deadline-risk calibration.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-2 font-mono text-xs">
            <div className="p-3 bg-slate-950 rounded border border-slate-800 text-center">
              <div className="text-emerald-400 font-bold">1. Discrete Sim</div>
              <div className="text-slate-400 text-[11px] mt-1">Multi-region grid & capacity</div>
            </div>
            <div className="p-3 bg-slate-950 rounded border border-slate-800 text-center">
              <div className="text-teal-400 font-bold">2. Error Modeling</div>
              <div className="text-slate-400 text-[11px] mt-1">Variance over time horizons</div>
            </div>
            <div className="p-3 bg-slate-950 rounded border border-slate-800 text-center">
              <div className="text-cyan-400 font-bold">3. Risk Calibrator</div>
              <div className="text-slate-400 text-[11px] mt-1">Brier score reliability</div>
            </div>
            <div className="p-3 bg-slate-950 rounded border border-slate-800 text-center">
              <div className="text-indigo-400 font-bold">4. API & Connector</div>
              <div className="text-slate-400 text-[11px] mt-1">FastAPI & Kubernetes Jobs</div>
            </div>
          </div>
        </div>
      </section>

      {/* 7. SCHEDULING POLICIES */}
      <section className="glass-card rounded-2xl p-8 border border-slate-800/80 space-y-6">
        <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">
          Section 07
        </span>
        <h2 className="text-2xl font-bold text-white tracking-tight font-mono">7. Scheduling Policies</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {schedulingPolicies.map((p) => (
            <div
              key={p.name}
              className={`p-5 rounded-xl border flex flex-col justify-between space-y-3 ${
                p.name.includes('CarbonRoute')
                  ? 'bg-emerald-950/30 border-emerald-500/60 ring-1 ring-emerald-500/30'
                  : p.isOracle
                  ? 'bg-indigo-950/30 border-indigo-500/50'
                  : 'bg-slate-900/80 border-slate-800'
              }`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <h3 className={`font-bold text-sm font-mono ${p.name.includes('CarbonRoute') ? 'text-emerald-300' : 'text-white'}`}>
                    {p.name}
                  </h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-950 text-slate-400 border border-slate-800">
                    {p.category}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{p.desc}</p>
              </div>

              {p.isOracle ? (
                <div className="p-2.5 rounded bg-indigo-950/60 border border-indigo-800/60 text-[11px] text-indigo-300 font-mono">
                  <strong>Important:</strong> {p.tradeoff}
                </div>
              ) : (
                <div className="text-[11px] text-slate-400 font-mono pt-1">
                  <span className="text-slate-500">Characteristics:</span> {p.tradeoff}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 8. UNCERTAINTY SECTION */}
      <section className="glass-card rounded-2xl p-8 border border-slate-800/80 space-y-6">
        <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">
          Section 08 • Decision Formulation Under Uncertainty
        </span>
        <h2 className="text-2xl font-bold text-white tracking-tight font-mono">8. Uncertainty &amp; Risk</h2>

        <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 text-xs sm:text-sm text-slate-300 leading-relaxed font-mono">
          &ldquo;CarbonRoute does not simply choose the lowest predicted carbon value. It considers uncertainty and deadline risk when comparing feasible schedules.&rdquo;
        </div>

        {/* Visual Example: Scenario A vs Scenario B */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {/* Scenario A */}
          <div className="p-6 rounded-xl bg-slate-900/90 border border-emerald-500/50 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-emerald-400 font-mono font-bold text-sm">Scenario A</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800">
                High-Confidence Forecast
              </span>
            </div>
            <div className="space-y-2 text-xs font-mono">
              <div className="flex items-center space-x-2 text-slate-300">
                <span className="text-slate-500">Forecast:</span>
                <span className="text-white">High-confidence low-carbon forecast</span>
              </div>
              <div className="flex items-center space-x-2 text-emerald-400">
                <span>&rarr;</span>
                <span>Action: Wait for predicted valley</span>
              </div>
              <div className="flex items-center space-x-2 text-emerald-400">
                <span>&rarr;</span>
                <span>Outcome: Lower carbon intensity achieved</span>
              </div>
              <div className="flex items-center space-x-2 text-emerald-400">
                <span>&rarr;</span>
                <span>Risk Assessment: Low deadline risk (P &le; 5%)</span>
              </div>
            </div>
          </div>

          {/* Scenario B */}
          <div className="p-6 rounded-xl bg-slate-900/90 border border-amber-500/50 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-amber-400 font-mono font-bold text-sm">Scenario B</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950 text-amber-300 border border-amber-800">
                Low-Confidence Forecast
              </span>
            </div>
            <div className="space-y-2 text-xs font-mono">
              <div className="flex items-center space-x-2 text-slate-300">
                <span className="text-slate-500">Forecast:</span>
                <span className="text-white">Low-confidence low-carbon forecast</span>
              </div>
              <div className="flex items-center space-x-2 text-amber-400">
                <span>&rarr;</span>
                <span>Action: Consider earlier execution</span>
              </div>
              <div className="flex items-center space-x-2 text-amber-400">
                <span>&rarr;</span>
                <span>Tradeoff: Slightly higher carbon may be acceptable</span>
              </div>
              <div className="flex items-center space-x-2 text-amber-400">
                <span>&rarr;</span>
                <span>Risk Assessment: Lower deadline risk protected</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 9. EVALUATION */}
      <section className="glass-card rounded-2xl p-8 border border-slate-800/80 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">
              Section 09
            </span>
            <h2 className="text-2xl font-bold text-white tracking-tight font-mono">9. Evaluation Metrics</h2>
          </div>
          <span className="text-xs font-mono px-3 py-1 rounded bg-slate-900 border border-slate-800 text-slate-400">
            Strict Integrity Policy: No fabricated figures
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          {evaluationMetrics.map((m) => (
            <div
              key={m.name}
              className="p-5 rounded-xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between space-y-3"
            >
              <div>
                <h3 className="font-bold text-white text-sm font-mono">{m.name}</h3>
                <span className="text-[10px] text-slate-500 font-mono block mt-0.5">{m.unit}</span>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">{m.desc}</p>
              </div>

              <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs font-mono">
                <span className="text-slate-500">Benchmark:</span>
                <span className="text-amber-400 font-semibold text-[11px] bg-amber-950/40 px-2 py-0.5 rounded border border-amber-800/40">
                  To be evaluated
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 10. 17-WEEK ROADMAP */}
      <section className="glass-card rounded-2xl p-8 border border-slate-800/80 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider">
              Section 10
            </span>
            <h2 className="text-2xl font-bold text-white tracking-tight font-mono">10. 17-Week Roadmap</h2>
          </div>
          <Link
            to="/roadmap"
            className="text-xs text-emerald-400 font-mono hover:underline flex items-center"
          >
            <span>View Interactive Timeline</span>
            <ArrowRight className="w-3 h-3 ml-1" />
          </Link>
        </div>

        <div className="p-4 bg-slate-900/90 rounded-xl border border-slate-800 text-xs text-slate-300 font-mono">
          <strong>Notice:</strong> The project website itself is developed and deployed from the beginning (Week 1) and continues actively throughout the 17-week semester.
        </div>
      </section>
    </div>
  );
};
