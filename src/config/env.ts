import { z } from 'zod';

const booleanFromString = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(defaultValue)
    .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().default('wagering-processor'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  DEFAULT_CURRENCY: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('BRL'),

  HTTP_PORT: z.coerce.number().int().positive().default(3000),
  HTTP_HOST: z.string().default('0.0.0.0'),

  DATABASE_HOST: z.string().default('localhost'),
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_USER: z.string().default('wagering'),
  DATABASE_PASSWORD: z.string().default('wagering'),
  DATABASE_NAME: z.string().default('wagering'),
  DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(1),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  DATABASE_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),

  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().default('test'),
  AWS_SECRET_ACCESS_KEY: z.string().default('test'),
  AWS_ENDPOINT: z.string().default('http://localhost:4566'),

  SQS_QUEUE_URL: z.string().default('http://localhost:4566/000000000000/wager-transactions.fifo'),
  SQS_DLQ_URL: z.string().default('http://localhost:4566/000000000000/wager-transactions-dlq.fifo'),
  SQS_EVENTS_QUEUE_URL: z.string().default('http://localhost:4566/000000000000/wager-events.fifo'),
  SQS_CONSUMER_NAME: z.string().default('wager-transactions-consumer'),
  SQS_WAIT_TIME_SECONDS: z.coerce.number().int().min(0).max(20).default(20),
  SQS_VISIBILITY_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
  SQS_MAX_RECEIVE_COUNT: z.coerce.number().int().positive().default(5),
  SQS_BATCH_SIZE: z.coerce.number().int().min(1).max(10).default(10),
  SQS_POLL_ENABLED: booleanFromString('true'),

  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).default(50),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
  OUTBOX_BASE_BACKOFF_MS: z.coerce.number().int().positive().default(1000),
  OUTBOX_MAX_BACKOFF_MS: z.coerce.number().int().positive().default(60_000),

  PENDING_REFERENCE_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  PENDING_REFERENCE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(8),
  PENDING_REFERENCE_BASE_BACKOFF_MS: z.coerce.number().int().positive().default(2000),
  PENDING_REFERENCE_MAX_BACKOFF_MS: z.coerce.number().int().positive().default(300_000),
});

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  name: string;
  poolMin: number;
  poolMax: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
}

export interface SqsConfig {
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  queueUrl: string;
  dlqUrl: string;
  eventsQueueUrl: string;
  consumerName: string;
  waitTimeSeconds: number;
  visibilityTimeoutSeconds: number;
  maxReceiveCount: number;
  batchSize: number;
  pollEnabled: boolean;
}

export interface OutboxConfig {
  pollIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

export interface PendingReferenceConfig {
  pollIntervalMs: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  appName: string;
  logLevel: string;
  defaultCurrency: string;
  http: { port: number; host: string };
  database: DatabaseConfig;
  sqs: SqsConfig;
  outbox: OutboxConfig;
  pendingReference: PendingReferenceConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    nodeEnv: parsed.NODE_ENV,
    appName: parsed.APP_NAME,
    logLevel: parsed.LOG_LEVEL,
    defaultCurrency: parsed.DEFAULT_CURRENCY,
    http: { port: parsed.HTTP_PORT, host: parsed.HTTP_HOST },
    database: {
      host: parsed.DATABASE_HOST,
      port: parsed.DATABASE_PORT,
      user: parsed.DATABASE_USER,
      password: parsed.DATABASE_PASSWORD,
      name: parsed.DATABASE_NAME,
      poolMin: parsed.DATABASE_POOL_MIN,
      poolMax: parsed.DATABASE_POOL_MAX,
      statementTimeoutMs: parsed.DATABASE_STATEMENT_TIMEOUT_MS,
      lockTimeoutMs: parsed.DATABASE_LOCK_TIMEOUT_MS,
    },
    sqs: {
      region: parsed.AWS_REGION,
      endpoint: parsed.AWS_ENDPOINT,
      accessKeyId: parsed.AWS_ACCESS_KEY_ID,
      secretAccessKey: parsed.AWS_SECRET_ACCESS_KEY,
      queueUrl: parsed.SQS_QUEUE_URL,
      dlqUrl: parsed.SQS_DLQ_URL,
      eventsQueueUrl: parsed.SQS_EVENTS_QUEUE_URL,
      consumerName: parsed.SQS_CONSUMER_NAME,
      waitTimeSeconds: parsed.SQS_WAIT_TIME_SECONDS,
      visibilityTimeoutSeconds: parsed.SQS_VISIBILITY_TIMEOUT_SECONDS,
      maxReceiveCount: parsed.SQS_MAX_RECEIVE_COUNT,
      batchSize: parsed.SQS_BATCH_SIZE,
      pollEnabled: parsed.SQS_POLL_ENABLED,
    },
    outbox: {
      pollIntervalMs: parsed.OUTBOX_POLL_INTERVAL_MS,
      batchSize: parsed.OUTBOX_BATCH_SIZE,
      maxAttempts: parsed.OUTBOX_MAX_ATTEMPTS,
      baseBackoffMs: parsed.OUTBOX_BASE_BACKOFF_MS,
      maxBackoffMs: parsed.OUTBOX_MAX_BACKOFF_MS,
    },
    pendingReference: {
      pollIntervalMs: parsed.PENDING_REFERENCE_POLL_INTERVAL_MS,
      maxAttempts: parsed.PENDING_REFERENCE_MAX_ATTEMPTS,
      baseBackoffMs: parsed.PENDING_REFERENCE_BASE_BACKOFF_MS,
      maxBackoffMs: parsed.PENDING_REFERENCE_MAX_BACKOFF_MS,
    },
  };
}
