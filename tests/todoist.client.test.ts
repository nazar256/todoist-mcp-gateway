import { describe, expect, it, vi } from 'vitest';
import { TodoistClient } from '../src/todoist/client';
import { createJsonResponse } from './helpers';

describe('todoist client', () => {
  it('uses correct REST base URL and sends Authorization Bearer and X-Request-Id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse([{ id: '1' }]));
    const client = new TodoistClient('secret', fetchMock as unknown as typeof fetch);
    await client.get('/tasks');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.todoist.com/api/v1/tasks');
    expect((init.headers as Headers).get('authorization')).toBe('Bearer secret');
    expect((init.headers as Headers).get('x-request-id')).toBeTruthy();
  });

  it('uses correct Sync base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }));
    const client = new TodoistClient('secret', fetchMock as unknown as typeof fetch);
    await client.sync([{ type: 'item_move', uuid: 'u', args: {} }]);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.todoist.com/api/v1/sync');
  });

  it('handles 204 No Content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new TodoistClient('secret', fetchMock as unknown as typeof fetch);
    await expect(client.delete('/tasks/1')).resolves.toBeNull();
  });

  it('maps non-2xx errors safely', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'bad' }), { status: 500, headers: { 'content-type': 'application/json' } }));
    const client = new TodoistClient('secret', fetchMock as unknown as typeof fetch);
    await expect(client.get('/tasks')).rejects.toThrow(/status 500/);
  });

  it('rejects unsafe path params', () => {
    expect(() => TodoistClient.encodePathParam('../secret', 'id')).toThrow(/unsafe/);
  });

  it('wraps fetch implementation to avoid unbound invocation issues', async () => {
    const calls: Array<{ self: unknown; url: RequestInfo | URL; init?: RequestInit }> = [];
    function fetchLike(this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      calls.push({ self: this, url: input, init });
      return Promise.resolve(createJsonResponse([{ id: '1' }]));
    }

    const client = new TodoistClient('secret', fetchLike as unknown as typeof fetch);
    await client.get('/tasks');

    expect(calls).toHaveLength(1);
    expect(String(calls[0]!.url)).toBe('https://api.todoist.com/api/v1/tasks');
  });

  it('unwraps paginated results arrays from Todoist v1 list endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ results: [{ id: '1' }], next_cursor: null }));
    const client = new TodoistClient('secret', fetchMock as unknown as typeof fetch);

    await expect(client.get('/projects')).resolves.toEqual([{ id: '1' }]);
  });

  it('maps completed tasks endpoint response items to an array', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ items: [{ id: 'c1' }] }));
    const client = new TodoistClient('secret', fetchMock as unknown as typeof fetch);

    await expect(client.getCompletedTasks({ since: '2026-05-01T00:00:00Z', until: '2026-05-02T00:00:00Z' })).resolves.toEqual([{ id: 'c1' }]);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.todoist.com/api/v1/tasks/completed/by_completion_date?since=2026-05-01T00%3A00%3A00Z&until=2026-05-02T00%3A00%3A00Z');
  });
});
