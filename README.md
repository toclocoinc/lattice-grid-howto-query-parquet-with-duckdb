# How to query a Parquet file in the browser with DuckDB

Points the grid at `data/parts.parquet`, a 5,000-row parts-inventory file, through DuckDB-Wasm running
in the tab. `createPushdownSource` and `duckdbAdapter` turn a sort or a filter into one SQL statement;
DuckDB answers it over the file and only the page the grid asked for comes back.

Live demo: https://toclocoinc.github.io/lattice-grid-howto-query-parquet-with-duckdb/

**Read the how-to:** https://www.latticegrid.dev/docs/how-to/query-parquet-with-duckdb/

## The snippet

```js
const connection = await db.connect();          // a DuckDB-Wasm connection you made
await connection.query('LOAD httpfs;');          // range reads over HTTP

const adapter = LatticeGrid.duckdbAdapter({
  connection,
  from: "read_parquet('./data/parts.parquet')",
});
const source = LatticeGrid.createPushdownSource({ adapter, compute: LatticeGrid, pageSize: 100 });

LatticeGrid.createGrid(el, { rowKey: 'part_id', columns, source });

// Both push down to DuckDB as SQL; only the visible page returns.
grid.sort.set([{ col: 'unit_cost', dir: 'desc' }]);
grid.filters.set({ col: 'quantity', op: 'lt', value: 100 });
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
