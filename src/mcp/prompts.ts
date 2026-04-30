import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasScope, HttpError } from '../security/validators';
import type { TodoistClient } from '../todoist/client';
import type { TodoistProject, TodoistSection } from '../todoist/types';
import type { McpServerAuthContext } from './server';

export function registerPrompts(server: McpServer, todoistClient: TodoistClient, authContext: McpServerAuthContext): void {
  server.registerPrompt(
    'projects_list',
    {
      description: 'Get a compact markdown overview of Todoist projects and sections.',
    },
    async (): Promise<GetPromptResult> => {
      if (!hasScope(authContext.scope, 'todoist.read')) {
        throw new HttpError(403, 'insufficient_scope', 'todoist.read scope is required for this prompt');
      }

      const [projects, sections] = await Promise.all([
        todoistClient.get('/projects') as Promise<TodoistProject[]>,
        todoistClient.get('/sections') as Promise<TodoistSection[]>,
      ]);

      const sectionsByProject = new Map<string, TodoistSection[]>();
      for (const section of sections) {
        const items = sectionsByProject.get(section.project_id) ?? [];
        items.push(section);
        sectionsByProject.set(section.project_id, items);
      }

      const lines: string[] = ['# Todoist Projects', ''];
      for (const project of projects) {
        lines.push(`- **${project.name}** (id: \`${project.id}\`)`);
        const projectSections = sectionsByProject.get(project.id) ?? [];
        if (projectSections.length > 0) {
          for (const section of projectSections) {
            lines.push(`  - ${section.name} (section: \`${section.id}\`)`);
          }
        }
      }

      return {
        description: 'Todoist project and section overview',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: lines.join('\n'),
            },
          },
        ],
      };
    },
  );
}
