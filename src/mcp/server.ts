import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TodoistClient } from '../todoist/client';
import { registerPrompts } from './prompts';
import { registerTools } from './tools';

export interface McpServerAuthContext {
  scope: string;
}

export function createTodoistMcpServer(todoistClient: TodoistClient, authContext: McpServerAuthContext): McpServer {
  const server = new McpServer(
    {
      name: 'todoist-mcp-gateway',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
      },
    },
  );

  registerTools(server, todoistClient, authContext);
  registerPrompts(server, todoistClient, authContext);
  return server;
}
