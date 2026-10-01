import { z, type ZodType } from 'zod';
import { registerToolAsync, supportsWebMcp } from './vendor/fastwebmcp/index.ts';

type Spec = { name: string; description: string; inputSchema: ZodType; readOnly?: boolean; execute: (input: any, context: { signal: AbortSignal }) => unknown };
type Component = { id: string; root: HTMLElement; signal: AbortSignal; registerTool: (spec: Spec) => Promise<boolean> };
type Mount = (context: Component) => void | (() => void);
const config = (window as any).FastWebMCPFrontend;
const names = new Set<string>();
const adapters = new Map<string, { selector: string; mount: Mount }>();
const mounted = new Map<HTMLElement, { controller: AbortController; cleanup?: () => void; id: string; type: string }>();
let serial = 0;

async function registerTool(spec: Spec, options: { signal?: AbortSignal } = {}) {
  if (!/^[a-z][a-z0-9_]{0,99}$/.test(spec.name) || names.has(spec.name)) throw new Error('Nombre de herramienta inválido o duplicado.');
  if (options.signal?.aborted) return false;
  if (!config.enabled || !supportsWebMcp()) return false;
  names.add(spec.name);
  const release = () => names.delete(spec.name);
  options.signal?.addEventListener('abort', release, { once: true });
  try {
    const registered = await registerToolAsync({ name: spec.name, description: spec.description, inputSchema: spec.inputSchema,
      annotations: { readOnlyHint: !!spec.readOnly }, execute: async (input, context) => {
        if (options.signal?.aborted || context.signal.aborted) throw new Error('Componente o llamada cancelados.');
        const signal = options.signal ? AbortSignal.any([options.signal, context.signal]) : context.signal;
        try { return await spec.execute(input, { signal }); }
        catch (error) { document.dispatchEvent(new CustomEvent('fastwebmcp:error', { detail: { name: spec.name, error } })); throw error; }
      } }, options);
    if (!registered) release();
    return registered;
  } catch (error) { release(); throw error; }
}

function reconcile() {
  for (const [root, instance] of mounted) {
    const adapter = adapters.get(instance.type);
    if (!root.isConnected || !adapter || !root.matches(adapter.selector)) {
      instance.controller.abort(); instance.cleanup?.(); mounted.delete(root);
    }
  }
  for (const [type, adapter] of adapters) {
    for (const root of document.querySelectorAll<HTMLElement>(adapter.selector)) {
      if (mounted.has(root)) continue;
      const id = `${type}_${++serial}`;
      const controller = new AbortController();
      const instance: { controller: AbortController; cleanup?: () => void; id: string; type: string } = { controller, id, type };
      mounted.set(root, instance); root.dataset.fwmcpInstance = id;
      try { instance.cleanup = adapter.mount({ id, root, signal: controller.signal,
        registerTool: spec => registerTool({ ...spec, name: `${id}_${spec.name}`, description: `${spec.description} Component: ${id}.` }, { signal: controller.signal }) }) || undefined; }
      catch (error) { controller.abort(); console.error('FastWebMCP mount:', error); }
    }
  }
}
const observer = new MutationObserver(reconcile);
observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-fwmcp-component'] });
function registerComponent(type: string, selector: string, mount: Mount) {
  if (!/^[a-z][a-z0-9_]{0,29}$/.test(type) || adapters.has(type)) throw new Error('Componente inválido o duplicado.');
  document.querySelector(selector); // Fail before registration on an invalid selector.
  adapters.set(type, { selector, mount }); reconcile();
  return () => { adapters.delete(type); reconcile(); };
}

// Deliberately small JSON Schema subset. Unsupported constraints must fail closed.
function schemaFromJSON(schema: any): ZodType {
  const common = ['type', 'description', 'enum'];
  const extras: Record<string, string[]> = { object: ['properties', 'required', 'additionalProperties'], string: ['minLength', 'maxLength'], number: ['minimum', 'maximum'], integer: ['minimum', 'maximum'], boolean: [], array: ['items', 'minItems', 'maxItems'] };
  if (!schema || !extras[schema.type] || Object.keys(schema).some(key => ![...common, ...extras[schema.type]].includes(key))) throw new Error('Esquema JSON no compatible.');
  let value: any;
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false) throw new Error('Usa additionalProperties:false.');
    const shape: Record<string, ZodType> = {};
    const required = schema.required ?? [];
    if (!Array.isArray(required) || required.some((key: string) => !Object.hasOwn(schema.properties ?? {}, key))) throw new Error('Campos required inválidos.');
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Propiedad inválida.');
      shape[key] = required.includes(key) ? schemaFromJSON(child) : schemaFromJSON(child).optional();
    }
    value = z.object(shape).strict();
  } else if (schema.type === 'string') {
    value = z.string(); if (schema.minLength !== undefined) value = value.min(schema.minLength); if (schema.maxLength !== undefined) value = value.max(schema.maxLength);
  } else if (schema.type === 'number' || schema.type === 'integer') {
    value = z.number(); if (schema.type === 'integer') value = value.int(); if (schema.minimum !== undefined) value = value.min(schema.minimum); if (schema.maximum !== undefined) value = value.max(schema.maximum);
  } else if (schema.type === 'boolean') value = z.boolean();
  else { value = z.array(schemaFromJSON(schema.items)); if (schema.minItems !== undefined) value = value.min(schema.minItems); if (schema.maxItems !== undefined) value = value.max(schema.maxItems); }
  if (schema.enum) {
    if (!Array.isArray(schema.enum) || !schema.enum.length) throw new Error('Enum inválido.');
    const literals = schema.enum.map((item: any) => z.literal(item));
    value = z.intersection(value, literals.length === 1 ? literals[0] : z.union(literals as [any, any, ...any[]]));
  }
  return schema.description ? value.describe(schema.description) : value;
}
let session: Promise<{ nonce: string }> | undefined;
async function serverRequest(path: string, body?: unknown, signal?: AbortSignal) {
  session ??= fetch(config.sessionUrl, { credentials: 'same-origin', cache: 'no-store' }).then(async response => {
    const data = await response.json(); if (!response.ok || !data.success) throw new Error('Sesión no disponible.'); return data.data;
  }).catch(error => { session = undefined; throw error; });
  const auth = await session;
  const response = await fetch(config.root + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: { 'Content-Type': 'application/json', ...(auth.nonce ? { 'X-WP-Nonce': auth.nonce } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) { if (result.code === 'rest_cookie_invalid_nonce') session = undefined; throw new Error(result.message ?? 'Operación rechazada.'); }
  return result;
}
async function invokeServer(name: string, input: unknown, options: { signal?: AbortSignal } = {}) {
  if (!/^[a-z][a-z0-9_.-]{0,59}$/.test(name)) throw new Error('Operación inválida.');
  return serverRequest(`frontend-tools/${encodeURIComponent(name)}`, { input }, options.signal);
}
async function registerServerTool(name: string, options: { signal?: AbortSignal; onResult?: (result: any) => unknown } = {}) {
  const manifest = await serverRequest('frontend-tools', undefined, options.signal);
  const spec = manifest.tools.find((item: any) => item.name === name);
  if (!spec) throw new Error('Operación no disponible para esta sesión.');
  return registerTool({ name: `server_${name.replace(/[.-]/g, '_')}`, description: spec.description, inputSchema: schemaFromJSON(spec.inputSchema), readOnly: spec.readOnly,
    execute: async (input, context) => { const result = await invokeServer(name, input, context); await options.onResult?.(result); return result; } }, options);
}
const api = { version: '0.6.0', z, registerTool, registerComponent, invokeServer, registerServerTool, schemaFromJSON, reconcile,
  components: () => [...mounted.values()].map(({ id, type }) => ({ id, type })), supported: () => !!config.enabled && supportsWebMcp() };
(window as any).FastWebMCP = api;
document.dispatchEvent(new CustomEvent('fastwebmcp:ready', { detail: api }));
export type FrontendAPI = typeof api;
