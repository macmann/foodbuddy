export type JsonRpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

export type JsonRpcResponse<T> = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: T;
  error?: JsonRpcError;
};

export type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type ListToolsResult = {
  tools: ToolDefinition[];
};
