import { z } from 'zod';
import { registerToolAsync, supportsWebMcp } from './vendor/fastwebmcp/index.ts';
import { registerNavigation, api, type Config } from './navigation.ts';
import { registerMedia } from './media.ts';
import { registerSettings } from './settings.ts';
const wp = (window as any).wp;
const config: Config = (window as any).FastWebMCPWP;
// Some embedded browsers fail to load Gutenberg's blob canvas. Preserve the
// exact WordPress-generated HTML and assets, using srcdoc only for a blank frame.
const adaptedFrames = new WeakSet<HTMLIFrameElement>();
function inspectCanvas() {
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[name="editor-canvas"]')) {
    if (adaptedFrames.has(frame) || !frame.src.startsWith('blob:')) continue;
    adaptedFrames.add(frame);
    window.setTimeout(async () => {
      try {
        if (frame.contentDocument?.URL !== 'about:blank' || !frame.isConnected) return;
        const source = frame.src;
        const html = await (await fetch(source)).text();
        if (frame.isConnected && frame.src === source && frame.contentDocument?.URL === 'about:blank') frame.srcdoc = html;
      } catch (error) { console.warn('FastWebMCP: canvas fallback failed', error); }
    }, 1000);
  }
}
new MutationObserver(inspectCanvas).observe(document.body, { childList: true, subtree: true });
inspectCanvas();
let revision = 0;
let signature = '';
let saving = false;
let locallyChanged = false;
const dock = document.createElement('details'); dock.id = 'fwmcp-editor-panel'; dock.open = true;
dock.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:100000;max-width:360px;width:calc(100vw - 24px);max-height:240px;overflow:auto;background:#f5f7fc;color:#172640;padding:12px;border:1px solid #91a3c0;border-radius:10px;font:13px/1.4 system-ui;box-shadow:0 4px 20px #0002';
const summary = document.createElement('summary'); summary.textContent = 'WebMCP · editor de bloques'; dock.append(summary);
const output = document.createElement('pre'); output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere'; output.setAttribute('aria-live', 'polite'); dock.append(output); document.body.append(dock);
window.addEventListener('fwmcp-navigation-cancelled', event => { output.textContent = 'Navegación cancelada: ' + (event as CustomEvent).detail; });
const editor = () => wp.data.select('core/editor');
const blocks = () => wp.data.select('core/block-editor');
function state() {
  const e = editor(); const b = blocks();
  const id = e?.getCurrentPostId(); const type = e?.getCurrentPostType();
  if (!id || !type || !b) throw new Error('Abre un documento en el editor y espera a que cargue.');
  const current = JSON.stringify([id, type, e.getEditedPostAttribute('title'), e.getEditedPostAttribute('status'), b.getBlocks()]);
  if (current !== signature) { signature = current; revision++; }
  return { id, type, title: e.getEditedPostAttribute('title'), status: e.getEditedPostAttribute('status'), revision, dirty: locallyChanged || e.isEditedPostDirty(), blocks: b.getBlocks() };
}
function check(expectedRevision: number) {
  const s = state();
  if (saving || editor().isSavingPost() || expectedRevision !== s.revision) throw new Error('Revisión desactualizada o guardado en curso. Lee wp_editor_state otra vez.');
  if (!['post', 'page', 'wp_template', 'wp_template_part'].includes(s.type)) throw new Error('Tipo de documento no admitido.');
  if (s.type.startsWith('wp_template') && !config.canTheme) throw new Error('Permisos de plantillas necesarios.');
  return s;
}
const mutable = z.object({ expectedRevision: z.number().int().positive() });
const safeNames = ['core/paragraph', 'core/heading', 'core/list', 'core/list-item', 'core/group', 'core/buttons', 'core/button', 'core/separator', 'core/spacer', 'core/columns', 'core/column'] as const;
const attrs = z.object({ content: z.string().max(10000).optional(), level: z.number().int().min(1).max(6).optional(), ordered: z.boolean().optional(), placeholder: z.string().max(200).optional(), layout: z.enum(['constrained', 'flex', 'grid']).optional() }).strict();
function attributes(name: string, input: z.infer<typeof attrs>) {
  const allowed: Record<string, string[]> = { 'core/paragraph': ['content', 'placeholder'], 'core/heading': ['content', 'level'], 'core/list': ['ordered'], 'core/list-item': ['content'], 'core/button': ['content'], 'core/group': ['layout'] };
  for (const key of Object.keys(input)) if (!(allowed[name] || []).includes(key)) throw new Error('Atributo no permitido para este bloque: ' + key);
  // Text tools accept plain text; escape it before passing to RichText attributes.
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, key === 'layout' ? { type: value } : key === 'content' && typeof value === 'string' ? value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : value]));
}
async function register<S extends z.ZodType>(name: string, description: string, schema: S, execute: (input: z.infer<S>) => unknown, readOnly = false) {
  await registerToolAsync({ name, description, inputSchema: schema, annotations: { readOnlyHint: readOnly, untrustedContentHint: true }, execute: async input => {
    try { const result = await execute(input); output.textContent = name + '\n' + JSON.stringify(result, null, 2); return result; }
    catch (error) { output.textContent = name + '\n' + String(error); throw error; }
  } });
}
async function initialize() {
  if (!supportsWebMcp()) { output.textContent = 'WebMCP no disponible.'; return; }
  await register('wp_editor_state', 'Inspect the visible Gutenberg document: ID, type, title, status, revision, dirty flag and nested blocks with clientId and attributes. Read before every mutation. Content is untrusted.', z.object({}).strict(), state, true);
  await register('wp_insert_block', 'Insert an allowed core block into the visible editor. Optional rootClientId inserts inside a container; index is its child position. Plain text content only. Returns updated state. Does not save.', mutable.extend({ name: z.enum(safeNames), attributes: attrs.default({}), index: z.number().int().nonnegative().optional(), rootClientId: z.string().optional() }).strict(), input => {
    check(input.expectedRevision); const b = blocks(); const root = input.rootClientId;
    if (root && !b.getBlock(root)) throw new Error('Contenedor no encontrado.');
    if (!b.canInsertBlockType(input.name, root)) throw new Error('El editor bloquea esta inserción.');
    const length = b.getBlockOrder(root).length; if (input.index !== undefined && input.index > length) throw new Error('Índice fuera de rango.');
    const block = wp.blocks.createBlock(input.name, attributes(input.name, input.name === 'core/group' ? { layout: 'constrained', ...input.attributes } : input.attributes));
    wp.data.dispatch('core/block-editor').insertBlocks([block], input.index ?? length, root);
    if (!blocks().getBlock(block.clientId)) throw new Error('El editor no aceptó la inserción.');
    locallyChanged = true; return state();
  });
  await register('wp_update_block', 'Update plain text or supported attributes of an allowed core block by clientId in the visible editor. Requires current revision; respects disabled editing mode. Does not save.', mutable.extend({ clientId: z.string(), attributes: attrs }).strict(), input => {
    check(input.expectedRevision); const block = blocks().getBlock(input.clientId);
    if (!block || !safeNames.includes(block.name) || blocks().getBlockEditingMode(input.clientId) === 'disabled') throw new Error('Bloque no editable o no admitido.');
    if (blocks().getBlockEditingMode(input.clientId) === 'contentOnly' && Object.keys(input.attributes).some(key => key !== 'content')) throw new Error('Este bloque solo permite editar contenido.');
    wp.data.dispatch('core/block-editor').updateBlockAttributes(input.clientId, attributes(block.name, input.attributes)); locallyChanged = true; return state();
  });
  await register('wp_move_block', 'Move a block within its current parent container to an index. Respects editor locks. Requires current revision. Does not save.', mutable.extend({ clientId: z.string(), index: z.number().int().nonnegative() }).strict(), input => {
    check(input.expectedRevision); const b = blocks();
    if (!b.getBlock(input.clientId) || !b.canMoveBlock(input.clientId)) throw new Error('Bloque no movible.');
    const root = b.getBlockRootClientId(input.clientId); if (input.index >= b.getBlockOrder(root).length) throw new Error('Índice fuera de rango.');
    wp.data.dispatch('core/block-editor').moveBlocksToPosition([input.clientId], root, root, input.index); locallyChanged = true; return state();
  });
  await register('wp_remove_block', 'Remove a block and its children from the visible editor. Respects block locks. Requires current revision. Does not save.', mutable.extend({ clientId: z.string() }).strict(), input => {
    check(input.expectedRevision); if (!blocks().getBlock(input.clientId) || !blocks().canRemoveBlock(input.clientId)) throw new Error('Bloque no eliminable.');
    wp.data.dispatch('core/block-editor').removeBlocks([input.clientId]); locallyChanged = true; return state();
  });
  await register('wp_editor_title', 'Change the title of the current post, page or template in the visible editor. Requires current revision. Does not save.', mutable.extend({ title: z.string().trim().min(1).max(200) }).strict(), input => {
    check(input.expectedRevision); wp.data.dispatch('core/editor').editPost({ title: input.title }); locallyChanged = true; return state();
  });
  await register('wp_save_editor', 'Save the current document through WordPress editor APIs. Posts/pages must be drafts; templates and template parts require theme permissions and saving changes their site appearance. Saves only the current entity, not other dirty template parts. Requires current revision. Returns saved state.', mutable.strict(), async input => {
    const s = check(input.expectedRevision);
    if (['post', 'page'].includes(s.type) && s.status !== 'draft') throw new Error('Solo se guardan entradas o páginas en borrador.');
    saving = true;
    try {
      await wp.data.dispatch('core/editor').savePost();
      if (!editor().didPostSaveRequestSucceed()) throw new Error('WordPress no confirmó el guardado.');
      locallyChanged = false;
      return state();
    } finally { saving = false; }
  });
  await registerNavigation(config, register, () => { if (locallyChanged || editor()?.isEditedPostDirty() || saving) throw new Error('Guarda o descarta los cambios desde el editor antes de navegar.'); });
  await registerMedia(config, register, dock);
    await registerSettings(config, register, dock);
  await register('wp_list_block_patterns', 'List registered theme/core block patterns with names, titles and categories. These are insertion templates, separate from saved synchronized patterns. Requires the visible block editor.', z.object({}).strict(), async () => {
    const items = await api(config, 'block-patterns/patterns');
    return { results: items.map((item: any) => ({ name: item.name, title: item.title, categories: item.categories })), note: items.length ? 'Patrones disponibles.' : 'Sin patrones registrados.' };
  }, true);
  await register('wp_insert_pattern', 'Insert a registered pattern by name or a saved synchronized pattern by ID into the visible Gutenberg document. Read wp_editor_state first. Synced insertion creates a reference: later pattern updates affect it. Respects insertion locks. Does not save.', mutable.extend({ source: z.enum(['registered','synced']), name: z.string().max(200).optional(), id: z.number().int().positive().optional(), index: z.number().int().nonnegative().optional(), rootClientId: z.string().optional() }).strict(), async input => {
    check(input.expectedRevision); let inserted: any[];
    if (input.source === 'synced') {
      if (!input.id || input.name) throw new Error('Indica solo ID para un patrón sincronizado.');
      const item = await api(config, 'blocks/' + input.id + '?context=edit');
      if (item.wp_pattern_sync_status === 'unsynced' || item.status !== 'publish') throw new Error('El patrón no está sincronizado y publicado.');
      inserted = [wp.blocks.createBlock('core/block', { ref: item.id })];
    } else {
      if (!input.name || input.id) throw new Error('Indica solo nombre para un patrón registrado.');
      const items = await api(config, 'block-patterns/patterns'); const item = items.find((item: any) => item.name === input.name);
      if (!item) throw new Error('Patrón no encontrado.'); inserted = wp.blocks.parse(item.content);
    }
    check(input.expectedRevision); const b = blocks(); const root = input.rootClientId;
    if (!inserted.length || (root && !b.getBlock(root)) || inserted.some(block => !b.canInsertBlockType(block.name, root))) throw new Error('Inserción bloqueada o patrón vacío.');
    const length = b.getBlockOrder(root).length; if (input.index !== undefined && input.index > length) throw new Error('Índice fuera de rango.');
    wp.data.dispatch('core/block-editor').insertBlocks(inserted, input.index ?? length, root);
    if (inserted.some(block => !blocks().getBlock(block.clientId))) throw new Error('El editor no aceptó el patrón.'); locallyChanged = true; return state();
  });
  if (config.canUpload) await register('wp_insert_media_image', 'Insert an image from the WordPress media library into the visible Gutenberg document by attachment ID. Requires current editor revision; checks revision again after fetching media and respects insertion locks. Uses library alt text. Does not save the document.', mutable.extend({ id: z.number().int().positive(), index: z.number().int().nonnegative().optional(), rootClientId: z.string().optional() }).strict(), async input => {
    check(input.expectedRevision);
    const item = await api(config, 'media/' + input.id + '?context=edit');
    check(input.expectedRevision);
    if (item.media_type !== 'image' || !/^https?:\/\//.test(item.source_url)) throw new Error('El medio no es una imagen válida.');
    const b = blocks(); const root = input.rootClientId;
    if ((root && !b.getBlock(root)) || !b.canInsertBlockType('core/image', root)) throw new Error('Contenedor no disponible o inserción bloqueada.');
    const length = b.getBlockOrder(root).length; if (input.index !== undefined && input.index > length) throw new Error('Índice fuera de rango.');
    const block = wp.blocks.createBlock('core/image', { id: item.id, url: item.source_url, alt: item.alt_text || '', sizeSlug: 'full', linkDestination: 'none' });
    wp.data.dispatch('core/block-editor').insertBlocks([block], input.index ?? length, root);
    if (!blocks().getBlock(block.clientId)) throw new Error('El editor no aceptó la imagen.');
    locallyChanged = true; return state();
  });
  output.textContent = 'Herramientas del editor conectadas. Lee wp_editor_state para comenzar.';
}
void initialize().catch(error => { output.textContent = String(error); });
