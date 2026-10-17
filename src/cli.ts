import { Command } from "commander";
import { packageVersion, versionJson, versionText } from "./version.js";

const program = new Command();
program.name("atry");

program
  .command("version")
  .description("Print the version")
  .option("--json", "print JSON")
  .action((opts: { json?: boolean }) => {
    const version = packageVersion();
    if (opts.json === true) {
      process.stdout.write(versionJson(version));
      return;
    }
    process.stdout.write(versionText(version));
  });

program.parse();
