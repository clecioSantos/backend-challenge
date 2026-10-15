import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';

/**
 * Structured JSON logging.
 *
 * The pino config is intentionally shared between HTTP requests and worker
 * logs. `genReqId` propagates an inbound correlation id or mints one, and the
 * redaction list keeps financial payloads and credentials out of the logs.
 */
export function buildLoggerParams(level: string, appName: string): Params {
  return {
    pinoHttp: {
      name: appName,
      level,
      genReqId: (req, res) => {
        const header = req.headers['x-correlation-id'];
        const correlationId = Array.isArray(header) ? header[0] : header;
        const id = correlationId ?? randomUUID();
        res.setHeader('x-correlation-id', id);
        return id;
      },
      customProps: (req) => ({
        correlationId: req.id,
      }),
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'req.body.money',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      autoLogging: {
        ignore: (req) => req.url === '/health/live' || req.url === '/health/ready',
      },
    },
  };
}
