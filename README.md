# Markdown Language Client

This is a automated export of the official [markdown-language-features](https://github.com/microsoft/vscode/blob/main/extensions/markdown-language-features).

Core language client related functionallity is exported, so that a user can use the official markdown language server for related vscode extension development.

Sources are patched to use already officially published packages when possible.

## Patching

[sync.ts](./sync.ts) contains the updating and patching logic. It uses data from the [sync](./sync/) directory.

Syncronize with the official sources:

```bash
pnpm run sync
```
