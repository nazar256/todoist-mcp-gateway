import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { hasScope, HttpError } from '../security/validators';
import { TODOIST_COLORS } from '../todoist/colors';
import { TodoistClient } from '../todoist/client';
import { findByCaseInsensitiveNameForMutation, findByCaseInsensitiveSubstring } from '../todoist/lookup';
import {
  createCommentFields,
  createLabelFields,
  createProjectFields,
  createSectionFields,
  createTaskFields,
  labelMutationSelectorSchema,
  labelSelectorSchema,
  projectMutationSelectorSchema,
  projectSelectorSchema,
  sectionMutationSelectorSchema,
  sectionSelectorSchema,
  taskSelectorSchema,
} from '../todoist/schemas';
import type {
  SyncCommand,
  TodoistLabel,
  TodoistProject,
  TodoistSection,
  TodoistTask,
} from '../todoist/types';
import { type BatchResult, type BatchItemResult, createJsonContentResult } from './toolResult';
import type { McpServerAuthContext } from './server';

type JsonMap = Record<string, unknown>;
type RequiredScope = 'todoist.read' | 'todoist.write';
const emptyObjectSchema = z.object({}).optional().transform((value) => value ?? {});

function asItemError(index: number, error: unknown): BatchItemResult {
  if (error instanceof HttpError) {
    return {
      index,
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        status: error.status,
      },
    };
  }

  return {
    index,
    ok: false,
    error: {
      code: 'internal_error',
      message: 'Internal server error',
    },
  };
}

function itemOk(index: number, data: unknown, id?: string, matched_name?: string): BatchItemResult {
  return {
    index,
    ok: true,
    id,
    matched_name,
    data,
  };
}

function batchResult(results: BatchItemResult[]): BatchResult {
  return {
    ok: results.every((item) => item.ok),
    results,
  };
}

function toTaskSelector(value: { task_id?: string; task_name?: string }) {
  return { task_id: value.task_id, task_name: value.task_name };
}

function toProjectSelector(value: { id?: string; name?: string }) {
  return { id: value.id, name: value.name };
}

function toProjectMutationSelector(value: { id?: string; project_name?: string }) {
  return { id: value.id, name: value.project_name };
}

function toSectionSelector(value: { id?: string; name?: string }) {
  return { id: value.id, name: value.name };
}

function toSectionMutationSelector(value: { id?: string; section_name?: string }) {
  return { id: value.id, name: value.section_name };
}

function toLabelSelector(value: { id?: string; name?: string }) {
  return { id: value.id, name: value.name };
}

function toLabelMutationSelector(value: { id?: string; label_name?: string }) {
  return { id: value.id, name: value.label_name };
}

function createToolHandler<Schema extends z.ZodTypeAny>(
  toolName: string,
  schema: Schema,
  handler: (input: z.infer<Schema>) => Promise<unknown>,
  authContext: McpServerAuthContext,
  requiredScope: RequiredScope,
): any {
  return async (args: z.infer<Schema>) => {
    try {
      if (!hasScope(authContext.scope, requiredScope)) {
        throw new HttpError(403, 'insufficient_scope', `${requiredScope} scope is required for this tool`);
      }
      const parsed = schema.parse(args);
      const result = await handler(parsed);
      return createJsonContentResult(result);
    } catch (error) {
      const httpError = error instanceof z.ZodError
        ? new HttpError(400, 'invalid_request', error.issues[0]?.message ?? 'Invalid tool input')
        : error instanceof HttpError
          ? error
          : (() => {
              console.error('Unhandled MCP tool error', {
                tool: toolName,
                name: error instanceof Error ? error.name : typeof error,
                message: error instanceof Error ? error.message : String(error),
              });
              return new HttpError(500, 'internal_error', 'Internal server error');
            })();
      return createJsonContentResult(
        {
          ok: false,
          error: {
            code: httpError.code,
            message: httpError.message,
            status: httpError.status,
          },
        },
        true,
      );
    }
  };
}

function scopeForTool(toolName: string): RequiredScope {
  return toolName.startsWith('get_') || toolName.startsWith('utils_') ? 'todoist.read' : 'todoist.write';
}

function dueFieldValidation<Schema extends z.ZodTypeAny>(schema: Schema): Schema {
  return schema.superRefine((value: any, ctx) => {
    const dueFields = [value.due_string, value.due_date, value.due_datetime].filter(Boolean).length;
    if (dueFields > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only one of due_string, due_date, due_datetime is allowed' });
    }

    if (value.due_lang && !value.due_string) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'due_lang requires due_string' });
    }

    if ((value.duration && !value.duration_unit) || (!value.duration && value.duration_unit)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'duration and duration_unit must be provided together' });
    }
  }) as unknown as Schema;
}

async function resolveTaskId(
  todoistClient: TodoistClient,
  selector: { task_id?: string; task_name?: string },
  options: { allowAmbiguousNameMatch: boolean },
): Promise<{ id: string; matchedName?: string }> {
  if (selector.task_id) {
    return { id: selector.task_id };
  }

  if (!selector.task_name) {
    throw new HttpError(400, 'invalid_request', 'task_id or task_name is required');
  }

  const tasks = (await todoistClient.get('/tasks')) as TodoistTask[];
  const matched = options.allowAmbiguousNameMatch
    ? findByCaseInsensitiveSubstring(tasks, selector.task_name, (task) => task.content)
    : resolveNameForMutation(tasks, selector.task_name, 'Task', (task) => task.content);
  if (!matched) {
    throw new HttpError(404, 'not_found', `Task not found for name: ${selector.task_name}`);
  }

  return { id: matched.id, matchedName: selector.task_name };
}

async function resolveProjectId(
  todoistClient: TodoistClient,
  selector: { id?: string; name?: string },
  options: { allowAmbiguousNameMatch: boolean },
): Promise<{ id: string; matchedName?: string }> {
  if (selector.id) {
    return { id: selector.id };
  }

  if (!selector.name) {
    throw new HttpError(400, 'invalid_request', 'id or name is required');
  }

  const projects = (await todoistClient.get('/projects')) as TodoistProject[];
  const matched = options.allowAmbiguousNameMatch
    ? findByCaseInsensitiveSubstring(projects, selector.name, (project) => project.name)
    : resolveNameForMutation(projects, selector.name, 'Project', (project) => project.name);
  if (!matched) {
    throw new HttpError(404, 'not_found', `Project not found for name: ${selector.name}`);
  }

  return { id: matched.id, matchedName: selector.name };
}

async function resolveSectionId(
  todoistClient: TodoistClient,
  selector: { id?: string; name?: string },
  options: { allowAmbiguousNameMatch: boolean },
): Promise<{ id: string; matchedName?: string }> {
  if (selector.id) {
    return { id: selector.id };
  }

  if (!selector.name) {
    throw new HttpError(400, 'invalid_request', 'id or name is required');
  }

  const sections = (await todoistClient.get('/sections')) as TodoistSection[];
  const matched = options.allowAmbiguousNameMatch
    ? findByCaseInsensitiveSubstring(sections, selector.name, (section) => section.name)
    : resolveNameForMutation(sections, selector.name, 'Section', (section) => section.name);
  if (!matched) {
    throw new HttpError(404, 'not_found', `Section not found for name: ${selector.name}`);
  }

  return { id: matched.id, matchedName: selector.name };
}

async function resolveLabelId(
  todoistClient: TodoistClient,
  selector: { id?: string; name?: string },
  options: { allowAmbiguousNameMatch: boolean },
): Promise<{ id: string; matchedName?: string }> {
  if (selector.id) {
    return { id: selector.id };
  }

  if (!selector.name) {
    throw new HttpError(400, 'invalid_request', 'id or name is required');
  }

  const labels = (await todoistClient.get('/labels')) as TodoistLabel[];
  const matched = options.allowAmbiguousNameMatch
    ? findByCaseInsensitiveSubstring(labels, selector.name, (label) => label.name)
    : resolveNameForMutation(labels, selector.name, 'Label', (label) => label.name);
  if (!matched) {
    throw new HttpError(404, 'not_found', `Label not found for name: ${selector.name}`);
  }

  return { id: matched.id, matchedName: selector.name };
}

async function runBatch<TItem>(items: TItem[], worker: (item: TItem, index: number) => Promise<BatchItemResult>): Promise<BatchResult> {
  const results: BatchItemResult[] = [];
  for (let index = 0; index < items.length; index += 1) {
    try {
      results.push(await worker(items[index] as TItem, index));
    } catch (error) {
      results.push(asItemError(index, error));
    }
  }
  return batchResult(results);
}

function ensureExactlyOne(values: Array<unknown>, message: string): void {
  if (values.filter(Boolean).length !== 1) {
    throw new HttpError(400, 'invalid_request', message);
  }
}

function resolveNameForMutation<T>(items: T[], needle: string, itemType: string, selectName: (item: T) => string | undefined): T {
  const result = findByCaseInsensitiveNameForMutation(items, needle, selectName);
  if (result.kind === 'exact' || result.kind === 'unique_substring') {
    return result.item;
  }

  if (result.kind === 'ambiguous_exact') {
    throw new HttpError(409, 'ambiguous_match', `${itemType} name matched multiple exact items; use id instead`);
  }

  if (result.kind === 'ambiguous_substring') {
    throw new HttpError(409, 'ambiguous_match', `${itemType} name matched multiple items; use id or a more specific exact name`);
  }

  throw new HttpError(404, 'not_found', `${itemType} not found for name: ${needle}`);
}

export function registerTools(server: McpServer, todoistClient: TodoistClient, authContext: McpServerAuthContext): void {
  const createTaskSchema = dueFieldValidation(z.object(createTaskFields));
  const updateTaskSchema = dueFieldValidation(
    z.object({ ...taskSelectorSchema, ...createTaskFields }).refine(
      (value) => Boolean(value.task_id || value.task_name),
      'task_id or task_name is required',
    ),
  );
  const labelUpdateFields = z.object(createLabelFields).partial().shape;
  // McpServer.registerTool has complex overloaded signatures; typed via zod schema instead
  const registerScopedTool = <Schema extends z.ZodTypeAny>(
    name: string,
    config: Record<string, unknown>,
    schema: Schema,
    handler: (input: z.infer<Schema>) => Promise<unknown>,
  ) => (server.registerTool as any)(name, config, createToolHandler(name, schema, handler, authContext, scopeForTool(name)));

  registerScopedTool(
    'get_tasks_list',
    {
      description: 'Read active Todoist tasks with optional filtering by project, section, label, filter, language, or ids.',
      inputSchema: {
        project_id: z.string().optional(),
        section_id: z.string().optional(),
        label: z.string().optional(),
        filter: z.string().optional(),
        lang: z.string().optional(),
        ids: z.union([z.string(), z.array(z.string())]).optional(),
      },
    },
    z.object({
        project_id: z.string().optional(),
        section_id: z.string().optional(),
        label: z.string().optional(),
        filter: z.string().optional(),
        lang: z.string().optional(),
        ids: z.union([z.string(), z.array(z.string())]).optional(),
      }),
      async (input) => {
        const params: JsonMap = { ...input };
        if (Array.isArray(input.ids)) {
          params.ids = input.ids.join(',');
        }
        return todoistClient.get('/tasks', params as Record<string, string>);
      },
  );

  registerScopedTool(
    'get_tasks_by_filter',
    {
      description: 'Read active Todoist tasks using Todoist filter syntax such as today, overdue, p1, or #Work & @urgent.',
      inputSchema: { filter: z.string() },
    },
    z.object({ filter: z.string() }),
    async ({ filter }) => todoistClient.get('/tasks', { filter }),
  );

  registerScopedTool(
    'get_completed_tasks',
    {
      description: 'Read completed Todoist tasks with optional project, task, section, and date filters.',
      inputSchema: {
        project_id: z.string().optional(),
        section_id: z.string().optional(),
        parent_id: z.string().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        limit: z.string().optional(),
      },
    },
    z.object({
        project_id: z.string().optional(),
        section_id: z.string().optional(),
        parent_id: z.string().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        limit: z.string().optional(),
      }),
      async (input) => todoistClient.getCompletedTasks(input as Record<string, string>),
  );

  registerScopedTool(
    'create_tasks',
    {
      description: 'Create one or more Todoist tasks.',
      inputSchema: { items: z.array(createTaskSchema) },
    },
    z.object({ items: z.array(createTaskSchema) }), async ({ items }) => {
      return runBatch(items, async (item, index) => {
        const created = await todoistClient.post('/tasks', item);
        const id = typeof created === 'object' && created && 'id' in created ? String((created as { id: unknown }).id) : undefined;
        return itemOk(index, created, id);
      });
    },
  );

  registerScopedTool(
    'get_tasks',
    {
      description: 'Read Todoist tasks by exact id or by case-insensitive task name substring.',
      inputSchema: { items: z.array(z.object(taskSelectorSchema).refine((value) => Boolean(value.task_id || value.task_name), 'task_id or task_name is required')) },
    },
    z.object({ items: z.array(z.object(taskSelectorSchema).refine((value) => Boolean(value.task_id || value.task_name), 'task_id or task_name is required')) }),
      async ({ items }) => runBatch(items, async (item, index) => {
        const resolved = await resolveTaskId(todoistClient, toTaskSelector(item), { allowAmbiguousNameMatch: true });
        const task = await todoistClient.get(`/tasks/${TodoistClient.encodePathParam(resolved.id, 'task_id')}`);
        return itemOk(index, task, resolved.id, resolved.matchedName);
      }),
  );

  registerScopedTool(
    'update_tasks',
    {
      description: 'Mutate Todoist tasks by id or task name substring.',
      inputSchema: { items: z.array(updateTaskSchema) },
    },
    z.object({ items: z.array(updateTaskSchema) }), async ({ items }) => {
      return runBatch(items, async (item, index) => {
        const resolved = await resolveTaskId(todoistClient, toTaskSelector(item), { allowAmbiguousNameMatch: false });
        const body = { ...item } as JsonMap;
        delete body.task_id;
        delete body.task_name;
        const updated = await todoistClient.post(`/tasks/${TodoistClient.encodePathParam(resolved.id, 'task_id')}`, body);
        return itemOk(index, updated, resolved.id, resolved.matchedName);
      });
    },
  );

  for (const [name, suffix, description] of [
    ['close_tasks', 'close', 'Mutate Todoist tasks by closing them as completed.'],
    ['reopen_tasks', 'reopen', 'Mutate Todoist tasks by reopening them.'],
  ] as const) {
      registerScopedTool(
        name,
      {
        description,
        inputSchema: { items: z.array(z.object(taskSelectorSchema).refine((value) => Boolean(value.task_id || value.task_name), 'task_id or task_name is required')) },
      },
        z.object({ items: z.array(z.object(taskSelectorSchema).refine((value) => Boolean(value.task_id || value.task_name), 'task_id or task_name is required')) }),
          async ({ items }) => runBatch(items, async (item, index) => {
          const resolved = await resolveTaskId(todoistClient, toTaskSelector(item), { allowAmbiguousNameMatch: false });
          const data = await todoistClient.post(`/tasks/${TodoistClient.encodePathParam(resolved.id, 'task_id')}/${suffix}`);
          return itemOk(index, data, resolved.id, resolved.matchedName);
        }),
      );
  }

  registerScopedTool(
    'delete_tasks',
    {
      description: 'Destructively delete Todoist tasks by id or task name substring.',
      inputSchema: { items: z.array(z.object(taskSelectorSchema).refine((value) => Boolean(value.task_id || value.task_name), 'task_id or task_name is required')) },
    },
    z.object({ items: z.array(z.object(taskSelectorSchema).refine((value) => Boolean(value.task_id || value.task_name), 'task_id or task_name is required')) }),
      async ({ items }) => runBatch(items, async (item, index) => {
        const resolved = await resolveTaskId(todoistClient, toTaskSelector(item), { allowAmbiguousNameMatch: false });
        const data = await todoistClient.delete(`/tasks/${TodoistClient.encodePathParam(resolved.id, 'task_id')}`);
        return itemOk(index, data, resolved.id, resolved.matchedName);
      }),
  );

  registerScopedTool(
    'move_tasks',
    {
      description: 'Mutate Todoist tasks by moving them to exactly one parent, section, or project destination.',
      inputSchema: {
        items: z.array(z.object({ ...taskSelectorSchema, parent_id: z.string().optional(), section_id: z.string().optional(), project_id: z.string().optional() })),
      },
    },
    z.object({ items: z.array(z.object({ ...taskSelectorSchema, parent_id: z.string().optional(), section_id: z.string().optional(), project_id: z.string().optional() })) }),
      async ({ items }) => {
        return runBatch(items, async (item, index) => {
          ensureExactlyOne([item.parent_id, item.section_id, item.project_id], 'Exactly one of parent_id, section_id, or project_id is required');
          const resolved = await resolveTaskId(todoistClient, toTaskSelector(item), { allowAmbiguousNameMatch: false });
          const command: SyncCommand = {
            type: 'item_move',
            uuid: crypto.randomUUID(),
            args: {
              id: resolved.id,
              ...(item.parent_id ? { parent_id: item.parent_id } : {}),
              ...(item.section_id ? { section_id: item.section_id } : {}),
              ...(item.project_id ? { project_id: item.project_id } : {}),
            },
          };
          const data = await todoistClient.sync([command]);
          return itemOk(index, data, resolved.id, resolved.matchedName);
        });
      },
  );

  registerScopedTool(
    'get_projects_list',
    {
      description: 'Read Todoist projects.',
      inputSchema: {},
    },
    emptyObjectSchema, async () => todoistClient.get('/projects'),
  );

  registerScopedTool(
    'create_projects',
    { description: 'Create one or more Todoist projects.', inputSchema: { items: z.array(z.object(createProjectFields)) } },
    z.object({ items: z.array(z.object(createProjectFields)) }), async ({ items }) => runBatch(items, async (item, index) => {
      const created = await todoistClient.post('/projects', item);
      const id = typeof created === 'object' && created && 'id' in created ? String((created as { id: unknown }).id) : undefined;
      return itemOk(index, created, id);
    }),
  );

  registerScopedTool(
    'get_projects',
    { description: 'Read Todoist projects by id or name substring.', inputSchema: { items: z.array(z.object(projectSelectorSchema).refine((value) => Boolean(value.id || value.name), 'id or name is required')) } },
    z.object({ items: z.array(z.object(projectSelectorSchema).refine((value) => Boolean(value.id || value.name), 'id or name is required')) }), async ({ items }) => runBatch(items, async (item, index) => {
      const resolved = await resolveProjectId(todoistClient, toProjectSelector(item), { allowAmbiguousNameMatch: true });
      const data = await todoistClient.get(`/projects/${TodoistClient.encodePathParam(resolved.id, 'id')}`);
      return itemOk(index, data, resolved.id, resolved.matchedName);
    }),
  );

  registerScopedTool(
    'update_projects',
    { description: 'Mutate Todoist projects by id or explicit project_name selector; use name in the payload to rename.', inputSchema: { items: z.array(z.object({ ...projectMutationSelectorSchema, name: z.string().optional(), color: createProjectFields.color, is_favorite: createProjectFields.is_favorite, view_style: createProjectFields.view_style }).refine((value) => Boolean(value.id || value.project_name), 'id or project_name is required')) } },
    z.object({ items: z.array(z.object({ ...projectMutationSelectorSchema, name: z.string().optional(), color: createProjectFields.color, is_favorite: createProjectFields.is_favorite, view_style: createProjectFields.view_style }).refine((value) => Boolean(value.id || value.project_name), 'id or project_name is required')) }), async ({ items }) => runBatch(items, async (item, index) => {
      const resolved = await resolveProjectId(todoistClient, toProjectMutationSelector(item), { allowAmbiguousNameMatch: false });
      const body = { ...item } as JsonMap;
      delete body.id;
      delete body.project_name;
      const data = await todoistClient.post(`/projects/${TodoistClient.encodePathParam(resolved.id, 'id')}`, body);
      return itemOk(index, data, resolved.id, resolved.matchedName);
    }),
  );

  registerScopedTool(
    'delete_projects',
    { description: 'Destructively delete Todoist projects.', inputSchema: { items: z.array(z.object(projectSelectorSchema).refine((value) => Boolean(value.id || value.name), 'id or name is required')) } },
    z.object({ items: z.array(z.object(projectSelectorSchema).refine((value) => Boolean(value.id || value.name), 'id or name is required')) }), async ({ items }) => runBatch(items, async (item, index) => {
      const resolved = await resolveProjectId(todoistClient, toProjectSelector(item), { allowAmbiguousNameMatch: false });
      const data = await todoistClient.delete(`/projects/${TodoistClient.encodePathParam(resolved.id, 'id')}`);
      return itemOk(index, data, resolved.id, resolved.matchedName);
    }),
  );

  registerScopedTool(
    'get_collaborators',
    { description: 'Read Todoist collaborators for a project.', inputSchema: { id: z.string() } },
    z.object({ id: z.string() }), async ({ id }) => todoistClient.get(`/projects/${TodoistClient.encodePathParam(id, 'id')}/collaborators`),
  );

  registerScopedTool(
    'move_projects',
    { description: 'Mutate Todoist projects by moving them under another parent project or to root.', inputSchema: { items: z.array(z.object({ ...projectSelectorSchema, parent_id: z.string().nullable().optional() }).refine((value) => Boolean(value.id || value.name), 'id or name is required')) } },
    z.object({ items: z.array(z.object({ ...projectSelectorSchema, parent_id: z.string().nullable().optional() }).refine((value) => Boolean(value.id || value.name), 'id or name is required')) }), async ({ items }) => runBatch(items, async (item, index) => {
      const resolved = await resolveProjectId(todoistClient, toProjectSelector(item), { allowAmbiguousNameMatch: false });
      const data = await todoistClient.sync([{ type: 'project_move', uuid: crypto.randomUUID(), args: { id: resolved.id, parent_id: item.parent_id ?? null } }]);
      return itemOk(index, data, resolved.id, resolved.matchedName);
    }),
  );

  registerScopedTool(
    'get_sections_list',
    { description: 'Read Todoist sections, optionally filtered by project.', inputSchema: { project_id: z.string().optional() } },
    z.object({ project_id: z.string().optional() }), async (input) => todoistClient.get('/sections', input),
  );

  registerScopedTool(
    'create_sections',
    { description: 'Create one or more Todoist sections.', inputSchema: { items: z.array(z.object(createSectionFields)) } },
    z.object({ items: z.array(z.object(createSectionFields)) }), async ({ items }) => runBatch(items, async (item, index) => {
      const created = await todoistClient.post('/sections', item);
      const id = typeof created === 'object' && created && 'id' in created ? String((created as { id: unknown }).id) : undefined;
      return itemOk(index, created, id);
    }),
  );

  registerScopedTool(
    'get_sections',
    { description: 'Read Todoist sections by id or name substring.', inputSchema: { items: z.array(z.object(sectionSelectorSchema).refine((value) => Boolean(value.id || value.name), 'id or name is required')) } },
    z.object({ items: z.array(z.object(sectionSelectorSchema).refine((value) => Boolean(value.id || value.name), 'id or name is required')) }), async ({ items }) => runBatch(items, async (item, index) => {
      const resolved = await resolveSectionId(todoistClient, toSectionSelector(item), { allowAmbiguousNameMatch: true });
      const data = await todoistClient.get(`/sections/${TodoistClient.encodePathParam(resolved.id, 'id')}`);
      return itemOk(index, data, resolved.id, resolved.matchedName);
    }),
  );

  registerScopedTool(
    'update_sections',
    { description: 'Mutate Todoist sections by id or explicit section_name selector; use name in the payload to rename.', inputSchema: { items: z.array(z.object({ ...sectionMutationSelectorSchema, name: z.string().optional() }).refine((value) => Boolean(value.id || value.section_name), 'id or section_name is required')) } },
    z.object({ items: z.array(z.object({ ...sectionMutationSelectorSchema, name: z.string().optional() }).refine((value) => Boolean(value.id || value.section_name), 'id or section_name is required')) }), async ({ items }) => runBatch(items, async (item, index) => {
      const resolved = await resolveSectionId(todoistClient, toSectionMutationSelector(item), { allowAmbiguousNameMatch: false });
      const body = { ...item } as JsonMap;
      delete body.id;
      delete body.section_name;
      const data = await todoistClient.post(`/sections/${TodoistClient.encodePathParam(resolved.id, 'id')}`, body);
      return itemOk(index, data, resolved.id, resolved.matchedName);
    }),
  );

  registerScopedTool(
    'delete_sections',
    { description: 'Destructively delete Todoist sections.', inputSchema: { items: z.array(z.object(sectionSelectorSchema).refine((value) => Boolean(value.id || value.name), 'id or name is required')) } },
    z.object({ items: z.array(z.object(sectionSelectorSchema).refine((value) => Boolean(value.id || value.name), 'id or name is required')) }), async ({ items }) => runBatch(items, async (item, index) => {
      const resolved = await resolveSectionId(todoistClient, toSectionSelector(item), { allowAmbiguousNameMatch: false });
      const data = await todoistClient.delete(`/sections/${TodoistClient.encodePathParam(resolved.id, 'id')}`);
      return itemOk(index, data, resolved.id, resolved.matchedName);
    }),
  );

  const commentTargetSchema = z.object(createCommentFields).superRefine((value, ctx) => {
    if ([value.task_id, value.project_id].filter(Boolean).length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one of task_id or project_id is required' });
    }
  });

  registerScopedTool(
    'get_comments_list',
    { description: 'Read Todoist comments for exactly one task or project.', inputSchema: { task_id: z.string().optional(), project_id: z.string().optional() } },
    z.object({ task_id: z.string().optional(), project_id: z.string().optional() }).superRefine((value, ctx) => {
      if ([value.task_id, value.project_id].filter(Boolean).length !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one of task_id or project_id is required' });
      }
    }), async (input) => todoistClient.get('/comments', input),
  );

  registerScopedTool(
    'create_comments',
    { description: 'Create Todoist comments on exactly one task or project.', inputSchema: { items: z.array(commentTargetSchema) } },
    z.object({ items: z.array(commentTargetSchema) }), async ({ items }) => runBatch(items, async (item, index) => {
      const created = await todoistClient.post('/comments', item);
      const id = typeof created === 'object' && created && 'id' in created ? String((created as { id: unknown }).id) : undefined;
      return itemOk(index, created, id);
    }),
  );

  for (const [name, methodDescription, method, pathBuilder] of [
    ['get_comments', 'Read Todoist comments by id.', 'GET', (id: string) => `/comments/${TodoistClient.encodePathParam(id, 'id')}`],
    ['update_comments', 'Mutate Todoist comments by id.', 'POST', (id: string) => `/comments/${TodoistClient.encodePathParam(id, 'id')}`],
    ['delete_comments', 'Destructively delete Todoist comments by id.', 'DELETE', (id: string) => `/comments/${TodoistClient.encodePathParam(id, 'id')}`],
  ] as const) {
    const itemSchema = name === 'update_comments' ? z.object({ id: z.string(), content: z.string() }) : z.object({ id: z.string() });
      registerScopedTool(
        name,
        { description: methodDescription, inputSchema: { items: z.array(itemSchema) } },
        z.object({ items: z.array(itemSchema) }), async ({ items }) => runBatch(items, async (item, index) => {
          let data: unknown;
          if (method === 'GET') data = await todoistClient.get(pathBuilder(item.id));
          else if (method === 'POST') data = await todoistClient.post(pathBuilder(item.id), 'content' in item ? { content: item.content } : {});
          else data = await todoistClient.delete(pathBuilder(item.id));
          return itemOk(index, data, item.id);
        }),
      );
  }

  registerScopedTool(
    'get_labels_list',
    { description: 'Read personal Todoist labels.', inputSchema: {} },
    emptyObjectSchema, async () => todoistClient.get('/labels'),
  );

  registerScopedTool(
    'create_labels',
    { description: 'Create personal Todoist labels.', inputSchema: { items: z.array(z.object(createLabelFields)) } },
    z.object({ items: z.array(z.object(createLabelFields)) }), async ({ items }) => runBatch(items, async (item, index) => {
      const created = await todoistClient.post('/labels', item);
      const id = typeof created === 'object' && created && 'id' in created ? String((created as { id: unknown }).id) : undefined;
      return itemOk(index, created, id);
    }),
  );

  registerScopedTool(
    'get_labels',
    { description: 'Read personal Todoist labels by id or name substring.', inputSchema: { items: z.array(z.object(labelSelectorSchema).refine((value) => Boolean(value.id || value.name), 'id or name is required')) } },
    z.object({ items: z.array(z.object(labelSelectorSchema).refine((value) => Boolean(value.id || value.name), 'id or name is required')) }), async ({ items }) => runBatch(items, async (item, index) => {
      const resolved = await resolveLabelId(todoistClient, toLabelSelector(item), { allowAmbiguousNameMatch: true });
      const data = await todoistClient.get(`/labels/${TodoistClient.encodePathParam(resolved.id, 'id')}`);
      return itemOk(index, data, resolved.id, resolved.matchedName);
    }),
  );

  registerScopedTool(
    'update_labels',
    { description: 'Mutate personal Todoist labels by id or explicit label_name selector; use name in the payload to rename.', inputSchema: { items: z.array(z.object({ ...labelMutationSelectorSchema, ...labelUpdateFields }).refine((value) => Boolean(value.id || value.label_name), 'id or label_name is required')) } },
    z.object({ items: z.array(z.object({ ...labelMutationSelectorSchema, ...labelUpdateFields }).refine((value) => Boolean(value.id || value.label_name), 'id or label_name is required')) }), async ({ items }) => runBatch(items, async (item, index) => {
      const resolved = await resolveLabelId(todoistClient, toLabelMutationSelector(item), { allowAmbiguousNameMatch: false });
      const body = { ...item } as JsonMap;
      delete body.id;
      delete body.label_name;
      const data = await todoistClient.post(`/labels/${TodoistClient.encodePathParam(resolved.id, 'id')}`, body);
      return itemOk(index, data, resolved.id, resolved.matchedName);
    }),
  );

  registerScopedTool(
    'delete_labels',
    { description: 'Destructively delete personal Todoist labels.', inputSchema: { items: z.array(z.object(labelSelectorSchema).refine((value) => Boolean(value.id || value.name), 'id or name is required')) } },
    z.object({ items: z.array(z.object(labelSelectorSchema).refine((value) => Boolean(value.id || value.name), 'id or name is required')) }), async ({ items }) => runBatch(items, async (item, index) => {
      const resolved = await resolveLabelId(todoistClient, toLabelSelector(item), { allowAmbiguousNameMatch: false });
      const data = await todoistClient.delete(`/labels/${TodoistClient.encodePathParam(resolved.id, 'id')}`);
      return itemOk(index, data, resolved.id, resolved.matchedName);
    }),
  );

  registerScopedTool(
    'get_shared_labels',
    { description: 'Read shared Todoist labels.', inputSchema: {} },
    emptyObjectSchema, async () => todoistClient.get('/labels/shared'),
  );

  registerScopedTool(
    'rename_shared_labels',
    { description: 'Mutate shared Todoist labels by renaming them.', inputSchema: { items: z.array(z.object({ name: z.string(), new_name: z.string() })) } },
    z.object({ items: z.array(z.object({ name: z.string(), new_name: z.string() })) }), async ({ items }) => runBatch(items, async (item, index) => {
      const data = await todoistClient.post('/labels/shared/rename', item);
      return itemOk(index, data, item.name, item.name);
    }),
  );

  registerScopedTool(
    'remove_shared_labels',
    { description: 'Destructively remove shared Todoist labels by name.', inputSchema: { items: z.array(z.object({ name: z.string() })) } },
    z.object({ items: z.array(z.object({ name: z.string() })) }), async ({ items }) => runBatch(items, async (item, index) => {
      const data = await todoistClient.post('/labels/shared/remove', { name: item.name });
      return itemOk(index, data, item.name, item.name);
    }),
  );

  registerScopedTool(
    'utils_get_colors',
    { description: 'Read the static list of Todoist-supported color ids, names, and hex values.', inputSchema: {} },
    emptyObjectSchema, async () => TODOIST_COLORS,
  );
}
