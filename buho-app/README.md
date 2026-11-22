# buho-app

The Buho web application: SvelteKit 2 + Svelte 5, built as a static site. Every export is parsed and queried in the browser (DuckDB-WASM); nothing is uploaded.

```sh
npm install
npm run dev      # dev server (fetches the DuckDB extensions first)
npm test         # Vitest suite
npm run check    # svelte-check (types)
npm run build    # static build into build/
```

Architecture, vocabulary (sources vs modules) and the invariants every change must respect are in [`../AGENTS.md`](../AGENTS.md).
