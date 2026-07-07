import { createHash, type RemoteDocument, type RemoteDocumentEnvelope, type SyncProvider } from '@app-sync-kit/sync-core';

export interface WebdavProviderConfig {
  endpoint: string;
  remotePath: string;
  writeMode?: 'wrapped-document' | 'legacy-raw-data';
}

export interface WebdavProviderOptions {
  fetchImpl?: typeof fetch;
}

async function request(
  fetchImpl: typeof fetch,
  endpoint: string,
  remotePath: string,
  method: string,
  body?: string
): Promise<Response> {
  const base = endpoint.replace(/\/+$/, '/');
  const target = remotePath.replace(/^\/+/, '');
  const response = await fetchImpl(base + target, {
    method,
    mode: 'cors',
    headers: body ? { 'Content-Type': 'application/json; charset=utf-8' } : undefined,
    body
  });

  if (!response.ok && response.status !== 207) {
    const detail = await response.clone().text().catch(() => '');
    throw new Error(`WebDAV ${method} failed: ${response.status}${detail ? ` ${detail.slice(0, 120)}` : ''}`);
  }

  return response;
}

function toEnvelope<TData>(
  config: WebdavProviderConfig,
  payload: unknown
): RemoteDocumentEnvelope<TData> {
  const candidate = payload as Partial<RemoteDocument<TData>>;

  if (config.writeMode !== 'legacy-raw-data' && candidate?.appId && candidate?.schemaVersion && 'data' in candidate) {
    const document = candidate as RemoteDocument<TData>;
    return {
      document,
      hash: createHash(document.data)
    };
  }

  return {
    document: {
      appId: 'legacy-app',
      schemaVersion: 1,
      updatedAt: new Date(0).toISOString(),
      data: payload as TData
    },
    hash: createHash(payload)
  };
}

export function createWebdavProvider<TData>(
  options: WebdavProviderOptions = {}
): SyncProvider<TData, WebdavProviderConfig> {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async pull(config) {
      try {
        const response = await request(fetchImpl, config.endpoint, config.remotePath, 'GET');
        const text = await response.text();
        if (!text.trim()) return null;
        return toEnvelope(config, JSON.parse(text));
      } catch (error) {
        if (error instanceof Error && error.message.includes(' 404')) {
          return null;
        }
        throw error;
      }
    },
    async push(config, document) {
      const remotePath = config.remotePath.startsWith('/') ? config.remotePath : `/${config.remotePath}`;
      const payload =
        config.writeMode === 'legacy-raw-data'
          ? JSON.stringify(document.data, null, 2)
          : JSON.stringify(document, null, 2);

      await request(fetchImpl, config.endpoint, remotePath, 'PUT', payload);

      return {
        document,
        hash: createHash(document.data)
      };
    },
    async healthCheck(config) {
      const remotePath = config.remotePath.startsWith('/') ? config.remotePath : `/${config.remotePath}`;
      const folderPath = remotePath.split('/').slice(0, -1).join('/') || '/';
      await request(fetchImpl, config.endpoint, folderPath, 'PROPFIND');
    }
  };
}
