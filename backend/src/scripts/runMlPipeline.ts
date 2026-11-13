/**
 * Runs the forecast-error ML pipeline on collected data (P5).
 *
 *   npm run ml -- --data <collection dir> [--out <dir>]
 *
 * Writes ml-<timestamp>.json and .md OUTSIDE the repository (default
 * ../CarbonRoute-AS-data/ml-results). With too little data the report says
 * "insufficient-data" and no model is fitted. No secrets are read or written.
 */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { loadCollectedDataset, parseCollection } from '../benchmark/dataset';
import { runMlPipeline, MlReport } from '../ml/pipeline';

const fmt = (x: number | null | undefined, dp = 2) => (x === null || x === undefined ? 'n/a' : x.toFixed(dp));

export function renderMlSummary(r: MlReport & { gitCommit?: string | null }): string {
  const out = ['# CarbonRoute forecast-error model evaluation', ''];
  out.push(`- Status: **${r.status}**`, ...r.statusReasons.map((s) => `  - ${s}`));
  out.push(`- Created ${r.createdAt}; commit ${r.gitCommit ?? 'unknown'}; dataset ${r.dataset.sha256.slice(0, 12)}`);
  out.push(`- Data: ${r.dataset.rows} forecast/realized pairs (${r.dataset.measuredRows} measured), zones ${r.dataset.zones.join(', ') || 'none'}, ${r.dataset.spanDays} days, lead ${r.dataset.leadHours.min ?? 'n/a'}-${r.dataset.leadHours.max ?? 'n/a'} h`);
  out.push(`- Thresholds: train >= ${r.thresholds.minTrainRows}, validation >= ${r.thresholds.minValidationRows}, test >= ${r.thresholds.minTestRows}, span >= ${r.thresholds.minSpanDays} days`);
  if (r.split) out.push(`- Chronological split: train ${r.split.train}, validation ${r.split.validation}, test ${r.split.test} (dropped for gap ${r.split.droppedForGap})`);
  out.push(`- Provider forecast error over all pairs (descriptive): MAE ${fmt(r.providerErrorAllRows.all.mae)}, bias ${fmt(r.providerErrorAllRows.all.bias)}; measured only MAE ${fmt(r.providerErrorAllRows.measuredOnly.mae)} (n=${r.providerErrorAllRows.measuredOnly.n})`, '');
  if (r.testScores) {
    out.push('## Test period (held out)', '', '| Model | MAE | RMSE | Bias | MAE measured only (n) |', '|---|---|---|---|---|');
    for (const s of r.testScores) out.push(`| ${s.model} | ${fmt(s.all.mae)} | ${fmt(s.all.rmse)} | ${fmt(s.all.bias)} | ${fmt(s.measuredOnly.mae)} (${s.measuredOnly.n}) |`);
    out.push('');
  }
  out.push('## Anomaly flags (unsupervised)', '');
  for (const z of r.anomalies.zones) out.push(`- ${z.zone}: ${z.status}${z.status === 'ok' ? `, ${z.flagged.length} flagged of ${z.rows}` : ` (${z.rows} rows)`}`);
  out.push('', '## Notes', '', ...r.notes.map((n) => `- ${n}`), '');
  return out.join('\n');
}

if (require.main === module) {
  const arg = (n: string, d?: string) => {
    const i = process.argv.indexOf(`--${n}`);
    return i >= 0 ? process.argv[i + 1] : d;
  };
  const data = arg('data');
  if (!data) {
    console.log('Usage: npm run ml -- --data <collection dir> [--out <dir>]');
    process.exit(2);
  }
  const dir = path.resolve(data);
  const ds = loadCollectedDataset(dir);
  const records = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort().flatMap((f) => parseCollection(fs.readFileSync(path.join(dir, f), 'utf8').split('\n')));
  let gitCommit: string | null = null;
  try {
    gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    gitCommit = null;
  }
  const report = { ...runMlPipeline(records, { datasetSha256: ds.sha256 }), gitCommit };
  const out = path.resolve(arg('out', path.join(__dirname, '..', '..', '..', '..', 'CarbonRoute-AS-data', 'ml-results'))!);
  fs.mkdirSync(out, { recursive: true });
  const stamp = report.createdAt.replace(/[:.]/g, '-');
  fs.writeFileSync(path.join(out, `ml-${stamp}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, `ml-${stamp}.md`), renderMlSummary(report));
  console.log(renderMlSummary(report));
  console.log(`Written to ${out}`);
}
