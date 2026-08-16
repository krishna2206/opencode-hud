/**
 * OpenCode HUD server plugin.
 *
 * Minimal: the server part exists to satisfy the plugin loader. All the HUD
 * logic lives in the TUI module (compact quota line + git branch).
 */

import type { Plugin } from "@opencode-ai/plugin";

export const HUDPlugin: Plugin = async () => {
  // Intentionally empty: the HUD renders in the TUI, no server surface needed.
  return {};
};

type V1PluginModule = {
  id: string;
  server: typeof HUDPlugin;
};

const pluginModule = {
  id: "opencode-hud",
  server: HUDPlugin,
} satisfies V1PluginModule;

export default pluginModule;