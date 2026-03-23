/**
 * cursor-cli-agent - Main entry point
 *
 * cursor-cli-agent
 */

import { greet } from "./lib";

function main(): void {
  const message = greet("World");
  console.log(message);
}

main();
