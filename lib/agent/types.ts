export type ToolSchema = {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, any>;
};
