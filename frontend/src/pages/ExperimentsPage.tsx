import React from 'react';
import { Link } from 'react-router-dom';
import {
  FlaskConical,
  BarChart3,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  TrendingDown,
  Layers,
  Sparkles,
  ShieldAlert,
} from 'lucide-react';

export const ExperimentsPage: React.FC = () => {
  const dimensions = [
    {
      name: 'Grid Regions',
      spec: 'Multiple ISO/RTO electricity grids (e.g. CAISO, ERCOT, UK National Grid, DK-DK1)',
      desc: 'Validates geographic variance in solar/wind penetration and forecast predictability.',
    },
    {
      name: 'Workload Classes',
      spec: 'Short Jobs (15-45m) &bull; Medium Jobs (1-3h) &bull; Long Jobs (4-12h)',
      desc: 'Evaluates duration sensitivity against changing forecast error horizons.',
    },
    {
      name: 'Workload Scale',
      spec: 'Batch sizes of N = 50, 200, 1000 synthetic & trace-derived workloads',
      desc: 'Tests queue contention, parallel resource capacity, and solver scalability.',
    },
    {
      name: 'Forecast Error Levels',
      spec: 'Low Uncertainty (&sigma;=10) &bull; Medium Uncertainty (&sigma;=30) &bull; High Uncertainty (&sigma;=70)',
      desc: 'Synthetic noise injections on top of ground-truth traces to stress-test risk models.',
    },
    {
      name: 'Statistical Seeds',
      spec: '10 to 30 Independent Random Seeds per experiment matrix cell',
      desc: 'Ensures statistically significant paired comparisons and 95% confidence intervals.',
    },
  ];

  const metrics = [
    {
      category: 'Carbon Performance',
      items: [
        { name: 'Total Carbon Emissions', unit: 'kg CO2eq', desc: 'Absolute emissions accumulated across all batch workload executions.', status: 'qualified', note: 'Reported as ESTIMATED emissions (realized intensity x assumed energy, 0.125 kW per vCPU). No energy is measured, so realized emissions are never reported.' },
        { name: 'Carbon Reduction Percentage', unit: '% vs Immediate', desc: 'Relative savings compared to naive immediate arrival dispatch.', status: 'qualified', note: 'Reported as the paired difference in realized carbon intensity vs Immediate (gCO2eq/kWh) with a snapshot-cluster 95% interval; not yet conclusive.' },
      ],
    },
    {
      category: 'Scheduling & Deadline Performance',
      items: [
        { name: 'Deadline Violation Rate', unit: '% of jobs', desc: 'Empirical fraction of jobs that failed to finish before their designated deadline.', status: 'qualified', note: 'Implemented with SIMULATED runtimes Normal(d, (cv d)^2); no recorded runtimes exist yet.' },
        { name: 'Average Slack Consumption', unit: 'hours', desc: 'Proportion of available flexibility window utilized before execution started.', status: 'implemented', note: 'Reported as mean scheduling delay (hours from arrival to start) per policy.' },
      ],
    },
    {
      category: 'Probability Calibration',
      items: [
        { name: 'Brier Score', unit: 'Score [0, 1]', desc: 'Mean squared error between predicted violation probabilities and binary realized outcomes.', status: 'planned', note: 'Needs recorded runtimes and deadline outcomes from real executions.' },
        { name: 'Expected Calibration Error (ECE)', unit: 'Weighted Delta', desc: 'Average difference between binned predicted confidence and actual empirical frequency.', status: 'planned', note: 'Needs recorded runtimes and deadline outcomes from real executions.' },
        { name: 'Reliability Curve Slopes', unit: 'Calibration Slope', desc: 'Diagnostic alignment against the ideal 45-degree perfect calibration line.', status: 'planned', note: 'Needs recorded runtimes and deadline outcomes from real executions.' },
      ],
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
      {/* Header */}
      <div className="space-y-3 pb-6 border-b border-slate-800">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
          <FlaskConical className="w-3.5 h-3.5" />
          <span>Evaluation Framework</span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-mono">
          Experimental Framework &amp; Benchmark Design
        </h1>
        <p className="text-sm text-slate-400 max-w-3xl leading-relaxed">
          Comprehensive multi-dimensional evaluation protocol to empirically test carbon reduction, deadline violations, and probability calibration against reference baselines.
        </p>
      </div>

      {/* Academic Ethics / Research Integrity Banner */}
      <div className="p-4 rounded-xl bg-slate-900/90 border border-amber-500/50 text-amber-200 text-xs flex items-start space-x-3">
        <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-bold font-mono text-amber-300 block text-sm">
            Research Integrity Notice: what exists today
          </span>
          <p className="text-slate-300 leading-relaxed">
            This page describes the evaluation design. Actual results from the replay benchmark (real Electricity Maps forecasts and realized values, synthetic workloads) are on the{' '}
            <Link to="/results" className="underline text-amber-100">Results page</Link>, with sample counts and 95% intervals. The data so far covers about one day (a conclusive result needs at least seven days and 30 snapshot clusters), so no result is
            statistically conclusive yet. Each metric below is marked implemented, implemented with a qualification, or planned. No number on this page is a result.
          </p>
        </div>
      </div>

      {/* Experimental Dimensions Matrix */}
      <section className="space-y-6">
        <div className="space-y-1">
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-emerald-400">
            Design Matrix
          </span>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight font-mono">
            5-Dimensional Experimental Protocol
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {dimensions.map((dim, i) => (
            <div key={i} className="glass-card rounded-xl p-5 border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-emerald-400 uppercase">
                  Dimension 0{i + 1}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                  Planned
                </span>
              </div>
              <h3 className="font-bold text-white text-sm">{dim.name}</h3>
              <div className="p-2 bg-slate-900/80 rounded border border-slate-800 font-mono text-[11px] text-slate-300">
                {dim.spec}
              </div>
              <p className="text-xs text-slate-400 leading-relaxed pt-1">
                {dim.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Planned Evaluation Metrics */}
      <section className="space-y-6">
        <div className="space-y-1">
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-emerald-400">
            Performance Metrics
          </span>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight font-mono">
            Quantitative Evaluation Criteria
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {metrics.map((cat, i) => (
            <div key={i} className="glass-card rounded-xl p-5 border border-slate-800/80 space-y-4">
              <h3 className="text-sm font-bold text-white font-mono border-b border-slate-800 pb-2 text-emerald-400">
                {cat.category}
              </h3>
              <div className="space-y-3">
                {cat.items.map((item, j) => (
                  <div key={j} className="space-y-1 text-xs">
                    <div className="flex items-center justify-between font-semibold text-slate-200">
                      <span>{item.name}</span>
                      <span className="text-[10px] font-mono text-slate-400">{item.unit}</span>
                    </div>
                    <p className="text-slate-400 leading-relaxed text-[11px]">
                      {item.desc}
                    </p>
                    <p className="text-[11px] leading-relaxed" data-testid={`metric-status-${item.status}`}>
                      <span className={item.status === 'planned' ? 'text-slate-500 font-mono' : item.status === 'qualified' ? 'text-amber-300 font-mono' : 'text-emerald-300 font-mono'}>
                        {item.status === 'planned' ? 'Planned' : item.status === 'qualified' ? 'Implemented (qualified)' : 'Implemented'}
                      </span>
                      : <span className="text-slate-400">{item.note}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Benchmark Results Placeholder Card */}
      <section className="glass-card rounded-2xl p-8 border border-slate-800/80 text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500">
          <BarChart3 className="w-6 h-6" />
        </div>
        <div className="space-y-1 max-w-md mx-auto">
          <h3 className="text-base font-bold text-white font-mono">
            Where the results are
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Paired policy comparisons with snapshot-cluster intervals, forecast accuracy by zone and the forecast-error model status are on the Results page;
            `npm run report` produces the full research report from the saved results. Reliability plots need real runtime outcomes and are not produced.
          </p>
        </div>
        <Link to="/results" className="inline-flex items-center px-3 py-1.5 rounded bg-emerald-500 text-slate-950 font-bold text-xs font-mono">
          Open Results
        </Link>
      </section>
    </div>
  );
};
