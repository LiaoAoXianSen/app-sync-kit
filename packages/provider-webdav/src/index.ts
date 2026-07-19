import {
  createHash,
  SyncHttpError,
  type RemoteDocument,
  type RemoteDocumentEnvelope,
  type SyncProvider,
  type SyncPushOptions
} from '@app-sync-kit/sync-core';

export interface WebdavProviderConfig {
  endpoint: string;
  remotePath: string;
  writeMode?: 'wrapped-document' | 'legacy-raw-data';
}

export interface WebdavProviderOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function getResponseEtag(response: Response): string {
  const etag = response.headers.get('ETag') || response.headers.get('X-Remote-ETag') || '';
  return String(etag || '').trim();
}

async function request(
  fetchImpl: typeof fetch,
  endpoint: string,
  remotePath: string,
  method: string,
  body?: string,
  acceptedStatuses: number[] = [200, 201, 204, 207],
  extraHeaders: Record<string, string> = {},
  timeoutMs = 20000
): Promise<Response> {
  const base = `${endpoint.replace(/\/+$/, '')}/`;
  const target = remotePath.replace(/^\/+/, '');
  const headers: Record<string, string> = { ...extraHeaders };
  if (body) headers['Content-Type'] = 'application/json; charset=utf-8';
  if (method === 'PROPFIND' && !headers.Depth) headers.Depth = '0';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(base + target, {
      method,
      mode: 'cors',
      headers: Object.keys(headers).length ? headers : undefined,
      body,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`WebDAV ${method} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    const detail = await response.clone().text().catch(() => '');
    throw new SyncHttpError(
      `WebDAV ${method} failed: ${response.status}${detail ? ` ${detail.slice(0, 120)}` : ''}`,
      {
        status: response.status,
        method,
        etag: getResponseEtag(response)
      }
    );
  }

  return response;
}

function normalizeRemotePath(remotePath: string): string {
  return remotePath.startsWith('/') ? remotePath : `/${remotePath}`;
}

function getParentFolders(remotePath: string): string[] {
  const segments = normalizeRemotePath(remotePath).split('/').filter(Boolean).slice(0, -1);
  const folders: string[] = [];
  let current = '';

  segments.forEach((segment) => {
    current += `/${segment}`;
    folders.push(current);
  });

  return folders;
}

async function ensureRemoteFolders(
  fetchImpl: typeof fetch,
  endpoint: string,
  remotePath: string,
  timeoutMs: number
): Promise<void> {
  const folders = getParentFolders(remotePath);

  for (const folder of folders) {
    await request(fetchImpl, endpoint, folder, 'MKCOL', undefined, [200, 201, 204, 207, 405], {}, timeoutMs);
  }
}

function toEnvelope<TData>(
  config: WebdavProviderConfig,
  payload: unknown,
  etag = ''
): RemoteDocumentEnvelope<TData> {
  const candidate = payload as Partial<RemoteDocument<TData>>;

  if (config.writeMode !== 'legacy-raw-data' && candidate?.appId && candidate?.schemaVersion && 'data' in candidate) {
    const document = candidate as RemoteDocument<TData>;
    return {
      document,
      hash: createHash(document.data),
      etag
    };
  }

  return {
    document: {
      appId: 'legacy-app',
      schemaVersion: 1,
      updatedAt: new Date(0).toISOString(),
      data: payload as TData
    },
    hash: createHash(payload),
    etag
  };
}

export function createWebdavProvider<TData>(
  options: WebdavProviderOptions = {}
): SyncProvider<TData, WebdavProviderConfig> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20000;

  return {
    async pull(config) {
      try {
        const response = await request(
          fetchImpl,
          config.endpoint,
          config.remotePath,
          'GET',
          undefined,
          [200, 201, 204, 207],
          {},
          timeoutMs
        );
        const text = await response.text();
        if (!text.trim()) return null;
        return toEnvelope(config, JSON.parse(text), getResponseEtag(response));
      } catch (error) {
        if (
          (error instanceof SyncHttpError && error.status === 404) ||
          (error instanceof Error && error.message.includes(' 404'))
        ) {
          return null;
        }
        throw error;
      }
    },
    async push(config, document, pushOptions: SyncPushOptions = {}) {
      const remotePath = normalizeRemotePath(config.remotePath);
      const payload =
        config.writeMode === 'legacy-raw-data'
          ? JSON.stringify(document.data, null, 2)
          : JSON.stringify(document, null, 2);

      await ensureRemoteFolders(fetchImpl, config.endpoint, remotePath, timeoutMs);
      const headers: Record<string, string> = {};
      if (pushOptions.ifMatch) headers['If-Match'] = pushOptions.ifMatch;

      const response = await request(
        fetchImpl,
        config.endpoint,
        remotePath,
        'PUT',
        payload,
        [200, 201, 204, 207],
        headers,
        timeoutMs
      );

      let responseEtag = getResponseEtag(response);
      if (!responseEtag) {
        try {
          const body = await response.clone().json();
          if (body?.etag) responseEtag = String(body.etag);
        } catch {
          // ignore non-json response bodies
        }
      }

      return {
        document,
        hash: createHash(document.data),
        etag: responseEtag
      };
    },
    async healthCheck(config) {
      const remotePath = normalizeRemotePath(config.remotePath);
      const folderPath = remotePath.split('/').slice(0, -1).join('/') || '/';
      await request(
        fetchImpl,
        config.endpoint,
        folderPath,
        'PROPFIND',
        undefined,
        [200, 201, 204, 207, 404],
        { Depth: '0' },
        timeoutMs
      );
    }
  };
}
