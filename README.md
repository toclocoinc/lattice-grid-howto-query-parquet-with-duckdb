# How to query a Parquet file in the browser with DuckDB

Points the grid at `data/parts.parquet`, a 5,000-row parts-inventory file, through DuckDB-Wasm running
in the tab. `createPushdownSource` and `duckdbAdapter` turn a sort or a filter into one SQL statement;
DuckDB answers it over the file and only the page the grid asked for comes back.

Live demo: https://toclocoinc.github.io/lattice-grid-howto-query-parquet-with-duckdb/

**Read the how-to:** https://www.latticegrid.dev/docs/how-to/query-parquet-with-duckdb/

## The full source

Two files: `index.html` loads the grid and declares the mount point, `demo.js` configures and creates it. Copy both as they are below and it runs.

### index.html

```html
<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>How to query a Parquet file in the browser with DuckDB</title>
    <meta
      name="description"
      content="A 5,000-row Parquet file of parts inventory, queried in the tab with DuckDB-Wasm. Sort by cost or filter to low stock and the grid asks DuckDB for that page, not the file. Built with Lattice Grid loaded by script tag, no install and no build."
    />
    <link rel="icon" href="data:," />
    <!--
      The grid's stylesheet, from jsDelivr. The address names the exact
      release, 1.68.2, and carries the hash of the file it expects, so the
      page can never quietly pick up a different build than the one it was
      checked against.
    -->
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.68.2/lattice-grid.min.css"
      integrity="sha384-mcpd7S8C5nz58bZDAXdYH6rzezEhfN7B4u2SlW426dSe20GnkxTu4TygyOILnCth"
      crossorigin="anonymous"
    />
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #f4f6f9; color: #131a24; }
      header { padding: 1.5rem 1.5rem 0.5rem; max-width: 960px; margin: 0 auto; }
      header p { color: #4a5568; }
      header a { color: #2d6bff; }
      main { max-width: 960px; margin: 0 auto; padding: 0 1.5rem 2.5rem; }
      #toolbar { margin: 0 0 0.75rem; display: flex; gap: 0.5rem; align-items: center; }
      #toolbar button { font: inherit; padding: 0.4rem 0.75rem; border: 1px solid #ccd3dc; border-radius: 4px; background: #fff; cursor: pointer; }
      #grid { height: 420px; }
      #status, #stat { font-size: 0.9rem; color: #4a5568; margin: 0.75rem 0 0; }
    </style>
  </head>
  <body>
    <header>
      <h1>How to query a Parquet file in the browser with DuckDB</h1>
      <p id="status">Starting DuckDB-Wasm…</p>
      <p>
        Click "Sort by cost" or "Low stock" below and the grid turns that into one SQL statement DuckDB
        answers over <code>data/parts.parquet</code>, a 5,000-row inventory file sitting next to this
        page. Only the rows the grid actually shows come back. Read the
        <a href="https://www.latticegrid.dev/docs/how-to/query-parquet-with-duckdb/">full how-to</a>
        on latticegrid.dev.
      </p>
    </header>
    <main>
      <div id="toolbar">
        <button id="sort-cost" type="button">Sort by cost</button>
        <button id="low-stock" type="button">Low stock (&lt; 100)</button>
      </div>
      <div id="grid"></div>
      <p id="stat">Rows transferred appear here after each query.</p>
    </main>

    <!--
      The library, as a classic script tag. No npm install, no bundler, no
      type="module": the file runs as it arrives and leaves the LatticeGrid
      global behind.
    -->
    <script
      src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.68.2/lattice-grid.min.js"
      integrity="sha384-vCzLyFYn0T0lz/vkdH4x0JpJZkOazZgI2LiGui7lm5uerdZd0Z46G9hr3Aq1FFPS"
      crossorigin="anonymous"
    ></script>
    <script src="./demo.js"></script>
  </body>
</html>
```

### demo.js

```js
/**
 * Query a Parquet file in the browser with DuckDB: the grid turns a sort or
 * a filter into one SQL statement, DuckDB-Wasm answers it over the file, and
 * only the page the grid asked for comes back.
 *
 * `createPushdownSource` + `duckdbAdapter` hand the grid's query to a DuckDB
 * connection you create yourself; the grid imports no engine.
 */

// Tied to toclocoinc.github.io only; has no effect anywhere else and needs
// no key at all to run this page from a local copy.
LatticeGrid.setLicence(
  'LG1.eyJ2IjoxLCJwIjoibGF0dGljZS1ncmlkIiwidCI6IlRPQ0xPQ08gSW5jIC0gcHVibGljIGRlbW9zIiwiZSI6IjIwMzAtMDEtMDEiLCJkIjpbInRvY2xvY29pbmMuZ2l0aHViLmlvIl19.9De42ua3aCGpiMB6EVRP7Tv-upUlDI-0T07rlSPzvCrsqg8t4YJi7SRnStEpAg48uzmcG7il1fR_TfwkUE7iCA'
);

const statusEl = document.getElementById('status');
const statEl = document.getElementById('stat');

(async () => {
  const duckdb = await import(/* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm');
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const worker = await duckdb.createWorker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.ERROR), worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  const connection = await db.connect();
  // Range reads over HTTP, so DuckDB can read part of the file rather than
  // fetching the whole thing for every query.
  await connection.query('LOAD httpfs;');

  const FILE = new URL('./data/parts.parquet', location.href).href;
  const adapter = LatticeGrid.duckdbAdapter({ connection, from: `read_parquet('${FILE}')` });
  const source = LatticeGrid.createPushdownSource({ adapter, compute: LatticeGrid, pageSize: 100 });

  // Wrap execute to show what actually crossed into the tab after each query.
  const run = adapter.execute.bind(adapter);
  adapter.execute = async (query, request) => {
    const result = await run(query, request);
    statEl.textContent = `${result.rows.length} rows transferred, of ${result.total ?? '?'} matching.`;
    return result;
  };

  const grid = LatticeGrid.createGrid(document.getElementById('grid'), {
    rowKey: 'part_id',
    columnDefaults: { sort: true },
    columns: [
      { field: 'part_id', title: 'Part' },
      { field: 'category', title: 'Category' },
      { field: 'warehouse', title: 'Warehouse' },
      { field: 'unit_cost', title: 'Unit cost', type: 'number' },
      { field: 'quantity', title: 'Quantity', type: 'number' },
      { field: 'reorder_level', title: 'Reorder level', type: 'number' },
    ],
    source,
  });
  window.__demoGrid = grid; // read by tools/verify.mjs

  statusEl.textContent = '5,000 rows in a Parquet file, queried in the tab, no server.';

  document.getElementById('sort-cost').addEventListener('click', () => {
    grid.sort.set([{ col: 'unit_cost', dir: 'desc' }]);
  });
  document.getElementById('low-stock').addEventListener('click', () => {
    grid.filters.set({ col: 'quantity', op: 'lt', value: 100 });
  });
})().catch((err) => {
  console.error('[query-parquet-with-duckdb]', err);
  statusEl.textContent = 'DuckDB-Wasm could not start here. It needs a browser with WebAssembly.';
});
```

`duckdbAdapter` writes the SQL; the grid never sees the file itself. Sorting and filtering become
`ORDER BY` and `WHERE` in one statement, with the matching count riding along in the same round trip,
so a 5,000-row file, or a much larger one, stays fast without loading every row into the tab.

## Three things to know

- **Range reads.** `LOAD httpfs;` is what lets DuckDB read part of a Parquet file over HTTP instead of
  fetching the whole thing for every query; it needs a server that answers `Range` requests, which any
  real static host does.
- **A filtered count is not free.** The matching count DuckDB reports after a filter is a real
  `count(*)` over the predicate, computed by reading the columns the filter touches, not a cached
  number the engine already knew.
- **CORS on the file's host.** This demo serves its Parquet file from the same origin as the page, so
  no cross-origin request is involved. Pointing the adapter at a file on another host only works if
  that host answers with `Access-Control-Allow-Origin`.

## Running it yourself

Serve the folder with any static file server that answers Range requests (`node tools/serve.mjs` here,
or GitHub Pages once published). The grid and DuckDB-Wasm both load from jsDelivr by script tag or
dynamic import, so there is no install and no build step. It runs keyless on `localhost`; the licence
key in `demo.js` is bound to `toclocoinc.github.io` and has no effect anywhere else.

## Licence

MIT, see [LICENSE](./LICENSE). Lattice Grid itself is licensed separately per domain:
https://www.latticegrid.dev/pricing/
