import { z } from 'zod';
import { WagerTransactionKind } from '../../../domain/wager-transaction/wager-transaction';

const moneySchema = z.object({
  amount: z.string().min(1),
  currency: z.string().min(1),
});

const wagerTransactionRequestedDataSchema = z.object({
  providerId: z.string().min(1).max(64),
  externalTransactionId: z.string().min(1).max(128),
  idempotencyKey: z.string().min(1).max(256).optional(),
  playerId: z.string().min(1),
  walletId: z.string().min(1),
  roundId: z.string().min(1).max(128),
  gameId: z.string().min(1).max(128),
  kind: z.nativeEnum(WagerTransactionKind),
  money: moneySchema,
  referenceExternalTransactionId: z.string().min(1).max(128).optional(),
});

const envelopeSchema = z.object({
  messageId: z.string().min(1),
  type: z.literal('WagerTransactionRequested'),
  occurredAt: z.string().min(1),
  data: wagerTransactionRequestedDataSchema,
});

export type WagerTransactionRequestedData = z.infer<typeof wagerTransactionRequestedDataSchema>;
export type WagerTransactionRequestedEnvelope = z.infer<typeof envelopeSchema>;

/**
 * Parses and validates the inbound SQS body. Invalid messages are a permanent
 * condition: the caller should route them to the DLQ instead of retrying.
 */
export function parseWagerTransactionRequested(raw: string): WagerTransactionRequestedEnvelope {
  const json: unknown = JSON.parse(raw);
  return envelopeSchema.parse(json);
}
