import { runCli } from "./cli/cli";

export async function main(argv: readonly string[]): Promise<number> {
  return runCli([...argv]);
}
