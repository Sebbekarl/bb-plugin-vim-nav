// bb-plugin-vim-nav — backend entry.
//
// All behavior lives in the frontend content script (app.tsx → vim.ts). BB
// requires a server entry, so this one only logs that the plugin loaded.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");
}
