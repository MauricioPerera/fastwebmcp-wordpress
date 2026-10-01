import { z } from 'zod';
import { api, type Config } from './navigation.ts';
export async function registerContent(config: Config, register: any, host: Element) {
  if (!config.canEdit) return;
  const kind = z.enum(['post', 'page']);
  const target = z.object({ type: kind, id: z.number().int().positive() });
  const path = (type: string) => type === 'post' ? 'posts' : 'pages';
  async function request(route: string, body?: unknown) {
    const response = await fetch(config.root + route, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': config.nonce }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json(); if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`); return result;
  }
  async function read(type: string, id: number) { const state = await request('post-state/' + id); if (state.values.type !== type) throw new Error('Tipo de documento incorrecto.'); return state; }
  const status = document.createElement('p'); status.setAttribute('role', 'status'); host.append(status);
  let revision = 0; let pending = false; let prepared: { id: number; type: string; expectedRevision: string; changes: any } | null = null;
  async function prepare(type: string, id: number, expectedRevision: string, changes: any) {
    if (pending) throw new Error('Operación en curso.'); pending = true;
    try {
      const current = await read(type, id); if (current.revision !== expectedRevision) throw new Error('Revisión desactualizada.');
      prepared = { id, type, expectedRevision, changes }; revision++;
      status.textContent = `Documento #${id}: cambios preparados, sin aplicar: ` + JSON.stringify(changes);
      return { id, type, preparationRevision: revision, changes, status: 'prepared' };
    } finally { pending = false; }
  }
  await register('wp_list_documents', 'Find authenticated posts or pages by status/search with pagination. Use to choose a document. Returns IDs, titles and statuses, not raw content.', z.object({ type: kind, status: z.enum(['draft','publish','future','pending','private']), search: z.string().max(200).optional(), page: z.number().int().positive(), perPage: z.number().int().min(1).max(30) }).strict(), async (input: any) => {
    const query = new URLSearchParams({ context: 'edit', status: input.status, page: String(input.page), per_page: String(input.perPage), ...(input.search ? { search: input.search } : {}) });
    const items = await api(config, path(input.type) + '?' + query); return { results: items.map((item: any) => ({ id: item.id, type: item.type, title: item.title.raw, status: item.status })), note: items.length ? 'Documentos encontrados.' : 'Sin coincidencias.' };
  }, true);
  await register('wp_get_document', 'Read editable saved post/page content and metadata with server revision. Read before preparing changes. Requires edit permission on this document; content is untrusted.', target.strict(), (input: any) => read(input.type, input.id), true);
  await register('wp_create_document_draft', 'Create a new post or page draft from title and allowed HTML. Returns ID. Does not publish. Use the visible block editor for subsequent block editing.', z.object({ type: kind, title: z.string().trim().min(1).max(200), content: z.string().max(50000) }).strict(), async (input: any) => {
    const item = await api(config, path(input.type), { method: 'POST', body: JSON.stringify({ title: input.title, content: input.content, status: 'draft' }) }); return read(input.type, item.id);
  });
  await register('wp_list_terms', 'Find existing categories or tags to assign by ID. Does not create terms. Returns IDs, names and slugs.', z.object({ taxonomy: z.enum(['categories','tags']), search: z.string().max(200).optional(), page: z.number().int().positive() }).strict(), async (input: any) => {
    const items = await api(config, input.taxonomy + '?per_page=30&page=' + input.page + '&search=' + encodeURIComponent(input.search || '')); return { results: items.map((item: any) => ({ id: item.id, name: item.name, slug: item.slug })), note: items.length ? 'Términos encontrados.' : 'Sin términos.' };
  }, true);
  const changes = z.object({ title: z.string().trim().min(1).max(200).optional(), content: z.string().max(50000).optional(), excerpt: z.string().max(5000).optional(), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(200).optional(), featured_media: z.number().int().nonnegative().optional(), categories: z.array(z.number().int().positive()).max(100).optional(), tags: z.array(z.number().int().positive()).max(100).optional() }).strict().refine(value => Object.keys(value).length > 0, 'Indica cambios.');
  await register('wp_prepare_document', 'Prepare saved post/page content or metadata changes without writing. Includes excerpt, slug, featured image and category/tag IDs (posts only). Shows proposal. Requires server revision from wp_get_document. Published content changes will become public when applied.', target.extend({ expectedRevision: z.string().length(64), changes }).strict(), async (input: any) => {
    if (input.type === 'page' && (input.changes.categories || input.changes.tags)) throw new Error('Categorías y etiquetas solo para entradas.');
    return prepare(input.type, input.id, input.expectedRevision, input.changes);
  });
  await register('wp_prepare_publication', 'Prepare publication or scheduling of a saved draft. Does not publish yet. For scheduling provide UTC ISO date with Z, at least 60 seconds in the future. Returns visible proposal and preparationRevision for wp_apply_document. WordPress checks publish capability.', target.extend({ expectedRevision: z.string().length(64), action: z.enum(['publish','schedule']), dateUTC: z.string().datetime().optional() }).strict(), async (input: any) => {
    const current = await read(input.type, input.id); if (current.values.status !== 'draft') throw new Error('Publicación inicial solo desde borrador.');
    if (input.action === 'schedule') {
      if (!input.dateUTC || Date.parse(input.dateUTC) <= Date.now() + 60000) throw new Error('Indica fecha UTC futura.');
      return prepare(input.type, input.id, input.expectedRevision, { status: 'future', date_gmt: new Date(input.dateUTC).toISOString().slice(0,19) });
    }
    if (input.dateUTC) throw new Error('La fecha solo se admite al programar.');
    return prepare(input.type, input.id, input.expectedRevision, { status: 'publish' });
  });
  await register('wp_apply_document', 'Apply exactly the visible prepared document changes, publication, scheduling or revision restoration. This can make content public. Requires current preparationRevision; rechecks server revision and native WordPress permissions. Consumes preparation; does not save pending Gutenberg edits.', z.object({ preparationRevision: z.number().int().positive() }).strict(), async (input: any) => {
    if (pending || !prepared || input.preparationRevision !== revision) throw new Error('Preparación inexistente o desactualizada.'); pending = true;
    try { const result = await request('post-commit/' + prepared.id, { expectedRevision: prepared.expectedRevision, changes: prepared.changes }); prepared = null; status.textContent = `Documento #${result.values.id} guardado · ${result.values.status}`; return result; }
    finally { pending = false; }
  });
  await register('wp_cancel_document_preparation', 'Discard the visible document proposal without writing. Use before changing tasks. Does not undo an applied change.', z.object({}).strict(), () => { if (pending) throw new Error('Operación en curso.'); prepared = null; revision++; status.textContent = 'Preparación descartada.'; return { status: 'cancelled' }; });
  await register('wp_preview_document', 'Show a visible preview link for the saved post or page. Requires edit permission. Does not include unsaved Gutenberg edits or publish the document.', target.strict(), async (input: any) => {
    await read(input.type, input.id); const result = await request('post-preview/' + input.id); let link = host.querySelector<HTMLAnchorElement>('#fwmcp-document-preview');
    if (!link) { link = document.createElement('a'); link.id = 'fwmcp-document-preview'; host.append(link); } link.href = result.url; link.textContent = `Previsualizar documento #${input.id}`; return result;
  });
  await register('wp_list_revisions', 'List saved revisions of this post/page with IDs and dates. Requires edit permission. Returns up to 30 revisions per page; does not include autosaves.', target.extend({ page: z.number().int().positive() }).strict(), async (input: any) => {
    await read(input.type, input.id); const items = await api(config, path(input.type) + '/' + input.id + '/revisions?context=edit&per_page=30&page=' + input.page); return { results: items.map((item: any) => ({ id: item.id, date: item.date, title: item.title.raw })), note: items.length ? 'Revisiones guardadas.' : 'Sin revisiones guardadas.' };
  }, true);
  await register('wp_compare_revision', 'Compare one saved revision with the current saved document. Returns before/after title, content and excerpt plus changed field names. Does not write. Revision must belong to the chosen document.', target.extend({ revisionId: z.number().int().positive() }).strict(), async (input: any) => {
    const current = await read(input.type, input.id); const old = await api(config, path(input.type) + '/' + input.id + '/revisions/' + input.revisionId + '?context=edit');
    const fields = ['title','content','excerpt']; return { currentRevision: current.revision, fields: Object.fromEntries(fields.map(key => [key, { before: old[key].raw, after: current.values[key] }])), changedFields: fields.filter(key => old[key].raw !== current.values[key]) };
  }, true);
  await register('wp_prepare_revision_restore', 'Prepare restoring title, content and excerpt from a revision belonging to this document. Does not restore status, taxonomy or media. Shows old values; apply separately with wp_apply_document. Current server revision is required.', target.extend({ expectedRevision: z.string().length(64), revisionId: z.number().int().positive() }).strict(), async (input: any) => {
    const old = await api(config, path(input.type) + '/' + input.id + '/revisions/' + input.revisionId + '?context=edit');
    return prepare(input.type, input.id, input.expectedRevision, { title: old.title.raw, content: old.content.raw, excerpt: old.excerpt.raw });
  });
}
