const { spawn } = require("child_process");
const path = require("path");

const nextBin = path.join(__dirname, "..", "node_modules", "next", "dist", "bin", "next");
const userArgs = process.argv.slice(2);

function hasPortInArgs(args) {
  for (const a of args) {
    if (a === "-p" || a === "--port") return true;
    if (a.startsWith("--port=") || a.startsWith("-p=")) return true;
  }
  return false;
}

const hasPortEnv =
  process.env.PORT !== undefined && String(process.env.PORT).trim().length > 0;

const args = [nextBin, "dev"];
if (!hasPortInArgs(userArgs) && !hasPortEnv) {
  args.push("-p", "3333");
}
args.push(...userArgs);

const child = spawn(process.execPath, args, {
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code === null ? 1 : code);
});
