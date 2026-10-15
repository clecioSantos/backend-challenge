import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CreateWalletUseCase } from '../../application/use-cases/create-wallet.use-case';
import { GetWalletUseCase } from '../../application/use-cases/get-wallet.use-case';
import { ListWalletLedgerUseCase } from '../../application/use-cases/list-wallet-ledger.use-case';
import { ReconcileWalletUseCase } from '../../application/use-cases/reconcile-wallet.use-case';
import {
  type CreateWalletDto,
  createWalletSchema,
  type LedgerQueryDto,
  ledgerQuerySchema,
} from '../dto/http.schemas';
import { ProviderIdentityGuard } from '../guards/provider-identity.guard';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

@Controller('wallets')
@UseGuards(ProviderIdentityGuard)
export class WalletsController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
    private readonly listLedger: ListWalletLedgerUseCase,
    private readonly reconcile: ReconcileWalletUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body(new ZodValidationPipe(createWalletSchema)) dto: CreateWalletDto) {
    const result = await this.createWallet.execute(dto);

    return {
      id: result.id,
      playerId: result.playerId,
      balance: result.balance.toJSON(),
      version: result.version,
    };
  }

  @Get(':walletId')
  async findOne(@Param('walletId') walletId: string) {
    const wallet = await this.getWallet.execute(walletId);

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  @Get(':walletId/ledger')
  async ledger(
    @Param('walletId') walletId: string,
    @Query(new ZodValidationPipe(ledgerQuerySchema)) query: LedgerQueryDto,
  ) {
    const page = await this.listLedger.execute({ walletId, cursor: query.cursor, limit: query.limit });

    return {
      entries: page.entries.map((entry) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor: page.nextCursor,
    };
  }

  @Post(':walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  async reconciliation(@Param('walletId') walletId: string) {
    const result = await this.reconcile.execute(walletId);

    return {
      walletId: result.walletId,
      storedBalance: result.storedBalance.toJSON(),
      calculatedBalance: result.calculatedBalance.toJSON(),
      difference: result.difference.toJSON(),
      consistent: result.consistent,
      checkedEntries: result.checkedEntries,
    };
  }
}
