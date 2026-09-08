/**
 * NVIDIA VISTA-3D proxy.
 *
 * Exists for three reasons the browser cannot solve on its own:
 *   1. health.api.nvidia.com sends no CORS headers, so the call must be server-side.
 *   2. The API keys must not ship to the client.
 *   3. VISTA-3D fetches the scan itself, so the input has to live behind a public
 *      URL. This server can host an uploaded volume for that purpose.
 *
 * Run:  npm run vista        (defaults to http://localhost:8788)
 * Vite proxies /api/vista and /files here in development.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CACHE = join(ROOT, 'server', '.cache');
const PORT = Number(process.env.VISTA_PROXY_PORT ?? 8788);

// ---------------------------------------------------------------- env

function loadEnv() {
  const file = join(ROOT, '.env');
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([\w.-]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match || line.trim().startsWith('#')) continue;
    out[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };

// Accept every naming the repo has used for the two keys; primary first,
// fallback second. Anything that looks like an NGC key is picked up.
const KEYS = [
  ...[
    env.VITE_NVIDIA_VISTA_API, env.NVIDIA_VISTA_API_KEY, env.nvidia_vista_pi, env.nvidia_vista_api,
    env.VITE_NVIDIA_VISTA_FALLBACK, env.NVIDIA_VISTA_FALLBACK_KEY, env.nvidia_vist_fallback,
  ],
  ...Object.entries(env)
    .filter(([k, v]) => /nvidia|nvapi|vista|ngc/i.test(k) && typeof v === 'string' && v.startsWith('nvapi-'))
    .map(([, v]) => v),
].filter((v, i, all) => typeof v === 'string' && v.startsWith('nvapi-') && all.indexOf(v) === i);

/**
 * Endpoint candidates, tried in order.
 *
 * NVIDIA retired the hosted endpoint on 2026-08-25 (it now answers 410 Gone),
 * so a self-hosted VISTA-3D NIM is the working path — that is what the
 * build.nvidia.com "deploy" tab describes. The hosted URLs stay in the list so
 * this keeps working if NVIDIA brings the managed endpoint back.
 */
const LOCAL_NIM = env.VISTA_INVOKE_URL || 'http://localhost:8000/v1/vista3d/inference';
const CANDIDATES = [
  LOCAL_NIM,
  'http://localhost:8008/vista3d/inference',
  'https://health.api.nvidia.com/v1/medicalimaging/nvidia/vista-3d',
].filter((v, i, all) => all.indexOf(v) === i);
const STATUS_URL = env.VISTA_STATUS_URL || 'https://health.api.nvidia.com/v1/status';

/**
 * Origin the inference service can reach to download an uploaded scan.
 * A local NIM in Docker reaches the host at host.docker.internal, so uploads
 * work with no tunnel at all; a hosted endpoint would need a public tunnel.
 */
const PUBLIC_BASE = (env.VISTA_PUBLIC_BASE_URL || `http://host.docker.internal:${PORT}`).replace(/\/$/, '');

// ---------------------------------------------------------------- helpers

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};

function readBody(req, limit = 512 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('Upload is too large.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** POST to VISTA-3D, following the NVCF 202-and-poll pattern, with endpoint and key fallback. */
async function invokeVista(payload) {
  const notes = [];

  for (const url of CANDIDATES) {
    const local = url.startsWith('http://localhost') || url.startsWith('http://127.');
    // A local NIM needs no auth; a hosted one needs a key.
    const keys = local ? [null] : KEYS;
    if (keys.length === 0) { notes.push('hosted endpoint skipped (no nvapi- key in .env)'); continue; }

    for (const key of keys) {
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            ...(key ? { Authorization: `Bearer ${key}` } : {}),
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(local ? 600_000 : 300_000),
        });
      } catch (error) {
        notes.push(`${url} unreachable (${error.cause?.code ?? error.name})`);
        break; // no point retrying this URL with another key
      }

      if (response.status === 404 || response.status === 410) {
        notes.push(`${url} -> ${response.status}${response.status === 410 ? ' (endpoint retired by NVIDIA)' : ''}`);
        break;
      }
      if (response.status === 401 || response.status === 403 || response.status === 429) {
        notes.push(`${url} -> ${response.status}`);
        continue; // try the next key
      }

      // Asynchronous invocation: poll until the result is ready.
      if (response.status === 202) {
        const id = response.headers.get('nvcf-reqid');
        if (!id) throw new Error('VISTA-3D accepted the job but returned no request id.');
        for (let attempt = 0; attempt < 150; attempt++) {
          await new Promise((r) => setTimeout(r, 2000));
          const poll = await fetch(`${STATUS_URL}/${id}`, {
            headers: key ? { Authorization: `Bearer ${key}` } : {},
          });
          if (poll.status === 202) continue;
          if (!poll.ok) throw new Error(`VISTA-3D status ${poll.status}: ${(await poll.text()).slice(0, 300)}`);
          return { buffer: Buffer.from(await poll.arrayBuffer()), type: poll.headers.get('content-type'), url };
        }
        throw new Error('VISTA-3D timed out after five minutes.');
      }

      if (!response.ok) {
        notes.push(`${url} -> ${response.status} ${(await response.text().catch(() => '')).slice(0, 200)}`);
        break;
      }
      return { buffer: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type'), url };
    }
  }

  throw new Error(
    'No VISTA-3D endpoint answered. NVIDIA retired the hosted API on 2026-08-25, so run the ' +
      'NIM locally (see docs/NVIDIA_VISTA_3D.md) or point VISTA_INVOKE_URL at your deployment. ' +
      `Tried: ${notes.join(' | ')}`,
  );
}

// ---------------------------------------------------------------- routes

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    return res.end();
  }

  try {
    if (url.pathname === '/api/vista/health') {
      return json(res, 200, {
        ok: true,
        keys: KEYS.length,
        endpoints: CANDIDATES,
        publicBase: PUBLIC_BASE || null,
      });
    }

    // Host a scan so VISTA-3D can fetch it by URL.
    if (url.pathname === '/api/vista/upload' && (req.method === 'PUT' || req.method === 'POST')) {
      const name = url.searchParams.get('name') ?? 'scan.nii.gz';
      const suffix = name.endsWith('.nrrd') ? '.nrrd' : name.endsWith('.nii') ? '.nii' : '.nii.gz';
      const id = `${randomUUID()}${suffix}`;
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(join(CACHE, id), await readBody(req));
      return json(res, 200, { url: `${PUBLIC_BASE}/files/${id}` });
    }

    if (url.pathname.startsWith('/files/')) {
      const file = join(CACHE, url.pathname.slice('/files/'.length));
      if (!file.startsWith(CACHE) || !existsSync(file)) return json(res, 404, { error: 'Not found' });
      res.writeHead(200, {
        'content-type': extname(file) === '.nrrd' ? 'application/octet-stream' : 'application/gzip',
        'content-length': statSync(file).size,
        'access-control-allow-origin': '*',
      });
      return createReadStream(file).pipe(res);
    }

    if (url.pathname === '/api/vista/segment' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8') || '{}');
      if (!body.imageUrl) return json(res, 400, { error: 'imageUrl is required.' });

      const payload = { image: body.imageUrl, output: { extension: '.nii.gz', dtype: 'uint8' } };
      if (Array.isArray(body.classes) && body.classes.length > 0) {
        payload.prompts = { classes: body.classes };
      }

      const started = Date.now();
      const { buffer, type, url } = await invokeVista(payload);
      console.log(`[vista] ${body.imageUrl} via ${url} -> ${buffer.length} bytes in ${Date.now() - started}ms`);

      res.writeHead(200, {
        'content-type': type?.includes('json') ? 'application/json' : 'application/gzip',
        'content-length': buffer.length,
        'access-control-allow-origin': '*',
      });
      return res.end(buffer);
    }

    json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('[vista]', error);
    json(res, 500, { error: error instanceof Error ? error.message : 'Proxy failure' });
  }
});

server.listen(PORT, () => {
  console.log(`[vista] proxy on http://localhost:${PORT}`);
  console.log(`[vista] ${KEYS.length} API key(s) loaded`);
  console.log(`[vista] endpoints tried in order: ${CANDIDATES.join(', ')}`);
  console.log(`[vista] uploads served to the model at ${PUBLIC_BASE}/files/...`);
});
