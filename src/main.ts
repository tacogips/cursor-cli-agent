#!/usr/bin/env bun
/**
 * curort-cli-agent CLI entry point.
 */

import { runCli } from "./cli/cli";

async function main(): Promise<void> {
  const code = await runCli(process.argv);
  process.exitCode = code;
}

void main();
