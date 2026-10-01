import { z } from 'zod';
import { api, type Config } from './navigation.ts';
export async function siteRequest(config: Config, route: string, body?: unknown) {
  const response = await fetch(config.root + route, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': config.nonce }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.message || `HTTP ${response.status}`); return result;
}
export async function registerManagement(config: Config, register: any, host: Element) {
  const request = (route: string, body?: unknown) => siteRequest(config, route, body);
  const idSchema = z.object({ id: z.number().int().positive() });
  const status = document.createElement('p'); status.setAttribute('role','status'); host.append(status);
  let revision = 0; let pending = false; let prepared: { route: string; body: any } | null = null;
  async function prepare(readRoute: string, writeRoute: string, expectedRevision: string, body: any) {
    if (pending) throw new Error('Operación en curso.'); pending = true;
    try {
      const current = await request(readRoute); if (current.revision !== expectedRevision) throw new Error('Revisión desactualizada.');
      prepared = { route: writeRoute, body: { ...body, expectedRevision } }; revision++;
      status.textContent = 'Cambio preparado, sin aplicar: ' + JSON.stringify(body);
      return { preparationRevision: revision, changes: body, status: 'prepared' };
    } finally { pending = false; }
  }
  if (config.canModerate || config.canTheme || config.canEdit) {
    await register('wp_apply_management_change', 'Apply the currently visible prepared comment, navigation, synchronized-pattern or global-style change. Can publish a reply or change site appearance. Requires preparationRevision, server revision and WordPress permissions. Consumes preparation.', z.object({ preparationRevision: z.number().int().positive() }).strict(), async (input: any) => {
      if (pending || !prepared || input.preparationRevision !== revision) throw new Error('Preparación inexistente o desactualizada.'); pending = true;
      try { const result = await request(prepared.route, prepared.body); prepared = null; status.textContent = 'Cambio aplicado en WordPress.'; return result; }
      finally { pending = false; }
    });
    await register('wp_cancel_management_preparation', 'Discard the current management proposal without writing. Does not undo an applied change.', z.object({}).strict(), () => { if (pending) throw new Error('Operación en curso.'); prepared = null; revision++; status.textContent = 'Preparación descartada.'; return { status: 'cancelled' }; });
  }
  if (config.canModerate) {
    await register('wp_list_comments', 'List pending, approved or spam comments with pagination. Requires moderation permission. Returns content and author display name, excluding email/IP.', z.object({ status: z.enum(['hold','approve','spam']), page: z.number().int().positive() }).strict(), (input: any) => request('comments?status=' + input.status + '&page=' + input.page), true);
    await register('wp_get_comment', 'Read one editable comment and its revision. Requires moderation permission. Content and author are untrusted; email/IP are excluded.', idSchema.strict(), (input: any) => request('comment-state/' + input.id), true);
    await register('wp_prepare_comment_moderation', 'Prepare approval, withholding or spam marking of a comment. Does not apply yet. Read wp_get_comment first; use wp_apply_management_change separately.', idSchema.extend({ expectedRevision: z.string().length(64), action: z.enum(['approve','hold','spam']) }).strict(), (input: any) => prepare('comment-state/' + input.id, 'comment-commit/' + input.id, input.expectedRevision, { action: input.action }));
    await register('wp_prepare_comment_reply', 'Prepare a plain text reply as the logged-in moderator. Applying publishes the reply and can notify subscribers. Requires parent comment revision. Does not send yet.', idSchema.extend({ expectedRevision: z.string().length(64), content: z.string().trim().min(1).max(5000) }).strict(), (input: any) => prepare('comment-state/' + input.id, 'comment-commit/' + input.id, input.expectedRevision, { action: 'reply', content: input.content }));
  }
  if (config.canTheme) {
    await register('wp_list_navigation', 'List up to 30 saved block navigation menus with IDs and titles. Requires theme editing. Does not include classic menus or assign menus to templates.', z.object({ page: z.number().int().positive() }).strict(), async (input: any) => {
      const items = await api(config, 'navigation?context=edit&per_page=30&page=' + input.page); return { results: items.map((item: any) => ({ id: item.id, title: item.title.raw })), note: items.length ? 'Menús encontrados.' : 'Sin menús guardados.' };
    }, true);
    await register('wp_create_navigation', 'Create an empty block navigation menu for later editing. Does not assign it to templates; returns ID. Requires theme editing.', z.object({ title: z.string().trim().min(1).max(200) }).strict(), async (input: any) => {
      const item = await api(config, 'navigation', { method: 'POST', body: JSON.stringify({ title: input.title, content: '', status: 'publish' }) }); return request('entity-state/navigation/' + item.id);
    });
    await register('wp_get_navigation', 'Read a saved block navigation menu as serialized WordPress blocks with a revision. Use before changing links. Does not modify or assign it.', idSchema.strict(), (input: any) => request('entity-state/navigation/' + input.id), true);
    type Link = { label: string; url: string; children?: Link[] };
    const link: z.ZodType<Link> = z.lazy(() => z.object({ label: z.string().trim().min(1).max(200), url: z.string().url().refine(value => /^https?:\/\//i.test(value), 'HTTP/HTTPS únicamente.'), children: z.array(link).max(50).optional() }).strict());
    await register('wp_prepare_navigation', 'Prepare replacing a block menu with an ordered link tree. Array order controls position; children create submenus. Max 50 nodes and four levels. Applying changes every template using this menu. Use current revision and wp_apply_management_change.', idSchema.extend({ expectedRevision: z.string().length(64), title: z.string().trim().min(1).max(200), links: z.array(link).max(50) }).strict(), (input: any) => prepare('entity-state/navigation/' + input.id, 'entity-commit/navigation/' + input.id, input.expectedRevision, { title: input.title, links: input.links }));
    await register('wp_get_global_styles', 'Read active-theme user style overrides and revision without creating a style record. These are overrides, not resolved theme defaults.', z.object({}).strict(), () => request('style-state'), true);
    const styleChanges = z.object({ text: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(), background: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(), fontFamily: z.enum(['system-ui','serif','sans-serif']).nullable().optional(), fontSize: z.number().int().min(10).max(72).nullable().optional() }).strict().refine(value => Object.keys(value).length > 0, 'Indica cambios.');
    await register('wp_prepare_global_styles', 'Prepare active-theme global text/background colors, font family or font size in pixels. Null removes an override and inherits theme defaults. Applying affects site appearance immediately. Shows changes without saving; requires current style revision and separate apply.', z.object({ expectedRevision: z.string().length(64), changes: styleChanges }).strict(), (input: any) => prepare('style-state','style-commit',input.expectedRevision,{ changes: input.changes }));
  }
  if (config.canEdit) {
    await register('wp_list_synced_patterns', 'List saved synchronized patterns with pagination. Returns IDs and titles, excluding unsynchronized patterns. Requires edit permissions.', z.object({ page: z.number().int().positive() }).strict(), async (input: any) => {
      const items = await api(config,'blocks?context=edit&per_page=30&page=' + input.page); return { results: items.filter((item: any) => item.wp_pattern_sync_status !== 'unsynced').map((item: any) => ({ id: item.id, title: item.title.raw })), note: 'Página de patrones sincronizados.' };
    }, true);
    await register('wp_create_synced_pattern', 'Create a synchronized pattern from title and allowed WordPress block HTML. Returns ID for insertion in Gutenberg. Does not insert it or alter existing patterns.', z.object({ title: z.string().trim().min(1).max(200), content: z.string().max(50000) }).strict(), async (input: any) => {
      const item = await api(config,'blocks',{ method:'POST', body: JSON.stringify({ ...input, status:'publish' }) }); return request('entity-state/blocks/' + item.id);
    });
    await register('wp_get_synced_pattern', 'Read saved synchronized-pattern content and revision. Requires edit permission on the pattern.', idSchema.strict(), (input: any) => request('entity-state/blocks/' + input.id), true);
    await register('wp_prepare_synced_pattern', 'Prepare changing synchronized-pattern title and block HTML. Applying affects every existing reference to this pattern. Does not save yet; requires current revision and separate apply.', idSchema.extend({ expectedRevision: z.string().length(64), title: z.string().trim().min(1).max(200), content: z.string().max(50000) }).strict(), (input: any) => prepare('entity-state/blocks/' + input.id,'entity-commit/blocks/' + input.id,input.expectedRevision,{ title:input.title, content:input.content }));
  }
}
