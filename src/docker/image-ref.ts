/**
 * Docker image-reference validation (NIN-242).
 *
 * The sandbox image string is placed directly after the `docker run` options in
 * argv. A reference beginning with `-` would be parsed by docker as a flag
 * (option injection) before `bash` is treated as the image, and shell/whitespace
 * metacharacters could smuggle additional arguments. The reference must be
 * validated as a well-formed image ref before it reaches the subprocess.
 */

/** Thrown when a docker image reference is refused (option-like or malformed). */
export class InvalidDockerImageRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDockerImageRefError";
  }
}

// Characters permitted in a docker image reference:
// [registry[:port]/]namespace/name[:tag][@digest]. First char must be
// alphanumeric so the ref cannot start with '-' (a docker flag) or '.'.
const ALLOWED_IMAGE_REF = /^[A-Za-z0-9][A-Za-z0-9._/:@+-]*$/;

/**
 * Validate a docker image reference for use as a `docker run` argument.
 * Throws InvalidDockerImageRefError for option-like (leading '-') or otherwise
 * malformed references (whitespace, shell metacharacters, control chars).
 */
export function assertValidDockerImageRef(image: string): void {
  if (typeof image !== "string" || image.trim().length === 0) {
    throw new InvalidDockerImageRefError("Docker image reference must be a non-empty string");
  }
  if (image.startsWith("-")) {
    throw new InvalidDockerImageRefError(`Docker image reference may not start with '-': ${image}`);
  }
  if (!ALLOWED_IMAGE_REF.test(image)) {
    throw new InvalidDockerImageRefError(`Docker image reference contains invalid characters: ${image}`);
  }
}
