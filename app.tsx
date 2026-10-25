// bb-plugin-vim-nav — frontend entry.
//
// A single trusted content script installs the Vimium-style key handler in
// every bb window. See vim.ts for the keymap and behavior.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountVimNav } from "./vim";

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "vim-nav",
    mount: ({ signal }) => mountVimNav(signal),
  });
});
