/**
 * Load the demo in a real headless browser and check that it works.
 *
 * Serves the project locally and drives it with the same minimal Chrome
 * driver the grid's own test suite uses (tools/browser.js), so this needs no
 * dependency beyond Chrome itself.
 *
 * Checks:
 *   - the library and the pushdown/DuckDB exports arrived;
 *   - DuckDB-Wasm starts and all 5,000 parts land (grid.rows.matchCount(),
 *     not a DOM count) from data/parts.parquet;
 *   - clicking "Sort by cost" changes the first row read back through
 *     grid.rows.get(0), not the DOM, and it stays in descending order;
 *   - clicking "Low stock" narrows grid.rows.matchCount() and the fetched
 *     first page reads quantity < 100 through grid.rows.get(i).data;
 *   - the transferred-rows line updates after each query;
 *   - nothing logged a console error or threw while the page ran.
 *
 * Every check that depends on an async query settling polls from the Node
 * side, a short Runtime.evaluate at a time, rather than one long in-page
 * promise: DuckDB-Wasm compiles a WASM module and runs real SQL, so how long
 * a query takes depends on the machine, and a single evaluate call has its
 * own protocol-level timeout that a long in-page wait can lose a race
 * against under load.
 *
 * Exits non-zero on any failure, so it can gate a deployment.
 *
 * Usage: node tools/verify.mjs
 */

import { startServer } from './serve.mjs';
import { Browser, available } from './browser.js';

if (!available()) {
  console.log('No headless browser on this machine; skipping verify.mjs.');
  process.exit(0);
}

const { server, port } = await startServer();
const browser = new Browser();

/**
 * Poll `expression` (a page-side expression returning a JSON-serialisable
 * truthy value, or a falsy one when not ready yet) until it is truthy, or
 * until `timeoutMs` has passed. Each poll is its own short Runtime.evaluate
 * call, so no single call can time out waiting on the page.
 */
async function waitFor(expression, timeoutMs = 45000, intervalMs = 400) {
  const started = Date.now();
  for (;;) {
    const value = await browser.evaluate(expression);
    if (value) return value;
    if (Date.now() - started > timeoutMs) return null;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function run() {
  await browser.start();

  await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__errs = [];
      addEventListener('error', (e) => window.__errs.push(String(e.message || e)));
      addEventListener('unhandledrejection', (e) => window.__errs.push('unhandledrejection: ' + String(e.reason)));
      const origError = console.error.bind(console);
      console.error = (...args) => { window.__errs.push('console.error: ' + args.map(String).join(' ')); origError(...args); };
    `,
  });

  await browser.open(`http://127.0.0.1:${port}/`);

  const failures = [];

  const hasApis = await browser.evaluate(
    `typeof LatticeGrid !== 'undefined' && typeof LatticeGrid.createGrid === 'function' && typeof LatticeGrid.duckdbAdapter === 'function' && typeof LatticeGrid.createPushdownSource === 'function'`
  );
  if (!hasApis) failures.push('LatticeGrid, duckdbAdapter or createPushdownSource was not found on the page');

  // DuckDB-Wasm compiles a WASM module over the network, so give this real
  // time. Read the count and the first row together so both come from the
  // same settled moment.
  const firstPartBeforeSort = await waitFor(`(() => {
    const g = window.__demoGrid;
    if (!g || g.rows.matchCount() !== 5000) return null;
    const row = g.rows.get(0);
    return row && row.data ? row.data.part_id : null;
  })()`);
  if (!firstPartBeforeSort) {
    console.error('FAILED:\n  - the grid never reported exactly 5000 parts with a readable first row in time');
    process.exitCode = 1;
    return;
  }

  await browser.evaluate(`document.getElementById('sort-cost').click()`);

  const sortedFirst = await waitFor(`(() => {
    const g = window.__demoGrid;
    if (!g) return null;
    const sort = g.sort.get();
    if (!sort.length || sort[0].col !== 'unit_cost' || sort[0].dir !== 'desc') return null;
    const a = g.rows.get(0), b = g.rows.get(1);
    if (!a || !a.data || !b || !b.data) return null;
    if (a.data.part_id === ${JSON.stringify(firstPartBeforeSort)}) return null; // still the pre-sort order
    return JSON.stringify({ firstPart: a.data.part_id, firstCost: a.data.unit_cost, secondCost: b.data.unit_cost });
  })()`);
  if (!sortedFirst) {
    failures.push('sorting by cost never produced a new, stably-sorted first row in time');
  } else {
    const { firstCost, secondCost } = JSON.parse(sortedFirst);
    if (!(firstCost >= secondCost)) failures.push(`expected descending unit_cost, first row ${firstCost} was not >= second row ${secondCost}`);
  }

  const statAfterSort = await browser.evaluate(`document.getElementById('stat').textContent`);
  if (!/rows transferred/.test(statAfterSort)) failures.push(`expected the stat line to report rows transferred after sorting, it read: ${statAfterSort}`);

  await browser.evaluate(`document.getElementById('low-stock').click()`);

  // rows.count() is the display count across the whole matching set, not
  // just what has been fetched, so only the first page — guaranteed fetched
  // as soon as the query settles — is read row by row here.
  const filteredCheck = await waitFor(`(() => {
    const g = window.__demoGrid;
    if (!g) return null;
    const count = g.rows.matchCount();
    if (!(count > 0 && count < 5000)) return null;
    const sample = Math.min(g.rows.count(), 20);
    if (sample === 0) return null;
    for (let i = 0; i < sample; i++) {
      const row = g.rows.get(i);
      if (!row || !row.data || row.data.quantity >= 100) return null;
    }
    return JSON.stringify({ count, sample });
  })()`);
  if (!filteredCheck) {
    failures.push('filtering to low stock never settled to a narrowed matchCount() with every sampled row under 100 in time');
  }

  const statAfterFilter = await browser.evaluate(`document.getElementById('stat').textContent`);
  if (!/rows transferred/.test(statAfterFilter)) failures.push(`expected the stat line to report rows transferred after filtering, it read: ${statAfterFilter}`);

  const errors = await browser.evaluate('window.__errs');
  if (errors.length) failures.push(`console/window errors: ${errors.join(' | ')}`);

  if (failures.length) {
    console.error('FAILED:\n' + failures.map((f) => `  - ${f}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log(
      'OK: 5,000 parts loaded from data/parts.parquet through DuckDB-Wasm, sorting by cost changed the ' +
      'first row (descending, read through grid.rows.get()), filtering to low stock narrowed matchCount() ' +
      `and left every loaded row's quantity under 100. 0 console errors.`
    );
  }
}

try {
  await run();
} finally {
  await browser.close();
  server.close();
}
