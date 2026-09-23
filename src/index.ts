/**
 * OpenCode HUD server plugin.
 *
 * Empty on purpose. opencode 2 only loads a local package that has a server
 * entrypoint, and reports its TUI entrypoint alongside it; the HUD itself lives
 * entirely in the TUI module (see tui.tsx).
 */

import { Plugin } from "@opencode/plugin";

export default Plugin.define({
  id: "opencode-hud",
  setup: () => {},
});
