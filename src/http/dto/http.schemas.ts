import { z } from 'zod';
import { WagerTransactionKind } from '../../domain/wager-transaction/wager-transaction';

export const moneySchema = z.object({
  amount: z.string().min(1),
  currency: z.string().length(3),
});

export const createWalletSchema = z.object({
  playerId: z.string().uuid(),
  initialBalance: moneySchema,
});
export type CreateWalletDto = z.infer<typeof createWalletSchema>;

export const ledgerQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type LedgerQueryDto = z.infer<typeof ledgerQuerySchema>;

export const submitWagerTransactionSchema = z
  .object({
    providerId: z.string().min(1).max(64),
    externalTransactionId: z.string().min(1).max(128),
    playerId: z.string().uuid(),
    walletId: z.string().uuid(),
    roundId: z.string().min(1).max(128),
    gameId: z.string().min(1).max(128),
    kind: z.nativeEnum(WagerTransactionKind),
    money: moneySchema,
    referenceExternalTransactionId: z.string().min(1).max(128).optional(),
  })
  .refine((value) => value.kind !== WagerTransactionKind.Opening, {
    path: ['kind'],
    message: 'OPENING is an internal kind and cannot be submitted',
  });
export type SubmitWagerTransactionDto = z.infer<typeof submitWagerTransactionSchema>;
