/** Fonte de tempo injetável. Mantém os use cases determinísticos em testes. */
export interface Clock {
  now(): Date;
}
