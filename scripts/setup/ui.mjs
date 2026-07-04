const reset = "\x1b[0m";
const cyan = "\x1b[36m";
const dim = "\x1b[2m";
const red = "\x1b[31m";
const yellow = "\x1b[33m";
const green = "\x1b[32m";

export function kaveroBanner() {
  return [
    `${cyan} _  __    _    __     _______ ____   ___  `,
    `| |/ /   / \\   \\ \\   / / ____|  _ \\ / _ \\ `,
    `| ' /   / _ \\   \\ \\ / /|  _| | |_) | | | |`,
    `| . \\  / ___ \\   \\ V / | |___|  _ <| |_| |`,
    `|_|\\_\\/_/   \\_\\   \\_/  |_____|_| \\_\\\\___/ ${reset}`,
    `${dim}setup for cloud, self-host, and local Docker${reset}`,
  ].join("\n");
}

export function formatCheck(check) {
  const icon = check.status === "pass" ? "[ok]" : check.status === "warn" ? "[warn]" : "[fail]";
  const color = check.status === "pass" ? green : check.status === "warn" ? yellow : red;
  return `${color}${icon}${reset} ${check.label}: ${check.message}`;
}

export function printDoctorResult(result) {
  console.log(kaveroBanner());
  console.log("");
  for (const item of result.checks) {
    console.log(formatCheck(item));
  }
  console.log("");
  if (result.summary.ok) {
    console.log(`${green}Ready.${reset} ${result.summary.total} checks passed or warned.`);
  } else {
    console.log(`${red}Needs attention.${reset} ${result.summary.failed} check(s) failed.`);
  }
}
