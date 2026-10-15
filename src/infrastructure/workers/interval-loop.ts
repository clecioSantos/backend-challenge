function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface IntervalLoop {
  /** Stops scheduling new runs and resolves once the current run has finished. */
  stop(): Promise<void>;
}

export interface IntervalLoopOptions {
  intervalMs: number;
  run: () => Promise<void>;
  onError: (error: unknown) => void;
}

/**
 * Small cooperative scheduler for background workers. Runs `task` every
 * `intervalMs`, never overlapping two runs, and stops cleanly within one
 * interval so shutdown cannot hang.
 */
export function startIntervalLoop(options: IntervalLoopOptions): IntervalLoop {
  let running = true;
  let pending: Promise<void> = Promise.resolve();

  const schedule = (): void => {
    pending = delay(options.intervalMs).then(async () => {
      if (!running) {
        return;
      }
      try {
        await options.run();
      } catch (error) {
        options.onError(error);
      }
      schedule();
    });
  };

  schedule();

  return {
    async stop(): Promise<void> {
      running = false;
      await pending;
    },
  };
}
