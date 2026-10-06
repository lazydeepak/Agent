import { runCli } from "./cli.js";

await runCli(process.argv.slice(2));

// Playwright's CDP transport can retain a socket after a one-shot command has
// completed. The CLI owns this process, so exit once runCli has fully settled;
// watch/runtime commands do not settle until their normal stop path completes.
process.exit(process.exitCode ?? 0);
