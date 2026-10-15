/**
 * Injection tokens for the application's outbound ports. Keeping them here
 * (instead of decorating the interfaces) preserves the rule that the
 * application layer does not depend on the DI framework.
 */
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
export const CLOCK = Symbol('CLOCK');
export const MESSAGE_PUBLISHER = Symbol('MESSAGE_PUBLISHER');
export const METRICS = Symbol('METRICS');
export const PROVIDER_IDENTITY = Symbol('PROVIDER_IDENTITY');
