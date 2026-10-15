/**
 * Tokens de injeção para os ports de saída da aplicação. Mantê-los aqui
 * (em vez de decorar as interfaces) preserva a regra de que a
 * camada de aplicação não depende do framework de DI.
 */
export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');
export const CLOCK = Symbol('CLOCK');
export const MESSAGE_PUBLISHER = Symbol('MESSAGE_PUBLISHER');
export const METRICS = Symbol('METRICS');
export const PROVIDER_IDENTITY = Symbol('PROVIDER_IDENTITY');
