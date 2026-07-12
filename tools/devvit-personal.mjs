import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const USAGE = `
Usage:
  npm run init:personal -- --app <your-devvit-app-name>
  npm run dev:personal -- --app <your-devvit-app-name> [subreddit]
  npm run upload:personal -- --app <your-devvit-app-name>

Options:
  --app, -a         Devvit app name to use in the generated local config.
                   You can also set DEVVIT_APP_NAME.
  --subreddit, -s   Test subreddit for playtest. You can also set
                   DEVVIT_TEST_SUBREDDIT or pass it as a positional argument.
  --dry-run         Generate the local config and print the Devvit command
                   without running it.
  --                Pass any following flags through to the Devvit CLI.
`;

const command = process.argv[2];
const rawArgs = process.argv.slice(3);
const allowedCommands = new Set(["init", "playtest", "upload"]);

if (!allowedCommands.has(command)) {
  console.error(USAGE.trim());
  process.exit(1);
}

let appName = process.env.DEVVIT_APP_NAME ?? "";
let subreddit = process.env.DEVVIT_TEST_SUBREDDIT ?? "";
let positionalSubreddit = "";
let dryRun = false;
const devvitArgs = [];

for (let i = 0; i < rawArgs.length; i += 1) {
  const arg = rawArgs[i];

  if (arg === "--") {
    devvitArgs.push(...rawArgs.slice(i + 1));
    break;
  }

  if (arg === "--app" || arg === "-a") {
    appName = rawArgs[i + 1] ?? "";
    i += 1;
    continue;
  }

  if (arg.startsWith("--app=")) {
    appName = arg.slice("--app=".length);
    continue;
  }

  if (arg === "--subreddit" || arg === "-s") {
    subreddit = rawArgs[i + 1] ?? "";
    i += 1;
    continue;
  }

  if (arg.startsWith("--subreddit=")) {
    subreddit = arg.slice("--subreddit=".length);
    continue;
  }

  if (arg === "--dry-run") {
    dryRun = true;
    continue;
  }

  if (command === "playtest" && !arg.startsWith("-") && !positionalSubreddit) {
    positionalSubreddit = arg;
    continue;
  }

  devvitArgs.push(arg);
}

if (!appName) {
  console.error("Missing personal Devvit app name.");
  console.error(USAGE.trim());
  process.exit(1);
}

if (!/^[a-z][a-z0-9-]{2,29}$/.test(appName)) {
  console.error(
    "Use a lowercase app name that starts with a letter and contains only letters, numbers, or hyphens.",
  );
  process.exit(1);
}

const sourceConfigPath = resolve("devvit.json");
const localConfigFile = ".devvit.local.json";
const localConfigPath = resolve(localConfigFile);

if (!existsSync(sourceConfigPath)) {
  console.error(`Could not find ${sourceConfigPath}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(sourceConfigPath, "utf8"));
config.name = appName;

const playtestSubreddit = subreddit || positionalSubreddit;

if (playtestSubreddit) {
  config.dev = {
    ...(config.dev ?? {}),
    subreddit: playtestSubreddit,
  };
}

writeFileSync(localConfigPath, `${JSON.stringify(config, null, 2)}\n`);

const args = ["devvit", command];

if (command === "playtest" && playtestSubreddit) {
  args.push(playtestSubreddit);
}

args.push("--config", localConfigFile, ...devvitArgs);

if (command === "init" && !devvitArgs.includes("--force")) {
  args.push("--force");
}

console.log(`Using local Devvit config: ${localConfigPath}`);
console.log(`Personal Devvit app: ${appName}`);
if (playtestSubreddit) {
  console.log(`Playtest subreddit: ${playtestSubreddit}`);
}

if (dryRun) {
  console.log(`Command: npx ${args.join(" ")}`);
  process.exit(0);
}

const result = spawnSync("npx", args, {
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
