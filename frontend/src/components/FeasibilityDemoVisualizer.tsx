import React, { useState, useEffect } from 'react';
import {
  Sliders,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  Clock,
  Zap,
  Info,
  RefreshCw,
  HelpCircle,
  BarChart,
  ArrowRight,
} from 'lucide-react';
import { api } from '../services/api';
import { FeasibilityResult, TimeSlotCarbon } from '../types';

export const FeasibilityDemoVisualizer: React.FC = () => {
  const [durationHours, setDurationHours] = useState<number>(2);
  const [deadlineHours, setDeadlineHours] = useState<number>(12);
  const [riskTolerance, setRiskTolerance] = useState<number>(0.10); // 10%
  const [data, setData] = useState<FeasibilityResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchSimulation = async () => {
    setLoading(true);
    try {
      const res = await api.simulateFeasibility(durationHours, deadlineHours, riskTolerance);
      if (res.success && res.data) {
        setData(res.data);
      }
    } catch (err) {
      console.error('Failed to run feasibility simulation:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSimulation();
  }, [durationHours, deadlineHours, riskTolerance]);

  return (
    <div className="space-y-6">
      {/* Parameter Control Panel */}
      <div className="glass-card rounded-xl p-6 border border-slate-800/80 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
          <div>
            <h3 className="text-base font-bold text-white font-mono flex items-center space-x-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              <span>Feasibility Parameter Controls</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Same synthetic forecast, two levels of declared runtime variability: shows how CarbonRoute keeps the deadline-miss risk within tolerance. Synthetic data only.
            </p>
          </div>
          <button
            onClick={fetchSimulation}
            className="self-start sm:self-auto px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white text-xs font-mono flex items-center space-x-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Recompute</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs font-mono">
          {/* Slider 1: Execution Duration */}
          <div className="space-y-2">
            <div className="flex justify-between text-slate-300">
              <span>Job Duration:</span>
              <span className="text-emerald-400 font-bold">{durationHours} Hours</span>
            </div>
            <input
              type="range"
              min="1"
              max="4"
              step="1"
              value={durationHours}
              onChange={(e) => setDurationHours(parseInt(e.target.value, 10))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
            />
            <span className="text-[11px] text-slate-500 block">Required continuous computing duration</span>
          </div>

          {/* Slider 2: Deadline */}
          <div className="space-y-2">
            <div className="flex justify-between text-slate-300">
              <span>Job Deadline:</span>
              <span className="text-emerald-400 font-bold">T+{deadlineHours}:00</span>
            </div>
            <input
              type="range"
              min="6"
              max="12"
              step="1"
              value={deadlineHours}
              onChange={(e) => setDeadlineHours(parseInt(e.target.value, 10))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
            />
            <span className="text-[11px] text-slate-500 block">Maximum allowable completion time</span>
          </div>

          {/* Slider 3: Risk Tolerance */}
          <div className="space-y-2">
            <div className="flex justify-between text-slate-300">
              <span>Risk Tolerance (&tau;):</span>
              <span className="text-teal-400 font-bold">{Math.round(riskTolerance * 100)}% Max Risk</span>
            </div>
            <input
              type="range"
              min="0.02"
              max="0.25"
              step="0.01"
              value={riskTolerance}
              onChange={(e) => setRiskTolerance(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-400"
            />
            <span className="text-[11px] text-slate-500 block">Upper bound for P(deadline violation)</span>
          </div>
        </div>
      </div>

      {/* Carbon curve and deadline risk under low / high runtime variability */}
      {data && (
        <div className="glass-card rounded-xl p-6 border border-slate-800/80 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <Zap className="w-4 h-4 text-emerald-400" />
              <h4 className="text-sm font-bold text-white font-mono">
                12-Hour Forecast Carbon Curve &amp; Risk Profiles
              </h4>
            </div>
            <span className="text-[11px] text-slate-400 font-mono">
              Base Curve: Identical in both scenarios
            </span>
          </div>

          {/* Time Slot Bar Visualization */}
          <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5 pt-2">
            {data.timeSlots.map((slot: TimeSlotCarbon) => {
              const isScenarioASelected = slot.hour === data.scenarios.scenarioA.selectedStartHour;
              const isScenarioBSelected = slot.hour === data.scenarios.scenarioB.selectedStartHour;
              const isPastDeadline = slot.hour + durationHours > deadlineHours;

              // Normalized height based on carbon intensity (150 - 350 g/kWh)
              const heightPercent = Math.round(((slot.predictedCarbon - 150) / 200) * 100);

              return (
                <div
                  key={slot.hour}
                  className={`p-2 rounded-lg border text-center transition-all flex flex-col justify-between ${
                    isScenarioASelected && isScenarioBSelected
                      ? 'bg-emerald-500/25 border-emerald-400 ring-2 ring-emerald-400/50'
                      : isScenarioASelected
                      ? 'bg-emerald-950/70 border-emerald-500/80 ring-1 ring-emerald-400'
                      : isScenarioBSelected
                      ? 'bg-teal-950/70 border-teal-500/80 ring-1 ring-teal-400'
                      : isPastDeadline
                      ? 'bg-slate-900/30 border-slate-800/40 opacity-40'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400'
                  }`}
                >
                  <div className="text-[10px] font-mono font-semibold text-slate-300">
                    T+{slot.hour}
                  </div>

                  <div className="my-2 h-16 flex items-end justify-center">
                    <div
                      style={{ height: `${Math.max(20, heightPercent)}%` }}
                      className={`w-full rounded-t transition-all ${
                        isScenarioASelected
                          ? 'bg-emerald-400'
                          : isScenarioBSelected
                          ? 'bg-teal-400'
                          : 'bg-slate-700'
                      }`}
                      title={`Carbon: ${slot.predictedCarbon} gCO2eq/kWh`}
                    />
                  </div>

                  <div className="space-y-0.5 text-[9px] font-mono">
                    <div className="text-slate-200 font-bold">{slot.predictedCarbon}g</div>
                    <div className="text-emerald-400">L: {Math.round(slot.uncertaintyLow.violationRisk * 100)}%</div>
                    <div className="text-rose-400">H: {Math.round(slot.uncertaintyHigh.violationRisk * 100)}%</div>
                  </div>

                  {/* Decision Tag */}
                  {isScenarioASelected && (
                    <span className="mt-1 px-1 py-0.5 rounded text-[8px] font-bold bg-emerald-500 text-slate-950 font-mono">
                      A-Choice
                    </span>
                  )}
                  {isScenarioBSelected && !isScenarioASelected && (
                    <span className="mt-1 px-1 py-0.5 rounded text-[8px] font-bold bg-teal-400 text-slate-950 font-mono">
                      B-Choice
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800/80">
            <div className="flex items-center space-x-4">
              <span className="flex items-center">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mr-1.5" />
                Scenario A Dispatch Window (Low Uncertainty)
              </span>
              <span className="flex items-center">
                <span className="w-2.5 h-2.5 rounded-full bg-teal-400 mr-1.5" />
                Scenario B Dispatch Window (High Uncertainty)
              </span>
            </div>
            <div className="text-slate-500">
              L = Low-variance risk &bull; H = High-variance risk
            </div>
          </div>
        </div>
      )}

      {/* Comparative Decision Result Cards */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Scenario A Card */}
          <div className="p-6 rounded-xl bg-slate-900/80 border border-emerald-500/40 space-y-3">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                SCENARIO A
              </span>
              <span className="text-xs text-emerald-400 font-mono font-semibold">Low Uncertainty</span>
            </div>
            <h4 className="text-base font-bold text-white font-mono">
              Dispatch: {data.scenarios.scenarioA.selectedWindow}
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Predicted Carbon:</span>
                <span className="text-emerald-300 font-bold text-sm">
                  {data.scenarios.scenarioA.predictedCarbonAtStart === null ? 'No feasible window' : `${data.scenarios.scenarioA.predictedCarbonAtStart} gCO2/kWh`}
                </span>
              </div>
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Estimated Deadline Risk:</span>
                <span className="text-emerald-400 font-bold text-sm">
                  {data.scenarios.scenarioA.estimatedViolationRisk === null
                    ? 'n/a'
                    : `${(data.scenarios.scenarioA.estimatedViolationRisk * 100).toFixed(1)}% (≤ ${Math.round(riskTolerance * 100)}%)`}
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed pt-1">
              {data.scenarios.scenarioA.decisionRationale}
            </p>
          </div>

          {/* Scenario B Card */}
          <div className="p-6 rounded-xl bg-slate-900/80 border border-teal-500/40 space-y-3">
            <div className="flex items-center justify-between">
              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-teal-500/20 text-teal-300 border border-teal-500/40">
                SCENARIO B
              </span>
              <span className="text-xs text-teal-400 font-mono font-semibold">High Uncertainty</span>
            </div>
            <h4 className="text-base font-bold text-white font-mono">
              Dispatch: {data.scenarios.scenarioB.selectedWindow}
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Predicted Carbon:</span>
                <span className="text-teal-300 font-bold text-sm">
                  {data.scenarios.scenarioB.predictedCarbonAtStart === null ? 'No feasible window' : `${data.scenarios.scenarioB.predictedCarbonAtStart} gCO2/kWh`}
                </span>
              </div>
              <div className="p-2.5 bg-slate-950 rounded border border-slate-800">
                <span className="text-slate-400 block text-[10px]">Estimated Deadline Risk:</span>
                <span className="text-teal-400 font-bold text-sm">
                  {data.scenarios.scenarioB.estimatedViolationRisk === null
                    ? 'n/a'
                    : `${(data.scenarios.scenarioB.estimatedViolationRisk * 100).toFixed(1)}% (≤ ${Math.round(riskTolerance * 100)}%)`}
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed pt-1">
              {data.scenarios.scenarioB.decisionRationale}
            </p>
          </div>
        </div>
      )}

      {/* Scientific Feasibility Conclusion Banner */}
      {data && (
        <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/50 flex items-start space-x-3 text-xs">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold text-emerald-300 font-mono block">
              Feasibility Demonstration Conclusion
            </span>
            <p className="text-slate-300 leading-relaxed">
              {data.feasibilityConclusion}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
