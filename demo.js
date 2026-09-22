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
