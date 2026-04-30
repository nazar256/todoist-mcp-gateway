import { describe, expect, it, vi } from 'vitest';
import { createTodoistMcpServer } from '../src/mcp/server';
import { TodoistClient } from '../src/todoist/client';

describe('mcp tools', () => {
  it('tool validation rejects bad inputs', async () => {
    const fetchMock = vi.fn();
    const server = createTodoistMcpServer(new TodoistClient('secret', fetchMock as unknown as typeof fetch), { scope: 'todoist.read todoist.write' });
    const result = await (server as any)._registeredTools.move_tasks.handler({ items: 'bad-input' }, {});
    expect(result.structuredContent).toMatchObject({
      ok: false,
      error: { code: 'invalid_request', status: 400 },
    });
    expect(result.content[0].text).toContain('invalid_request');
    expect(result.content[0].text).not.toContain('internal_error');
  });
});
