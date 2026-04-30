import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface BatchItemResult {
  index: number;
  ok: boolean;
  id?: string;
  matched_name?: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
    status?: number;
  };
}

export interface BatchResult {
  ok: boolean;
  results: BatchItemResult[];
}

export function createJsonContentResult(data: unknown, isError = false): CallToolResult {
  const structuredContent = data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined;
  return {
    isError: isError || undefined,
    structuredContent,
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}
