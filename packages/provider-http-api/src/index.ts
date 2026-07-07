import { createHash, type RemoteDocument, type SyncProvider } from '@app-sync-kit/sync-core';

export interface HttpApiProviderConfig {
  baseUrl: string;
  appId: string;
  authToken?: string;
  getPath?: string;
  putPath?: string;
}

export interface HttpApiProviderOptions {
  fetchImpl?: typeof fetch;
}

function buildHeaders(config: HttpApiProviderConfig): HeadersInit {
  if (!config.authToken) return { 'Content-Type': 'application/json; charset=utf-8' };

  return {
    'Content-Type': 'application/json; charset=utf-8',
    Authorization: `Bearer ${config.authToken}`
  };
}

export function createHttpApiProvider<TData>(
  options: HttpApiProviderOptions = {}
): SyncProvider<TData, HttpApiProviderConfig> {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async pull(config) {
      const getPath = config.getPath ?? `/sync/documents/${encodeURIComponent(config.appId)}`;
      const response = await fetchImpl(new URL(getPath, config.baseUrl).toString(), {
        method: 'GET',
        headers: buildHeaders(config)
      });

      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`HTTP pull failed: ${response.status}`);
      }

      const document = (await response.json()) as RemoteDocument<TData>;
      return {
        document,
        hash: createHash(document.data)
      };
    },
    async push(config, document) {
      const putPath = config.putPath ?? `/sync/documents/${encodeURIComponent(config.appId)}`;
      const response = await fetchImpl(new URL(putPath, config.baseUrl).toString(), {
        method: 'PUT',
        headers: buildHeaders(config),
        body: JSON.stringify(document)
      });

      if (!response.ok) {
        throw new Error(`HTTP push failed: ${response.status}`);
      }

      return {
        document,
        hash: createHash(document.data)
      };
    },
    async healthCheck(config) {
      const response = await fetchImpl(new URL('/health', config.baseUrl).toString(), {
        method: 'GET',
        headers: config.authToken ? { Authorization: `Bearer ${config.authToken}` } : undefined
      });

      if (!response.ok) {
        throw new Error(`HTTP health check failed: ${response.status}`);
      }
    }
  };
}
