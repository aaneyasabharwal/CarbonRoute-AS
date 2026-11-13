/**
 * Validation of the workload a job runs (F10 / M1.4).
 *
 * A job either names a container image (the image's own entrypoint runs) or gives a shell
 * command that runs inside the default workload image via `sh -c`. Running the user's command
 * inside their container is the purpose of the service, so the command itself is not
 * filtered; what is prevented is the command or image changing anything OUTSIDE the
 * container: the manifest is built as an object and serialised as JSON (no YAML/shell
 * templating), kubectl is called with argument arrays (no host shell), and the pod runs with
 * a restricted security context.
 */

export class WorkloadSpecError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'WorkloadSpecError';
  }
}

/** Container image reference: [registry[:port]/]path[:tag][@sha256:digest], lower-case path. */
const IMAGE_REFERENCE =
  /^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*(?::[0-9]{1,5})?\/)?[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;

export const MAX_COMMAND_LENGTH = 2000;
export const MAX_IMAGE_LENGTH = 255;

export function isValidImageReference(value: string): boolean {
  return value.length <= MAX_IMAGE_LENGTH && IMAGE_REFERENCE.test(value);
}

/**
 * Whether the value is used as a container image. The original API treats a value starting
 * with "python" as a command even when isContainerImage is true; that is kept.
 */
export function runsAsImage(spec: { commandOrImage: string; isContainerImage?: boolean }): boolean {
  return Boolean(spec.isContainerImage) && !String(spec.commandOrImage).startsWith('python');
}

/** Throws WorkloadSpecError (HTTP 400) for an image or command that cannot be used safely. */
export function validateWorkloadSpec(spec: { commandOrImage: unknown; isContainerImage?: unknown }): void {
  const value = typeof spec.commandOrImage === 'string' ? spec.commandOrImage : '';
  if (!value.trim()) throw new WorkloadSpecError('A container image or command is required.');
  // Control characters (newlines included) are never valid in an image and have no place in
  // a one-line batch command; rejecting them also keeps logs and manifests readable.
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new WorkloadSpecError('The image or command must not contain control characters or line breaks.');
  }
  if (runsAsImage({ commandOrImage: value, isContainerImage: Boolean(spec.isContainerImage) })) {
    if (!isValidImageReference(value)) {
      throw new WorkloadSpecError(
        'Invalid container image reference. Use [registry/]name[:tag][@sha256:digest], e.g. ghcr.io/org/app:1.0.'
      );
    }
  } else if (value.length > MAX_COMMAND_LENGTH) {
    throw new WorkloadSpecError(`The command must be at most ${MAX_COMMAND_LENGTH} characters.`);
  }
}
