#!/usr/bin/env node
import * as prompts from "@clack/prompts";
import { runDoctor } from "./setup/doctor.mjs";
import { runLocalDockerStack } from "./setup/run.mjs";
import { runSetupWizard } from "./setup/setup-flow.mjs";
import { kaveroBanner, printDoctorResult } from "./setup/ui.mjs";

function printHelp() {
  console.log(kaveroBanner());
  console.log("");
  console.log("Usage:");
  console.log("  pnpm kavero setup");
  console.log("  pnpm kavero doctor [local-docker|cloud-self-host]");
  console.log("  pnpm kavero run");
  console.log("");
  console.log("Shortcuts:");
  console.log("  pnpm setup");
  console.log("  pnpm setup:doctor");
  console.log("  pnpm setup:run");
}

async function main() {
  const command = process.argv[2] ?? "help";

  if (command === "setup") {
    await runSetupWizard({ prompts });
    return;
  }

  if (command === "doctor") {
    const profileId = process.argv[3] ?? "local-docker";
    const result = runDoctor({ profileId });
    printDoctorResult(result);
    process.exitCode = result.summary.ok ? 0 : 1;
    return;
  }

  if (command === "run") {
    const result = runLocalDockerStack();
    process.exitCode = result.status ?? 1;
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
