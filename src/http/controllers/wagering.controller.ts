import {
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ProcessWagerTransactionUseCase,
  type ProcessWagerTransactionOutcome,
} from '../../application/use-cases/process-wager-transaction.use-case';
import { GetWagerTransactionUseCase } from '../../application/use-cases/get-wager-transaction.use-case';
import { RequestValidationError } from '../errors/request-validation.error';
import {
  type SubmitWagerTransactionDto,
  submitWagerTransactionSchema,
} from '../dto/http.schemas';
import { ProviderIdentityGuard } from '../guards/provider-identity.guard';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe';

@Controller('wagering/transactions')
@UseGuards(ProviderIdentityGuard)
export class WageringController {
  constructor(
    private readonly processWagerTransaction: ProcessWagerTransactionUseCase,
    private readonly getTransaction: GetWagerTransactionUseCase,
  ) {}

  @Post()
  async submit(
    @Body(new ZodValidationPipe(submitWagerTransactionSchema)) dto: SubmitWagerTransactionDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request & { id?: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!idempotencyKey) {
      throw new RequestValidationError('The Idempotency-Key header is required');
    }

    const outcome = await this.processWagerTransaction.execute({
      ...dto,
      idempotencyKey,
      correlationId: request.id ?? idempotencyKey,
    });

    response.status(this.statusFor(outcome));
    return this.body(outcome);
  }

  @Get(':transactionId')
  async findOne(@Param('transactionId') transactionId: string) {
    const transaction = await this.getTransaction.execute(transactionId);

    return {
      transactionId: transaction.transactionId,
      providerId: transaction.providerId,
      externalTransactionId: transaction.externalTransactionId,
      walletId: transaction.walletId,
      playerId: transaction.playerId,
      roundId: transaction.roundId,
      gameId: transaction.gameId,
      kind: transaction.kind,
      status: transaction.status,
      money: transaction.money.toJSON(),
      referenceTransactionId: transaction.referenceTransactionId ?? null,
      referenceExternalTransactionId: transaction.referenceExternalTransactionId ?? null,
      failureCode: transaction.failureCode ?? null,
      balanceAfter: transaction.balanceAfter?.toJSON() ?? null,
      createdAt: transaction.createdAt.toISOString(),
      processedAt: transaction.processedAt?.toISOString() ?? null,
    };
  }

  private statusFor(outcome: ProcessWagerTransactionOutcome): HttpStatus {
    switch (outcome.outcome) {
      case 'processed':
        return HttpStatus.OK;
      case 'pending_reference':
        return HttpStatus.ACCEPTED;
      case 'rejected':
        return HttpStatus.UNPROCESSABLE_ENTITY;
      case 'failed':
        return HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }

  private body(outcome: ProcessWagerTransactionOutcome): Record<string, unknown> {
    const base = {
      transactionId: outcome.transactionId,
      status: outcome.status,
      idempotentReplay: outcome.idempotentReplay,
    };

    if (outcome.outcome === 'processed') {
      return { ...base, balance: outcome.balance.toJSON() };
    }
    if (outcome.outcome === 'rejected' || outcome.outcome === 'failed') {
      return { ...base, failureCode: outcome.failureCode };
    }
    return base;
  }
}
