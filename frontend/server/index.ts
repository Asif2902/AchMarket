import { createReadStream, existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = resolve(process.cwd());
const distDir = resolve(projectRoot, 'dist');
const apiDir = resolve(projectRoot, 'api');
const port = Number(process.env.PORT || 3000);
const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || 10 * 1024 * 1024);

dotenv.config({ path: resolve(projectRoot, '../.env') });
dotenv.config({ path: resolve(projectRoot, '.env'), override: true });

type QueryValue = string | string[];
type ApiRequest = IncomingMessage & {
  body?: unknown;
  query?: Record<string, QueryValue>;
};
type ApiResponse = ServerResponse & {
  status: (code: number) => ApiResponse;
  json: (payload: unknown) => void;
  send: (payload: unknown) => void;
};
type ApiHandler = (req: ApiRequest, res: ApiResponse) => unknown | Promise<unknown>;

const apiHandlers = new Map<string, Promise<ApiHandler>>();

const mimeTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function parseQuery(url: URL): Record<string, QueryValue> {
  const query: Record<string, QueryValue> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const existing = query[key];
    if (Array.isArray(existing)) existing.push(value);
    else if (typeof existing === 'string') query[key] = [existing, value];
    else query[key] = value;
  }
  return query;
}

async function readRequestBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return undefined;
  }

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBodyBytes) {
      const err = new Error('Request body too large');
      (err as Error & { status?: number }).status = 413;
      throw err;
    }
    chunks.push(buffer);
  }

  if (!chunks.length) return undefined;
  const rawBody = Buffer.concat(chunks).toString('utf8');
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(rawBody);
    } catch {
      return rawBody;
    }
  }
  return rawBody;
}

function createApiResponse(res: ServerResponse): ApiResponse {
  const apiRes = res as ApiResponse;
  apiRes.status = (code: number) => {
    apiRes.statusCode = code;
    return apiRes;
  };
  apiRes.json = (payload: unknown) => {
    if (!apiRes.headersSent && !apiRes.getHeader('Content-Type')) {
      apiRes.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    apiRes.end(JSON.stringify(payload));
  };
  apiRes.send = (payload: unknown) => {
    if (Buffer.isBuffer(payload) || typeof payload === 'string') {
      apiRes.end(payload);
      return;
    }
    apiRes.json(payload);
  };
  return apiRes;
}

async function loadApiHandler(routeName: string): Promise<ApiHandler | null> {
  if (!/^[a-z0-9_-]+$/i.test(routeName)) return null;
  const handlerPath = join(apiDir, `${routeName}.ts`);
  if (!existsSync(handlerPath)) return null;

  if (!apiHandlers.has(routeName)) {
    apiHandlers.set(routeName, import(pathToFileURL(handlerPath).href).then((mod) => {
      if (typeof mod.default !== 'function') {
        throw new Error(`API route ${routeName} does not export a default handler`);
      }
      return mod.default as ApiHandler;
    }));
  }

  return apiHandlers.get(routeName) ?? null;
}

async function handleApi(req: ApiRequest, res: ServerResponse, url: URL): Promise<void> {
  const routeName = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const handler = await loadApiHandler(routeName);
  const apiRes = createApiResponse(res);

  if (!handler) {
    apiRes.status(404).json({ error: 'API route not found' });
    return;
  }

  try {
    req.query = parseQuery(url);
    req.body = await readRequestBody(req);
    await handler(req, apiRes);
    if (!apiRes.writableEnded) apiRes.end();
  } catch (err) {
    const status = typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 500;
    if (!apiRes.headersSent) {
      apiRes.status(status).json({ error: err instanceof Error ? err.message : 'Internal server error' });
    } else {
      apiRes.end();
    }
  }
}

function resolveStaticPath(pathname: string): string | null {
  const decodedPath = decodeURIComponent(pathname);
  const requestedPath = normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = resolve(distDir, requestedPath.replace(/^[/\\]+/, ''));
  if (!filePath.startsWith(distDir)) return null;
  if (existsSync(filePath) && statSync(filePath).isFile()) return filePath;
  return null;
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const filePath = resolveStaticPath(url.pathname) ?? join(distDir, 'index.html');
  const extension = extname(filePath);
  const contentType = mimeTypes[extension] ?? 'application/octet-stream';

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  res.setHeader('Content-Type', contentType);
  if (extension === '.html') {
    res.setHeader('Cache-Control', 'no-cache');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  if (!existsSync(filePath)) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Frontend build not found. Run npm run build first.' }));
    return;
  }

  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const host = req.headers.host || `localhost:${port}`;
  const url = new URL(req.url || '/', `http://${host}`);

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    await handleApi(req as ApiRequest, res, url);
    return;
  }

  await serveStatic(req, res, url);
});

server.listen(port, '0.0.0.0', async () => {
  let packageVersion = 'unknown';
  try {
    const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8')) as { version?: string };
    packageVersion = packageJson.version ?? packageVersion;
  } catch {
    // Keep startup tolerant even if package metadata is unavailable.
  }
  console.log(`AchMarket frontend ${packageVersion} listening on http://0.0.0.0:${port}`);
});
