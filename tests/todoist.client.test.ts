import { describe, expect, it, vi } from 'vitest';
import { TodoistClient } from '../src/todoist/client';
import { createJsonResponse } from './helpers';

describe('todoist client', () => {
  it('uses correct REST base URL and sends Authorization Bearer and X-Request-Id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse([{ id: '1' }]));
    const client = new TodoistClient('secret', fetchMock as unknown as typeof fetch);
    await client.get('/tasks');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.todoist.com/rest/v2/tasks');
    expect((init.headers as Headers).get('authorization')).toBe('Bearer secret');
    expect((init.headers as Headers).get('x-request-id')).toBeTruthy();
  });

  it('uses correct Sync base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }));
    const client = new TodoistClient('secret', fetchMock as unknown as typeof fetch);
    await client.sync([{ type: 'item_move', uuid: 'u', args: {} }]);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.todoist.com/sync/v9/sync');
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
});
