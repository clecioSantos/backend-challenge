/** Injectable time source. Keeps use cases deterministic under test. */
export interface Clock {
  now(): Date;
}
