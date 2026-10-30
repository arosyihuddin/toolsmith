import * as linux from "./linux";
import * as macos from "./macos";
import * as windows from "./windows";

const platform = process.platform;
const computer = platform === "linux" ? linux : platform === "darwin" ? macos : platform === "win32" ? windows : null;
if (!computer) throw new Error("Unsupported OS: " + platform);

export const takeScreenshot = computer.takeScreenshot;
export const listApps = computer.listApps;

export async function listWindows() {
  if (platform !== "linux") throw new Error("Window listing is only supported on Linux");
  return linux.listWindows();
}

export async function activeWindow() {
  if (platform !== "linux") throw new Error("Active window lookup is only supported on Linux");
  return linux.activeWindow();
}
