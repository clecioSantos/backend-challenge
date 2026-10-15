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
 * Faz o parse e valida o corpo SQS de entrada. Mensagens inválidas são uma
 * condição permanente: o chamador deve encaminhá-las para a DLQ em vez de
 * tentar novamente.
 */
export function parseWagerTransactionRequested(raw: string): WagerTransactionRequestedEnvelope {
  const json: unknown = JSON.parse(raw);
  return envelopeSchema.parse(json);
}
