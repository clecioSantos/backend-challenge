import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { NestFactory } from '@nestjs/core';
import { MikroORM } from '@mikro-orm/postgresql';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/http/filters/all-exceptions.filter';

let app: INestApplication;
let orm: MikroORM;
let baseUrl: string;

interface ApiResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

async function api(path: string, init?: RequestInit): Promise<ApiResponse> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body: unknown;
  try {
    body = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

function jsonRequest(method: string, body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

async function createWallet(amount = '1000.00'): Promise<{ id: string; playerId: string }> {
  const playerId = crypto.randomUUID();
  const response = await api('/wallets', jsonRequest('POST', { playerId, initialBalance: { amount, currency: 'BRL' } }));
  expect(response.status).toBe(201);
  return { id: (response.body as { id: string }).id, playerId };
}

beforeAll(async () => {
  process.env.SQS_POLL_ENABLED = 'false';
  process.env.OUTBOX_POLL_INTERVAL_MS = '3600000';
  process.env.PENDING_REFERENCE_POLL_INTERVAL_MS = '3600000';
  process.env.LOG_LEVEL = 'silent';

  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(0, '127.0.0.1');

  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  orm = app.get(MikroORM);
  await orm.getMigrator().up();
  await orm.em
    .getConnection()
    .execute(
      'truncate table "wallet_ledger_entries", "wager_transactions", "outbox_messages", "inbox_messages", "wallets" cascade',
    );
});

afterAll(async () => {
  await app.close();
});

describe('health and metrics', () => {
  it('GET /health/live responde 200', async () => {
    const response = await api('/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready responde 200 com Postgres e SQS alcançáveis', async () => {
    const response = await api('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', checks: { postgres: true, sqs: true } });
  });

  it('GET /metrics expõe métricas em formato Prometheus', async () => {
    const response = await api('/metrics');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(typeof response.body).toBe('string');
  });
});

describe('wallets endpoint', () => {
  it('POST /wallets cria a wallet com saldo inicial e versão 1', async () => {
    const playerId = crypto.randomUUID();
    const response = await api(
      '/wallets',
      jsonRequest('POST', { playerId, initialBalance: { amount: '1000.00', currency: 'BRL' } }),
    );

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      playerId,
      balance: { amount: '1000.00', currency: 'BRL' },
      version: 1,
    });
  });

  it('POST /wallets duplicada responde 409', async () => {
    const { playerId } = await createWallet();
    const response = await api(
      '/wallets',
      jsonRequest('POST', { playerId, initialBalance: { amount: '10.00', currency: 'BRL' } }),
    );

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: { code: 'WALLET_ALREADY_EXISTS' } });
  });

  it('GET /wallets/:walletId inexistente responde 404', async () => {
    const response = await api(`/wallets/${crypto.randomUUID()}`);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'WALLET_NOT_FOUND' } });
  });

  it('GET /wallets/:walletId/ledger lista o crédito de abertura', async () => {
    const wallet = await createWallet('500.00');
    const response = await api(`/wallets/${wallet.id}/ledger?limit=10`);

    expect(response.status).toBe(200);
    const body = response.body as { entries: { direction: string }[]; nextCursor: string | null };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.direction).toBe('CREDIT');
    expect(body.nextCursor).toBeNull();
  });

  it('POST /wallets/:walletId/reconciliation responde consistente', async () => {
    const wallet = await createWallet('500.00');
    const response = await api(`/wallets/${wallet.id}/reconciliation`, { method: 'POST' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      storedBalance: { amount: '500.00', currency: 'BRL' },
      calculatedBalance: { amount: '500.00', currency: 'BRL' },
      consistent: true,
      checkedEntries: 1,
    });
  });
});

describe('wagering endpoint', () => {
  function bet(walletId: string, playerId: string, externalTransactionId: string, amount: string) {
    return {
      providerId: 'provider-a',
      externalTransactionId,
      playerId,
      walletId,
      roundId: 'round-http',
      gameId: 'fortune-chimp',
      kind: 'BET',
      money: { amount, currency: 'BRL' },
    };
  }

  it('POST /wagering/transactions sem Idempotency-Key responde 400', async () => {
    const wallet = await createWallet();
    const response = await api(
      '/wagering/transactions',
      jsonRequest('POST', bet(wallet.id, wallet.playerId, 'no-key', '10.00')),
    );

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('processa uma aposta, replica o replay e rejeita por saldo insuficiente com os status corretos', async () => {
    const wallet = await createWallet('100.00');

    const first = await api(
      '/wagering/transactions',
      jsonRequest('POST', bet(wallet.id, wallet.playerId, 'http-1', '80.00'), {
        'Idempotency-Key': 'provider-a:http-1',
      }),
    );
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      status: 'PROCESSED',
      idempotentReplay: false,
      balance: { amount: '20.00', currency: 'BRL' },
    });

    const replay = await api(
      '/wagering/transactions',
      jsonRequest('POST', bet(wallet.id, wallet.playerId, 'http-1', '80.00'), {
        'Idempotency-Key': 'provider-a:http-1',
      }),
    );
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ idempotentReplay: true, balance: { amount: '20.00', currency: 'BRL' } });

    const insufficient = await api(
      '/wagering/transactions',
      jsonRequest('POST', bet(wallet.id, wallet.playerId, 'http-2', '50.00'), {
        'Idempotency-Key': 'provider-a:http-2',
      }),
    );
    expect(insufficient.status).toBe(422);
    expect(insufficient.body).toMatchObject({ status: 'REJECTED', failureCode: 'INSUFFICIENT_FUNDS' });
  });

  it('mesma Idempotency-Key com payload diferente responde 409', async () => {
    const wallet = await createWallet('100.00');

    await api(
      '/wagering/transactions',
      jsonRequest('POST', bet(wallet.id, wallet.playerId, 'conflict-1', '10.00'), {
        'Idempotency-Key': 'provider-a:conflict-1',
      }),
    );

    const conflict = await api(
      '/wagering/transactions',
      jsonRequest('POST', bet(wallet.id, wallet.playerId, 'conflict-1', '20.00'), {
        'Idempotency-Key': 'provider-a:conflict-1',
      }),
    );
    expect(conflict.status).toBe(409);
    expect(conflict.body).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
  });

  it('aceita um payload válido mas com corpo JSON inválido respondendo 400', async () => {
    const response = await api('/wagering/transactions', jsonRequest('POST', '{not json', { 'Idempotency-Key': 'x' }));
    expect(response.status).toBe(400);
  });

  it('GET /wagering/transactions/:id e /providers/:provider/wagering/transactions/:externalId', async () => {
    const wallet = await createWallet('100.00');
    const created = await api(
      '/wagering/transactions',
      jsonRequest('POST', bet(wallet.id, wallet.playerId, 'lookup-1', '10.00'), {
        'Idempotency-Key': 'provider-a:lookup-1',
      }),
    );
    const transactionId = (created.body as { transactionId: string }).transactionId;

    const byId = await api(`/wagering/transactions/${transactionId}`);
    expect(byId.status).toBe(200);
    expect(byId.body).toMatchObject({ transactionId, status: 'PROCESSED' });

    const byProvider = await api('/providers/provider-a/wagering/transactions/lookup-1');
    expect(byProvider.status).toBe(200);
    expect(byProvider.body).toMatchObject({ transactionId, externalTransactionId: 'lookup-1' });
  });

  it('GET /providers/:provider/wagering/transactions/:externalId inexistente responde 404', async () => {
    const response = await api('/providers/provider-a/wagering/transactions/missing');
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'WAGER_TRANSACTION_NOT_FOUND' } });
  });
});
