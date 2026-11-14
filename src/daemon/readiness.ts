import type {
  DaemonReadinessOptions,
  DaemonReadinessResult,
} from "../types/daemon";

export interface DaemonReadinessProbe {
  waitUntilReady(
    options: DaemonReadinessOptions,
  ): Promise<DaemonReadinessResult>;
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

export function createHttpDaemonReadinessProbe(): DaemonReadinessProbe {
  return {
    async waitUntilReady(
      options: DaemonReadinessOptions,
    ): Promise<DaemonReadinessResult> {
      const deadline = Date.now() + options.timeoutMs;
      let lastError: string | undefined;
      while (Date.now() <= deadline) {
        try {
          const headers = new Headers();
          if (options.token !== undefined) {
            headers.set("authorization", `Bearer ${options.token}`);
          }
          const response = await fetch(`${options.baseUrl}/api/health`, {
            method: "GET",
            headers,
          });
          if (response.ok) {
            return { ready: true, statusCode: response.status };
          }
          if (response.status === 401 || response.status === 403) {
            return {
              ready: false,
              reason: "unauthorized",
              statusCode: response.status,
            };
          }
          lastError = `HTTP ${response.status}`;
        } catch (error) {
          lastError =
            error instanceof Error ? error.message : "health probe failed";
        }
        await sleep(options.intervalMs);
      }
      return {
        ready: false,
        reason: "timeout",
        ...(lastError !== undefined ? { error: lastError } : {}),
      };
    },
  };
}
