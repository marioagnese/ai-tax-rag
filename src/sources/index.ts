import type { SourcePlugin } from "../core/contracts/source";
import { brPlugins } from "./br";

export const allPlugins: SourcePlugin[] = [
  ...brPlugins,
];

export function getPlugin(id: string): SourcePlugin {
  const p = allPlugins.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown plugin: ${id}`);
  return p;
}
