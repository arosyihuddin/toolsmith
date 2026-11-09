export interface DesktopApp {
  id: string;
  name: string;
  exec: string | null;
  desktop_file: string;
  categories: string[];
  terminal: boolean;
}

export async function listWindowsApps(): Promise<DesktopApp[]> {
  throw new Error("Windows app listing is not implemented yet");
}
