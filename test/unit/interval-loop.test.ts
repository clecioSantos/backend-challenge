import { describe, expect, it } from 'bun:test';
import { startIntervalLoop } from '../../src/infrastructure/workers/interval-loop';

describe('startIntervalLoop', () => {
  it('para de agendar após stop() e resolve quando a execução em andamento termina', async () => {
    let runs = 0;
    let completed = 0;

    const loop = startIntervalLoop({
      intervalMs: 10,
      run: async () => {
        runs += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        completed += 1;
      },
      onError: () => {},
    });

    await new Promise((resolve) => setTimeout(resolve, 15)); // primeira execução em andamento
    await loop.stop();
    const runsAtStop = runs;

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(runsAtStop).toBeGreaterThan(0);
    expect(runs).toBe(runsAtStop);
    expect(completed).toBe(runsAtStop);
  });

  it('não sobrepõe execuções: cada run só começa após o anterior terminar', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const loop = startIntervalLoop({
      intervalMs: 1,
      run: async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((resolve) => setTimeout(resolve, 20));
        concurrent -= 1;
      },
      onError: () => {},
    });

    await new Promise((resolve) => setTimeout(resolve, 70));
    await loop.stop();

    expect(maxConcurrent).toBe(1);
  });

  it('reporta erros sem interromper o loop', async () => {
    let errors = 0;
    let runs = 0;

    const loop = startIntervalLoop({
      intervalMs: 5,
      run: async () => {
        runs += 1;
        throw new Error('boom');
      },
      onError: () => {
        errors += 1;
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 40));
    await loop.stop();

    expect(runs).toBeGreaterThan(0);
    expect(errors).toBe(runs);
  });

  it('stop() resolve imediatamente quando não há execução em andamento, mesmo com intervalo longo', async () => {
    const loop = startIntervalLoop({
      intervalMs: 3_600_000,
      run: async () => {},
      onError: () => {},
    });

    const startedAt = Date.now();
    await loop.stop();
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
