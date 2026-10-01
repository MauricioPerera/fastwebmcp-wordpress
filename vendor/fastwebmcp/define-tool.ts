import type { ZodType, z } from 'zod';

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface ToolSpec<TSchema extends ZodType> {
  name: string;
  description: string;
  inputSchema: TSchema;
  execute: (input: z.infer<TSchema>, context: { signal: AbortSignal }) => unknown;
  annotations?: ToolAnnotations;
  title?: string;
}

export interface DefinedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (rawInput: unknown, context: { signal: AbortSignal }) => Promise<unknown>;
  annotations?: ToolAnnotations;
  title?: string;
}

// Name charset/length per the WebMCP spec (webmachinelearning.github.io/webmcp): 1-128
// chars, [A-Za-z0-9_.-] only. The two budgets below are Chrome's recommended (not
// spec-enforced) limits for reliable agent results -- warned, never thrown.
const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
const NAME_BUDGET = 30;
const DESCRIPTION_BUDGET = 500;

function warnIfOverBudget(label: string, value: string, limit: number): void {
  if (value.length > limit) {
    console.warn(
      `fastwebmcp: ${label} is ${value.length} characters; Chrome recommends <=${limit} for reliable agent results.`,
    );
  }
}

export function defineTool<TSchema extends ZodType>(spec: ToolSpec<TSchema>): DefinedTool {
  if (typeof spec.name !== 'string' || spec.name.trim() === '') {
    throw new Error('defineTool: name must be a non-empty string');
  }
  if (!NAME_PATTERN.test(spec.name)) {
    throw new Error('defineTool: name must be 1-128 characters of letters, numbers, "_", "-", or "."');
  }
  if (typeof spec.description !== 'string' || spec.description.trim() === '') {
    throw new Error('defineTool: description must be a non-empty string');
  }
  if (typeof spec.execute !== 'function') {
    throw new Error('defineTool: execute must be a function');
  }

  warnIfOverBudget('tool name', spec.name, NAME_BUDGET);
  warnIfOverBudget('tool description', spec.description, DESCRIPTION_BUDGET);

  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema.toJSONSchema() as Record<string, unknown>,
    ...(spec.annotations !== undefined ? { annotations: spec.annotations } : {}),
    ...(spec.title !== undefined ? { title: spec.title } : {}),
    execute: async (rawInput, context) => {
      const parsed = spec.inputSchema.parse(rawInput);
      return spec.execute(parsed, context);
    },
  };
}
