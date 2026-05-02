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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createJsonContentResult(data: unknown, isError = false): CallToolResult {
  const structuredContent = isPlainObject(data)
    ? data
    : Array.isArray(data)
      ? { items: data }
      : undefined;

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
