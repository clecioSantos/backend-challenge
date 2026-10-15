import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { GetProviderWagerTransactionUseCase } from '../../application/use-cases/get-wager-transaction.use-case';
import { ProviderIdentityGuard } from '../guards/provider-identity.guard';

@Controller('providers')
@UseGuards(ProviderIdentityGuard)
export class ProvidersController {
  constructor(private readonly getProviderTransaction: GetProviderWagerTransactionUseCase) {}

  @Get(':providerId/wagering/transactions/:externalTransactionId')
  async findOne(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    const transaction = await this.getProviderTransaction.execute(providerId, externalTransactionId);

    return {
      transactionId: transaction.transactionId,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      walletId: transaction.walletId,
      status: transaction.status,
      kind: transaction.kind,
      money: transaction.money.toJSON(),
      failureCode: transaction.failureCode ?? null,
      balanceAfter: transaction.balanceAfter?.toJSON() ?? null,
      createdAt: transaction.createdAt.toISOString(),
      processedAt: transaction.processedAt?.toISOString() ?? null,
    };
  }
}
