import type { ZodType } from 'zod';
import { defineTool, type ToolSpec, type DefinedTool } from './define-tool.ts';
import { supportsWebMcp } from './supports-webmcp.ts';

export interface RegisterToolOptions {
  signal?: AbortSignal;
  exposedTo?: string[];
}

interface DocumentModelContext {
  modelContext: {
    registerTool: (tool: unknown, options?: RegisterToolOptions) => unknown;
  };
}

function dispatchRegistration(
  tool: DefinedTool,
  options?: RegisterToolOptions,
): { completion: unknown } | undefined {
  if (!supportsWebMcp()) {
    console.warn(
      `fastwebmcp: WebMCP is not supported in this browser (document.modelContext is missing); skipping registration of tool "${tool.name}".`,
    );
    return undefined;
  }

  return { completion: (globalThis.document as unknown as DocumentModelContext).modelContext.registerTool(tool, options) };
}

// Internal shared dispatch: LSFA tools are already parsed by defineLsfaTool.
export function registerDefinedTool(tool: DefinedTool, options?: RegisterToolOptions): boolean {
  const registration = dispatchRegistration(tool, options);
  if (!registration) return false;
  void Promise.resolve(registration.completion).catch(() => {
    console.warn(`fastwebmcp: registration of tool "${tool.name}" failed; use registerToolAsync() to await registration and handle the error.`);
  });
  return true;
}

export async function registerDefinedToolAsync(tool: DefinedTool, options?: RegisterToolOptions): Promise<boolean> {
  const registration = dispatchRegistration(tool, options);
  if (!registration) return false;
  await registration.completion;
  return true;
}

/** Returns whether registration was dispatched. Use registerToolAsync for confirmation. */
export function registerTool<TSchema extends ZodType>(spec: ToolSpec<TSchema>, options?: RegisterToolOptions): boolean {
  return registerDefinedTool(defineTool(spec), options);
}

/** Resolves after native registration, propagating the original browser error. */
export async function registerToolAsync<TSchema extends ZodType>(spec: ToolSpec<TSchema>, options?: RegisterToolOptions): Promise<boolean> {
  return registerDefinedToolAsync(defineTool(spec), options);
}
