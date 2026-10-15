import { computeBackoffDelay, type BackoffPolicy } from '../shared/backoff';
import type { FailureCode } from '../shared/failure-code';
import {
  InvalidLedgerEntryError,
  InvalidMoneyError,
  InvalidTransactionStateError,
  ReferenceRequiredError,
  UnexpectedReferenceError,
  UnsupportedTransactionKindError,
} from '../shared/errors';
import { newId } from '../shared/identifier';
import type { Money } from '../shared/money';
import { LedgerDirection, oppositeDirection } from '../wallet/ledger-direction';

export enum WagerTransactionKind {
  Opening = 'OPENING',
  Bet = 'BET',
  Win = 'WIN',
  Loss = 'LOSS',
  Refund = 'REFUND',
  Rollback = 'ROLLBACK',
}

export enum WagerTransactionStatus {
  Pending = 'PENDING',
  PendingReference = 'PENDING_REFERENCE',
  Processed = 'PROCESSED',
  Rejected = 'REJECTED',
  Failed = 'FAILED',
}

export const DEFAULT_REFERENCE_BACKOFF: BackoffPolicy = { baseMs: 2000, maxMs: 300_000 };

const TERMINAL_STATUSES: ReadonlySet<WagerTransactionStatus> = new Set([
  WagerTransactionStatus.Processed,
  WagerTransactionStatus.Rejected,
  WagerTransactionStatus.Failed,
]);

const REFERENCE_REQUIRING_KINDS: ReadonlySet<WagerTransactionKind> = new Set([
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
]);

const ALLOWED_REFERENCES: Record<WagerTransactionKind, readonly WagerTransactionKind[]> = {
  [WagerTransactionKind.Opening]: [],
  [WagerTransactionKind.Bet]: [],
  [WagerTransactionKind.Win]: [],
  [WagerTransactionKind.Loss]: [],
  [WagerTransactionKind.Refund]: [WagerTransactionKind.Bet],
  [WagerTransactionKind.Rollback]: [
    WagerTransactionKind.Bet,
    WagerTransactionKind.Win,
    WagerTransactionKind.Refund,
  ],
};

export interface CreateWagerTransactionProps {
  id?: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string | undefined;
  createdAt: Date;
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId: string | undefined;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId: string | undefined;
  failureCode: FailureCode | undefined;
  balanceAfter: Money | undefined;
  processedAt: Date | undefined;
  referenceAttempts: number;
  nextReferenceAttemptAt: Date | undefined;
}

/**
 * Aggregate de wager transaction. O ciclo de vida é uma pequena máquina de
 * estados:
 *
 *   PENDING ──▶ PROCESSED
 *      │  └────▶ PENDING_REFERENCE ──▶ PROCESSED
 *      │                │
 *      └────────────────┴────────────▶ REJECTED
 *                       └────────────▶ FAILED
 *
 * `PROCESSED`, `REJECTED` e `FAILED` são terminais. Qualquer tentativa de
 * transicionar a partir de um estado terminal lança
 * `InvalidTransactionStateError` — isso é um erro de programação, nunca um
 * caminho de negócio.
 */
export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _balanceAfter?: Money,
    private _processedAt?: Date,
    private _referenceAttempts = 0,
    private _nextReferenceAttemptAt?: Date,
  ) {}

  /** Factory pública — `OPENING` é reservado para o fluxo de criação da wallet. */
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    if (props.kind === WagerTransactionKind.Opening) {
      throw new UnsupportedTransactionKindError(props.kind);
    }
    return WagerTransaction.build(props, WagerTransactionStatus.Pending);
  }

  /** Factory interna usada apenas ao abrir uma wallet com saldo inicial. */
  static opening(props: CreateWagerTransactionProps): WagerTransaction {
    if (props.kind !== WagerTransactionKind.Opening) {
      throw new UnsupportedTransactionKindError(props.kind);
    }
    if (props.referenceExternalTransactionId !== undefined) {
      throw new ReferenceRequiredError(props.kind);
    }
    return WagerTransaction.build(props, WagerTransactionStatus.Pending);
  }

  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.balanceAfter,
      state.processedAt,
      state.referenceAttempts,
      state.nextReferenceAttemptAt,
    );
  }

  private static build(
    props: CreateWagerTransactionProps,
    status: WagerTransactionStatus,
  ): WagerTransaction {
    if (!props.money.isPositive()) {
      throw new InvalidMoneyError('transaction amount must be strictly positive', props.money.toString());
    }

    const requiresReference = REFERENCE_REQUIRING_KINDS.has(props.kind);
    if (requiresReference && props.referenceExternalTransactionId === undefined) {
      throw new ReferenceRequiredError(props.kind);
    }
    if (!requiresReference && props.referenceExternalTransactionId !== undefined) {
      throw new UnexpectedReferenceError(props.kind);
    }

    return new WagerTransaction(
      props.id ?? newId(),
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      props.createdAt,
      status,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get balanceAfter(): Money | undefined {
    return this._balanceAfter;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get referenceAttempts(): number {
    return this._referenceAttempts;
  }

  get nextReferenceAttemptAt(): Date | undefined {
    return this._nextReferenceAttemptAt;
  }

  // -- transições ------------------------------------------------------------

  markProcessed(referenceTransactionId: string | undefined, balanceAfter: Money, at: Date): void {
    this.assertNotTerminal('mark processed');
    if (this._status !== WagerTransactionStatus.Pending && this._status !== WagerTransactionStatus.PendingReference) {
      throw new InvalidTransactionStateError(this.id, this._status, 'mark processed');
    }

    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._balanceAfter = balanceAfter;
    this._processedAt = at;
    this._nextReferenceAttemptAt = undefined;
  }

  markPendingReference(at: Date): void {
    this.assertNotTerminal('mark pending reference');
    if (this._status !== WagerTransactionStatus.Pending) {
      throw new InvalidTransactionStateError(this.id, this._status, 'mark pending reference');
    }
    this._status = WagerTransactionStatus.PendingReference;
    this._processedAt = undefined;
    this._nextReferenceAttemptAt = at;
  }

  reject(code: FailureCode, at: Date): void {
    this.assertNotTerminal('reject');
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = at;
    this._nextReferenceAttemptAt = undefined;
  }

  fail(code: FailureCode, at: Date): void {
    this.assertNotTerminal('fail');
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = at;
    this._nextReferenceAttemptAt = undefined;
  }

  /**
   * Avança o contador de retries de referência e armazena o horário da próxima
   * tentativa, calculado com backoff exponencial.
   */
  scheduleReferenceRetry(now: Date, policy: BackoffPolicy = DEFAULT_REFERENCE_BACKOFF): void {
    this._referenceAttempts += 1;
    this._nextReferenceAttemptAt = new Date(now.getTime() + computeBackoffDelay(this._referenceAttempts, policy));
  }

  // -- consultas de domínio --------------------------------------------------

  isTerminal(): boolean {
    return TERMINAL_STATUSES.has(this._status);
  }

  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  requiresReference(): boolean {
    return REFERENCE_REQUIRING_KINDS.has(this.kind);
  }

  isReversal(): boolean {
    return this.kind === WagerTransactionKind.Refund || this.kind === WagerTransactionKind.Rollback;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  canReference(reference: WagerTransaction): boolean {
    return ALLOWED_REFERENCES[this.kind].includes(reference.kind);
  }

  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
      case WagerTransactionKind.Refund:
        return LedgerDirection.Credit;
      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;
      case WagerTransactionKind.Rollback: {
        if (reference === undefined) {
          throw new ReferenceRequiredError(this.kind);
        }
        return oppositeDirection(reference.ledgerDirectionFor());
      }
      case WagerTransactionKind.Loss:
        throw new InvalidLedgerEntryError('LOSS transactions do not produce ledger entries');
    }
  }

  private assertNotTerminal(attemptedTransition: string): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(this.id, this._status, attemptedTransition);
    }
  }
}
