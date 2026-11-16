import type { Config } from './config.js';

export interface SimulatorControl {
  state(): { enabled: boolean; intervalSeconds: number };
  configure(enabled: boolean, intervalSeconds?: number): void;
  stop(): void;
}

export function createSimulator(config: Config): SimulatorControl {
  let enabled = false;
  let intervalSeconds = config.simulatorIntervalSeconds;
  return {
    state: () => ({ enabled, intervalSeconds }),
    configure(nextEnabled, nextInterval) {
      enabled = nextEnabled;
      if (nextInterval !== undefined) intervalSeconds = nextInterval;
    },
    stop() {
      enabled = false;
    },
  };
}
