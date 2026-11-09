export interface DesktopApp {
  id: string;
  name: string;
  exec: string | null;
  desktop_file: string;
  categories: string[];
  terminal: boolean;
}

export async function listMacApps(): Promise<DesktopApp[]> {
  throw new Error("macOS app listing is not implemented yet");
}
