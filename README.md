# bb-plugin-vim-nav

Vimium-style keyboard navigation for bb. When focus is not in a text field,
terminal, or browser tab, these keys work anywhere in the app:

| Keys | Action |
| --- | --- |
| `j` / `k` | Scroll down / up |
| `h` / `l` | Scroll left / right |
| `d` / `u` | Scroll half a page down / up |
| `gg` / `G` | Scroll to the top / bottom |
| `f` | Show link hints; type a label to click it (Esc cancels) |
| `i` | Focus the composer |
| `J` or `gt` / `K` or `gT` | Next / previous thread in the sidebar |
| `H` / `L` | Back / forward |
| `o` or `T` | Search threads |
| `t` | New thread |
| `gf` | Open a file |
| `:` | Command palette |
| `?` | Show the key list |
| `Esc` (while typing) | Leave the text field and return to normal mode |

Scrolling targets the scroll area you last clicked in, or the chat when you
have not clicked anywhere. After a thread switch, the composer is kept from
taking focus, so you can keep pressing `J`/`K`.

## How it works

`app.tsx` registers one content script (`vim.ts`) that listens for keys in
the capture phase. Thread, history, search, and palette keys replay bb's own
default shortcuts, so bb keeps deciding thread order and history. If you
rebind one of those commands in Settings → Keyboard, update the matching
entry in `BB_SHORTCUTS` in `vim.ts`.

To change the keymap, edit `MAPPINGS` in `vim.ts`, then run
`bb plugin build && bb plugin reload vim-nav` (or keep `bb plugin dev`
running while you edit).

## Develop

```
npm install
npm run typecheck
bb plugin build
bb plugin install .   # once; registers this directory in place
bb plugin reload vim-nav
```

Turn it off with `bb plugin disable vim-nav`, or remove it with
`bb plugin uninstall vim-nav`.
