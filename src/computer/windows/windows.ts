import type { ActiveWindow, DesktopWindow } from "../linux/windows";

export async function listWindowsWindows(): Promise<DesktopWindow[]> { throw new Error("Windows window listing is not implemented yet"); }
export async function activeWindowsWindow(): Promise<ActiveWindow | null> { throw new Error("Windows active window is not implemented yet"); }
export async function focusWindowsWindow(_id: string): Promise<void> { throw new Error("Windows window focus is not implemented yet"); }
export async function closeWindowsWindow(_id: string): Promise<void> { throw new Error("Windows window close is not implemented yet"); }
export async function moveWindowsWindow(_id: string, _workspace: string): Promise<void> { throw new Error("Windows window move is not implemented yet"); }
