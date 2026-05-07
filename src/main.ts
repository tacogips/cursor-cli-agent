import { runCli } from "./cli/cli";

export async function main(argv: readonly string[]): Promise<number> {
  return runCli([...argv]);
}

if (import.meta.main) {
  void main(process.argv).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
