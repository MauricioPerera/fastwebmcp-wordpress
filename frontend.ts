import type { FrontendAPI } from './runtime.ts';
const api: FrontendAPI = (window as any).FastWebMCP;
const z = api.z;
api.registerComponent('search', 'form[data-fwmcp-component="search"]', ({ root, registerTool, signal }) => {
  const form = root as HTMLFormElement;
  const input = form.querySelector<HTMLInputElement>('input[name="s"]');
  if (!input) throw new Error('Formulario sin campo s.');
  const status = document.createElement('p'); status.setAttribute('role', 'status'); form.append(status);
  let revision = 0, timer: number | undefined;
  const change = () => { revision++; if (timer) { clearTimeout(timer); timer = undefined; } status.textContent = 'Búsqueda modificada.'; };
  input.addEventListener('input', change, { signal }); input.addEventListener('change', change, { signal });
  const prepare = (query: string) => {
    query = query.trim(); if (!query) throw new Error('Escribe una búsqueda.');
    input.value = query; change(); status.textContent = `Búsqueda preparada: ${query}. Revisión ${revision}.`;
    return { query, revision };
  };
  const register = (spec: Parameters<typeof registerTool>[0]) => { void registerTool(spec).catch(error => { status.textContent = `WebMCP: ${error.message}`; }); };
  register({ name: 'state', description: 'Read this native WordPress search form.', inputSchema: z.object({}).strict(), readOnly: true,
    execute: () => ({ query: input.value, revision, action: form.action }) });
  register({ name: 'prepare', description: 'Fill this visible native search form without navigation. Returns revision for submit.', inputSchema: z.object({ query: z.string().min(1).max(200) }).strict(), execute: ({ query }) => prepare(query) });
  register({ name: 'submit', description: 'Submit this search form with its prepared revision. Opens native WordPress search results.', inputSchema: z.object({ revision: z.number().int().min(1) }).strict(), execute: (expected) => {
    if (timer || expected.revision !== revision || !input.value.trim() || !form.reportValidity()) throw new Error('Revisión desactualizada o búsqueda inválida.');
    const query = input.value; status.textContent = `Abriendo búsqueda: ${query}`;
    timer = window.setTimeout(() => { timer = undefined; if (!signal.aborted && revision === expected.revision && input.value === query) form.requestSubmit(); }, 300);
    return { query, revision, navigating: true };
  } });
  return () => { if (timer) clearTimeout(timer); status.remove(); };
});
api.registerComponent('filter', '[data-fwmcp-component="filter"]', ({ root, registerTool, signal }) => {
  const form = root.querySelector<HTMLFormElement>('form')!;
  const query = form.querySelector<HTMLInputElement>('[name="fwmcp_query"]')!;
  const category = form.querySelector<HTMLSelectElement>('[name="fwmcp_category"]');
  const status = root.querySelector<HTMLElement>('[data-fwmcp-status]')!;
  const results = root.querySelector<HTMLElement>('[data-fwmcp-results]')!;
  const fields = z.object({ query: z.string().max(200), category: z.number().int().min(0) }).strict();
  let revision = 0, request: AbortController | undefined;
  const state = () => ({ query: query.value, category: Number(category?.value ?? 0), revision });
  const change = () => { revision++; request?.abort(); status.textContent = 'Filtros modificados. Pulsa Aplicar filtros.'; };
  form.addEventListener('input', change, { signal }); form.addEventListener('change', change, { signal });
  async function apply(expected: number) {
    if (expected !== revision || !form.reportValidity()) throw new Error('Filtros inválidos o revisión desactualizada.');
    const input = fields.parse(stateFields()); request?.abort(); const current = new AbortController(); request = current;
    status.textContent = 'Buscando…';
    try {
      const result = await api.invokeServer('filter_content', { ...input, type: root.dataset.fwmcpType, limit: Number(root.dataset.fwmcpLimit) }, { signal: AbortSignal.any([signal, current.signal]) });
      if (revision !== expected || signal.aborted) throw new Error('Filtros modificados durante la búsqueda.');
      const nodes = result.results.map((item: any) => { const li = document.createElement('li'), a = document.createElement('a'); a.textContent = item.title; const url = new URL(item.url, location.href); if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL no compatible.'); a.href = url.href; li.append(a); return li; });
      results.replaceChildren(...nodes); status.textContent = `${result.results.length} resultados para «${input.query}».`;
      return { ...state(), results: result.results };
    } catch (error) { if (!signal.aborted && !current.signal.aborted && revision === expected) status.textContent = `Error: ${(error as Error).message}`; throw error; }
  }
  const stateFields = () => ({ query: query.value, category: Number(category?.value ?? 0) });
  form.addEventListener('submit', event => { event.preventDefault(); void apply(revision).catch(() => {}); }, { signal });
  const register = (spec: Parameters<typeof registerTool>[0]) => { void registerTool(spec).catch(error => { status.textContent = `WebMCP: ${error.message}`; }); };
  register({ name: 'state', description: `Read visible content filters: ${root.dataset.fwmcpLabel}.`, inputSchema: z.object({}).strict(), readOnly: true, execute: state });
  register({ name: 'prepare', description: 'Fill query and category in this visible filter block. Returns revision for apply.', inputSchema: fields, execute: input => {
    if (category && ![...category.options].some(option => option.value === String(input.category))) throw new Error('Categoría no disponible.');
    if (!category && input.category !== 0) throw new Error('Las páginas no admiten categorías.');
    query.value = input.query; if (category) category.value = String(input.category); change(); status.textContent = `Filtros preparados. Revisión ${revision}.`; return state();
  } });
  register({ name: 'apply', description: 'Apply prepared revision and render public results inside this filter block.', inputSchema: z.object({ revision: z.number().int().min(1) }).strict(), execute: ({ revision }) => apply(revision) });
  return () => request?.abort();
});
