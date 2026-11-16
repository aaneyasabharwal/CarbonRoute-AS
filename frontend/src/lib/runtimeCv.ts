/**
 * P17: the runtime variability (CV) a user may declare. Must match RUNTIME_CV_OPTIONS in
 * backend/src/services/uncertaintyService.ts; the backend rejects any other value.
 * CV is a user-declared assumption (runtime ~ Normal(d, (CV d)^2)), not learned from data.
 */
export const RUNTIME_CV_OPTIONS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

export type RuntimeCv = (typeof RUNTIME_CV_OPTIONS)[number];

/** Default when the user picks nothing: deterministic runtime (unchanged). */
export const DEFAULT_RUNTIME_CV: RuntimeCv = 0;

/** Option label: the value, with 0 explained and 1.0 shown with one decimal. */
export function runtimeCvLabel(cv: number): string {
  if (cv === 0) return '0: runtime is exact (deterministic)';
  return `${cv.toFixed(1)}: runtime std. dev. = ${Math.round(cv * 100)}% of the duration`;
}

/** Short text for displays of a stored decision. */
export function describeRuntimeCv(cv: number | null | undefined): string {
  if (cv === null || cv === undefined || cv === 0) return '0 (deterministic runtime)';
  return `${cv} (declared, not learned)`;
}
