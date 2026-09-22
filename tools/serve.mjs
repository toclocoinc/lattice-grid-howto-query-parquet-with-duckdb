/**
 * A small static file server for looking at the demo locally.
 *
 * It takes a free port from the operating system and prints the address, so
 * it never clashes with anything else already running. Pass a port as the
 * first argument to choose one yourself.
 *
 * Nothing the page loads imports this: it only serves files.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.parquet': 'application/octet-stream',
};

/**
 * Resolve a request path to a file inside the project, or null when it points
 * outside it.
 */
function resolvePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = join(root, relative);
  if (!full.startsWith(root)) return null;
  return full;
}

export function startServer(port = 0) {
  const server = createServer(async (request, response) => {
    let file = resolvePath(request.url || '/');
    if (!file) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    try {
      let info = await stat(file);
      if (info.isDirectory()) {
        file = join(file, 'index.html');
        info = await stat(file);
      }
      const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
      // DuckDB's httpfs reads a Parquet file with Range requests, so this
      // demo needs to answer them like a real static host would.
      const range = request.headers.range;
      const match = range && /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Number(match[2]) : info.size - 1;
        response.writeHead(206, {
          'content-type': type,
          'content-range': `bytes ${start}-${end}/${info.size}`,
          'accept-ranges': 'bytes',
          'content-length': end - start + 1,
          'cache-control': 'no-store',
        });
        createReadStream(file, { start, end }).pipe(response);
        return;
      }
      response.writeHead(200, {
        'content-type': type,
        'content-length': info.size,
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
      });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });

  return new Promise((done) => {
    server.listen(port, '127.0.0.1', () => done({ server, port: server.address().port }));
  });
}

/* Run directly, rather than imported by the verification script. */
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const wanted = Number(process.argv[2] || 0);
  const { port } = await startServer(Number.isFinite(wanted) ? wanted : 0);
  process.stdout.write(`Serving the demo at http://localhost:${port}/\n`);
  process.stdout.write('Press Control-C to stop.\n');
}
