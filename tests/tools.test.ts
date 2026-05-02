import { describe, expect, it, vi } from 'vitest';
import { createTodoistMcpServer } from '../src/mcp/server';
import { TodoistClient } from '../src/todoist/client';
import { createJsonResponse } from './helpers';

async function callRegisteredTool(fetchMock: ReturnType<typeof vi.fn>, name: string, args: Record<string, unknown>) {
  const server = createTodoistMcpServer(new TodoistClient('secret', fetchMock as unknown as typeof fetch), { scope: 'todoist.read todoist.write' });
  const tool = (server as any)._registeredTools[name];
  return tool.handler(args, {});
}

function createServerWithScope(fetchMock: ReturnType<typeof vi.fn>, scope: string) {
  return createTodoistMcpServer(new TodoistClient('secret', fetchMock as unknown as typeof fetch), { scope });
}

describe('tools', () => {
  it('get_tasks_list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse([{ id: '1' }]));
    const result = await callRegisteredTool(fetchMock, 'get_tasks_list', { filter: 'today' });
    expect(result.content[0].text).toContain('1');
  });

  it('create_tasks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ id: '1', content: 'task' }));
    const result = await callRegisteredTool(fetchMock, 'create_tasks', { items: [{ content: 'task' }] });
    expect(result.content[0].text).toContain('"ok": true');
  });

  it('update_tasks', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse([{ id: '1', content: 'task' }]))
      .mockResolvedValueOnce(createJsonResponse({ id: '1', content: 'updated' }));
    const result = await callRegisteredTool(fetchMock, 'update_tasks', { items: [{ task_name: 'task', content: 'updated' }] });
    expect(result.content[0].text).toContain('updated');
  });

  it('close_tasks', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse([{ id: '1', content: 'task' }]))
      .mockResolvedValueOnce(createJsonResponse(null));
    const result = await callRegisteredTool(fetchMock, 'close_tasks', { items: [{ task_name: 'task' }] });
    expect(result.content[0].text).toContain('"ok": true');
  });

  it('delete_tasks', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse([{ id: '1', content: 'task' }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await callRegisteredTool(fetchMock, 'delete_tasks', { items: [{ task_name: 'task' }] });
    expect(result.content[0].text).toContain('"ok": true');
  });

  it('fails safe on ambiguous exact mutation target names', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createJsonResponse([
      { id: '1', content: 'task' },
      { id: '2', content: 'task' },
    ]));
    const result = await callRegisteredTool(fetchMock, 'update_tasks', { items: [{ task_name: 'task', content: 'updated' }] });
    expect(result.content[0].text).toContain('ambiguous_match');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails safe on ambiguous substring destructive target names', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createJsonResponse([
      { id: 'p1', name: 'Work Alpha' },
      { id: 'p2', name: 'Work Beta' },
    ]));
    const result = await callRegisteredTool(fetchMock, 'delete_projects', { items: [{ name: 'Work' }] });
    expect(result.content[0].text).toContain('ambiguous_match');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('move_tasks', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse([{ id: '1', content: 'task' }]))
      .mockResolvedValueOnce(createJsonResponse({ sync_status: { a: 'ok' } }));
    const result = await callRegisteredTool(fetchMock, 'move_tasks', { items: [{ task_name: 'task', project_id: 'p1' }] });
    expect(result.content[0].text).toContain('sync_status');
  });

  it('get_projects_list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse([{ id: 'p1' }]));
    const result = await callRegisteredTool(fetchMock, 'get_projects_list', {});
    expect(result.content[0].text).toContain('p1');
    expect(result.structuredContent).toEqual({ items: [{ id: 'p1' }] });
  });

  it('get_projects_list tolerates undefined args from MCP clients', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse([{ id: 'p1' }]));
    const server = createTodoistMcpServer(new TodoistClient('secret', fetchMock as unknown as typeof fetch), { scope: 'todoist.read todoist.write' });
    const tool = (server as any)._registeredTools.get_projects_list;
    const result = await tool.handler(undefined, {});

    expect(result.content[0].text).toContain('p1');
    expect(result.structuredContent).toEqual({ items: [{ id: 'p1' }] });
  });

  it('create_projects', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ id: 'p1', name: 'Work' }));
    const result = await callRegisteredTool(fetchMock, 'create_projects', { items: [{ name: 'Work' }] });
    expect(result.content[0].text).toContain('Work');
  });

  it('update_projects supports rename by id', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createJsonResponse({ id: 'p1', name: 'Renamed' }));
    const result = await callRegisteredTool(fetchMock, 'update_projects', { items: [{ id: 'p1', name: 'Renamed' }] });

    expect(result.content[0].text).toContain('Renamed');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.todoist.com/api/v1/projects/p1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Renamed' }),
      }),
    );
  });

  it('update_projects supports rename by explicit project_name selector', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse([{ id: 'p1', name: 'Old Project' }]))
      .mockResolvedValueOnce(createJsonResponse({ id: 'p1', name: 'New Project' }));
    const result = await callRegisteredTool(fetchMock, 'update_projects', { items: [{ project_name: 'Old Project', name: 'New Project' }] });

    expect(result.content[0].text).toContain('New Project');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.todoist.com/api/v1/projects/p1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'New Project' }),
      }),
    );
  });

  it('get_sections_list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse([{ id: 's1' }]));
    const result = await callRegisteredTool(fetchMock, 'get_sections_list', {});
    expect(result.content[0].text).toContain('s1');
  });

  it('update_sections supports rename by id', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createJsonResponse({ id: 's1', name: 'Renamed' }));
    const result = await callRegisteredTool(fetchMock, 'update_sections', { items: [{ id: 's1', name: 'Renamed' }] });

    expect(result.content[0].text).toContain('Renamed');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.todoist.com/api/v1/sections/s1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Renamed' }),
      }),
    );
  });

  it('update_sections supports rename by explicit section_name selector', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse([{ id: 's1', name: 'Old Name' }]))
      .mockResolvedValueOnce(createJsonResponse({ id: 's1', name: 'New Name' }));
    const result = await callRegisteredTool(fetchMock, 'update_sections', { items: [{ section_name: 'Old Name', name: 'New Name' }] });

    expect(result.content[0].text).toContain('New Name');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.todoist.com/api/v1/sections/s1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'New Name' }),
      }),
    );
  });

  it('create_comments', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ id: 'c1', content: 'note' }));
    const result = await callRegisteredTool(fetchMock, 'create_comments', { items: [{ task_id: '1', content: 'note' }] });
    expect(result.content[0].text).toContain('c1');
  });

  it('get_labels_list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse([{ id: 'l1' }]));
    const result = await callRegisteredTool(fetchMock, 'get_labels_list', {});
    expect(result.content[0].text).toContain('l1');
  });

  it('rename_shared_labels', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }));
    const result = await callRegisteredTool(fetchMock, 'rename_shared_labels', { items: [{ name: 'old', new_name: 'new' }] });
    expect(result.content[0].text).toContain('"ok": true');
  });

  it('update_labels supports rename by id', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createJsonResponse({ id: 'l1', name: 'Renamed' }));
    const result = await callRegisteredTool(fetchMock, 'update_labels', { items: [{ id: 'l1', name: 'Renamed' }] });

    expect(result.content[0].text).toContain('Renamed');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.todoist.com/api/v1/labels/l1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'Renamed' }),
      }),
    );
  });

  it('update_labels supports rename by explicit label_name selector', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse([{ id: 'l1', name: 'Old Label' }]))
      .mockResolvedValueOnce(createJsonResponse({ id: 'l1', name: 'New Label' }));
    const result = await callRegisteredTool(fetchMock, 'update_labels', { items: [{ label_name: 'Old Label', name: 'New Label' }] });

    expect(result.content[0].text).toContain('New Label');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.todoist.com/api/v1/labels/l1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'New Label' }),
      }),
    );
  });

  it('utils_get_colors', async () => {
    const fetchMock = vi.fn();
    const result = await callRegisteredTool(fetchMock, 'utils_get_colors', {});
    expect(result.content[0].text).toContain('berry_red');
    expect(Array.isArray((result.structuredContent as { items: unknown[] }).items)).toBe(true);
  });

  it('utils_get_colors tolerates undefined args from MCP clients', async () => {
    const fetchMock = vi.fn();
    const server = createTodoistMcpServer(new TodoistClient('secret', fetchMock as unknown as typeof fetch), { scope: 'todoist.read todoist.write' });
    const tool = (server as any)._registeredTools.utils_get_colors;
    const result = await tool.handler(undefined, {});

    expect(result.content[0].text).toContain('berry_red');
    expect(Array.isArray((result.structuredContent as { items: unknown[] }).items)).toBe(true);
  });

  it('projects_list prompt', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse([{ id: 'p1', name: 'Work' }]))
      .mockResolvedValueOnce(createJsonResponse([{ id: 's1', name: 'Today', project_id: 'p1' }]));
    const server = createServerWithScope(fetchMock, 'todoist.read todoist.write');
    const prompt = (server as any)._registeredPrompts.projects_list;
    const result = await prompt.callback({}, {});
    expect(result.messages[0].content.text).toContain('Work');
    expect(result.messages[0].content.text).toContain('Today');
  });

  it('projects_list prompt requires todoist.read scope', async () => {
    const fetchMock = vi.fn();
    const server = createServerWithScope(fetchMock, 'todoist.write');
    const prompt = (server as any)._registeredPrompts.projects_list;
    await expect(prompt.callback({}, {})).rejects.toMatchObject({
      code: 'insufficient_scope',
      status: 403,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
