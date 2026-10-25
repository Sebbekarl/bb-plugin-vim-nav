---
name: vim-nav
description: Explain or change the Vim Nav plugin's Vimium-style keyboard shortcuts in the bb app (j/k scrolling, f link hints, J/K thread switching).
---

# Vim Nav

The Vim Nav plugin adds Vimium-style keys to the bb app. They act only when
focus is outside text fields, terminals, browser tabs, and open menus. Press
`?` in the app to see the list.

Keys: `j`/`k` scroll, `h`/`l` scroll sideways, `d`/`u` half page, `gg`/`G`
top/bottom, `f` link hints, `i` focus composer, `J`/`gt` next thread,
`K`/`gT` previous thread, `H`/`L` back/forward, `o`/`T` search threads, `t`
new thread, `gf` open file, `:` command palette, `Esc` leave a text field.

Thread, history, search, and palette keys replay bb's default shortcuts. If
the user rebinds one of those commands, the matching `BB_SHORTCUTS` entry in
the plugin's `vim.ts` must change too.

To change a key, edit `MAPPINGS` in `vim.ts` in the plugin's source
directory (shown by `bb plugin list`), then run `bb plugin build` and
`bb plugin reload vim-nav` there.

The plugin has no CLI commands or settings. Disable it with
`bb plugin disable vim-nav`.
