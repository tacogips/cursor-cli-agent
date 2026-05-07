import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

import { SessionIndexRepository } from "../persistence/session-index";
import { createHttpRouteHandler } from "./routes";
import type { HttpServerConfig, HttpServerHandle } from "./types";

async function resolveListenPort(port: number, host: string): Promise<number> {
  if (port !== 0) {
    return port;
  }
  return await new Promise<number>((resolvePort, rejectPort) => {
    const probe = createServer();
    probe.once("error", rejectPort);
    probe.listen(0, host, () => {
      const address = probe.address();
      probe.close((error) => {
        if (error !== undefined) {
          rejectPort(error);
          return;
        }
        if (typeof address === "object" && address !== null) {
          resolvePort(address.port);
          return;
        }
        rejectPort(new Error("failed to allocate server port"));
      });
    });
  });
}

export async function startHttpServer(
  config: HttpServerConfig,
): Promise<HttpServerHandle> {
  mkdirSync(config.dataDir, { recursive: true });
  const sessions = new SessionIndexRepository(join(config.dataDir, "state.db"));
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    const startedAt = new Date();
    const listenPort = await resolveListenPort(config.port, config.host);
    server = Bun.serve({
      hostname: config.host,
      port: listenPort,
      fetch: createHttpRouteHandler({ config, startedAt, sessions }),
    });
  } catch (error) {
    sessions.close();
    throw error;
  }
  const host = server.hostname;
  const port = server.port;
  return {
    host,
    port,
    url: `http://${host}:${port}`,
    async stop(): Promise<void> {
      server.stop(true);
      sessions.close();
    },
  };
}
