import { describe, it, expect } from 'vitest';
import { RUNTIME_CV_OPTIONS, DEFAULT_RUNTIME_CV, runtimeCvLabel, describeRuntimeCv } from '../../src/lib/runtimeCv';

describe('runtime CV options (P17)', () => {
  it('are exactly 0, 0.1, ..., 1.0 with 0 as the default', () => {
    expect([...RUNTIME_CV_OPTIONS]).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(DEFAULT_RUNTIME_CV).toBe(0);
  });

  it('labels every option; 0 is deterministic, others give the std. dev. as a share of the duration', () => {
    expect(runtimeCvLabel(0)).toBe('0: runtime is exact (deterministic)');
    expect(runtimeCvLabel(0.3)).toBe('0.3: runtime std. dev. = 30% of the duration');
    expect(runtimeCvLabel(1)).toBe('1.0: runtime std. dev. = 100% of the duration');
    expect(new Set(RUNTIME_CV_OPTIONS.map(runtimeCvLabel)).size).toBe(11);
  });

  it('describes a stored value without claiming it was learned', () => {
    expect(describeRuntimeCv(0)).toBe('0 (deterministic runtime)');
    expect(describeRuntimeCv(undefined)).toBe('0 (deterministic runtime)');
    expect(describeRuntimeCv(0.7)).toBe('0.7 (declared, not learned)');
  });
});
