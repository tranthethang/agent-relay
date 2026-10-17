import { Command } from "commander";
import { registerCommands } from "./cli/commands.js";
import { reportFailure } from "./cli/fail.js";
import { writeResult } from "./cli/output.js";
import { schemaVersion } from "./core/vocab.js";
import { packageVersion, versionText } from "./version.js";

const json = process.argv.includes("--json");
const program = new Command();
program.name("atry");
program.exitOverride();
program.configureOutput({
  outputError() {
    // reportFailure prints commander errors.
  },
  writeErr(text) {
    // Help for a missing subcommand goes to stderr. Under --json it is dropped.
    if (!json) process.stderr.write(text);
  },
});
program.option("--json", "print JSON");
program.option("--run <run>", "run id, slug, name, or path");

program
  .command("version")
  .description("Print the version")
  .action((_opts, command: Command) => {
    const version = packageVersion();
    const json = command.optsWithGlobals().json === true;
    writeResult({ schema: schemaVersion, version }, json, (row) => versionText(row.version));
  });

registerCommands(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  process.exitCode = reportFailure(error, json);
}
