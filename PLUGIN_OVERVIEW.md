Move around bb from the keyboard the way Vimium moves around a browser.

## What you get

- `j`/`k`, `d`/`u`, `gg`/`G` scroll the chat or whichever pane you last clicked.
- `f` labels every clickable element; type a label to click it.
- `J`/`K` switch threads, `H`/`L` go back and forward, `o` searches threads,
  `:` opens the command palette, `i` jumps to the composer.
- `Esc` leaves a text field so the keys work again. `?` lists every key.

## How it works

Keys only act when focus is outside text fields, terminals, and browser tabs,
so typing is never intercepted. Navigation keys replay bb's own shortcuts.
Nothing leaves your machine.
