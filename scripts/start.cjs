const { spawn } = require("child_process");
const path = require("path");

const nextBin = path.join(__dirname, "..", "node_modules", "next", "dist", "bin", "next");
const userArgs = process.argv.slice(2);
const npmPort = process.env.npm_config_port;

function isPositiveIntegerText(value) {
  return /^\d+$/.test(value) && Number(value) > 0;
}

function resolvePortFromNpmShorthand(args) {
  if (npmPort === undefined) return { port: undefined, remainingArgs: args };

  // npm run start --port=3334
  if (isPositiveIntegerText(String(npmPort))) {
    return { port: String(npmPort), remainingArgs: args };
  }

  // npm run start --port 3334 (npm sets npm_config_port=true and passes "3334" as argv)
  if (String(npmPort) === "true" && args.length > 0 && isPositiveIntegerText(args[0])) {
    return { port: args[0], remainingArgs: args.slice(1) };
  }

  return { port: undefined, remainingArgs: args };
}

function hasPortInArgs(args) {
  for (const a of args) {
    if (a === "-p" || a === "--port") return true;
    if (a.startsWith("--port=") || a.startsWith("-p=")) return true;
  }
  return false;
}

const hasPortEnv =
  process.env.PORT !== undefined && String(process.env.PORT).trim().length > 0;
const resolvedNpm = resolvePortFromNpmShorthand(userArgs);
const argsWithoutNpmPortValue = resolvedNpm.remainingArgs;
const hasNpmPort = resolvedNpm.port !== undefined;

const args = [nextBin, "start"];
if (!hasPortInArgs(argsWithoutNpmPortValue) && !hasPortEnv && hasNpmPort) {
  args.push("-p", resolvedNpm.port);
}
args.push(...argsWithoutNpmPortValue);

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code === null ? 1 : code);
});
