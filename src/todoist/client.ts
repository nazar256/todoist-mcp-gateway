import { HttpError, validateSafePathSegment } from '../security/validators';
import type { SyncCommand } from './types';

const REST_BASE_URL = 'https://api.todoist.com/api/v1';
const SYNC_BASE_URL = 'https://api.todoist.com/api/v1';

type PaginatedResults<T> = {
  results: T[];
  next_cursor?: string | null;
};

function isPaginatedResults(value: unknown): value is PaginatedResults<unknown> {
  return typeof value === 'object' && value !== null && 'results' in value && Array.isArray((value as { results?: unknown }).results);
}

export class TodoistClient {
  private readonly todoistApiToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(todoistApiToken: string, fetchImpl: typeof fetch = fetch) {
    this.todoistApiToken = todoistApiToken;
    this.fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => fetchImpl(input, init);
  }

  private buildHeaders(withJsonBody = false): Headers {
    const headers = new Headers({
      Authorization: `Bearer ${this.todoistApiToken}`,
      Accept: 'application/json',
      'X-Request-Id': crypto.randomUUID(),
    });

    if (withJsonBody) {
      headers.set('Content-Type', 'application/json');
    }

    return headers;
  }

  private buildUrl(baseUrl: string, path: string, params?: Record<string, string | number | boolean | undefined>): string {
    if (!path.startsWith('/')) {
      throw new HttpError(500, 'internal_error', 'Todoist path must start with /');
    }

    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  async request(
    method: 'GET' | 'POST' | 'DELETE',
    baseUrl: string,
    path: string,
    options?: { params?: Record<string, string | number | boolean | undefined>; body?: unknown },
  ): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: this.buildHeaders(method === 'POST'),
    };

    if (method === 'POST') {
      init.body = JSON.stringify(options?.body ?? {});
    }

    const response = await this.fetchImpl(this.buildUrl(baseUrl, path, options?.params), init);

    if (response.status === 204) {
      return null;
    }

    const text = await response.text();
    const contentType = response.headers.get('content-type') ?? '';
    const parsed = contentType.includes('application/json') && text ? JSON.parse(text) : text || null;

    if (!response.ok) {
      throw new HttpError(response.status, 'todoist_api_error', `Todoist API request failed with status ${response.status}`);
    }

    return parsed;
  }

  async get(path: string, params?: Record<string, string | number | boolean | undefined>): Promise<unknown> {
    const data = await this.request('GET', REST_BASE_URL, path, params ? { params } : undefined);
    return isPaginatedResults(data) ? data.results : data;
  }

  async post(path: string, body?: unknown): Promise<unknown> {
    return this.request('POST', REST_BASE_URL, path, { body });
  }

  async delete(path: string): Promise<unknown> {
    return this.request('DELETE', REST_BASE_URL, path);
  }

  async sync(commands: SyncCommand[]): Promise<unknown> {
    return this.request('POST', SYNC_BASE_URL, '/sync', { body: { commands } });
  }

  async getCompletedTasks(params?: Record<string, string>): Promise<unknown> {
    const normalizedParams = { ...params };
    if (!normalizedParams.since) {
      normalizedParams.since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    }
    if (!normalizedParams.until) {
      normalizedParams.until = new Date().toISOString();
    }

    const data = await this.request('GET', REST_BASE_URL, '/tasks/completed/by_completion_date', { params: normalizedParams });
    if (typeof data === 'object' && data !== null && 'items' in data && Array.isArray((data as { items?: unknown }).items)) {
      return (data as { items: unknown[] }).items;
    }
    return data;
  }

  static encodePathParam(value: string, fieldName: string): string {
    return validateSafePathSegment(value, fieldName);
  }
}
