import { z } from 'zod';
import type { Config } from './navigation.ts';
import { siteRequest } from './management.ts';
export async function registerAudit(config: Config, register: any) {
  if (config.canManage) {
    await register('wp_list_users_roles', 'Read a page of user display names and assigned roles, plus role capabilities. No emails or passwords. Requires list_users on server. Does not change roles.', z.object({ page: z.number().int().positive() }).strict(), (input: any) => siteRequest(config,'inventory/users?page=' + input.page), true);
    await register('wp_list_plugins', 'Read installed regular plugins with versions and activation state. Requires activate_plugins. No activation, installation or update; excludes mu-plugins/drop-ins.', z.object({}).strict(), () => siteRequest(config,'inventory/plugins'), true);
    await register('wp_list_themes', 'Read installed themes, versions and active theme. Requires switch_themes. Does not activate or edit themes.', z.object({}).strict(), () => siteRequest(config,'inventory/themes'), true);
    await register('wp_available_updates', 'Read cached available WordPress/plugin/theme updates with last-check timestamps. Requires update_core. Missing cache is unknown, not proof of being up to date. Does not refresh remotely or install.', z.object({}).strict(), () => siteRequest(config,'inventory/updates'), true);
  }
  if (!config.canEdit) return;
  const target = z.object({ type: z.enum(['post','page']), id: z.number().int().positive() });
  async function document(input: any) { const state = await siteRequest(config,'post-state/' + input.id); if (state.values.type !== input.type) throw new Error('Tipo de documento incorrecto.'); return { state, html: new DOMParser().parseFromString(state.values.content,'text/html') }; }
  await register('wp_audit_image_alt', 'Inspect saved content images for missing or empty alt attributes. Returns issues and server revision; empty alt can be intentional for decorative images. Does not inspect unsaved edits or modify content.', target.strict(), async (input: any) => {
    const { state, html } = await document(input); return { revision: state.revision, images: [...html.querySelectorAll('img')].map((image,index) => ({ index, src: image.getAttribute('src'), alt: image.getAttribute('alt'), issue: !image.hasAttribute('alt') ? 'missing_alt' : !image.getAttribute('alt')?.trim() ? 'empty_alt_review_decoration' : null })) };
  }, true);
  await register('wp_audit_headings', 'Inspect saved content heading order, starting from level 1 for the page title. Returns skipped levels and body H1 warnings. Does not evaluate the rendered theme or unsaved edits.', target.strict(), async (input: any) => {
    const { state, html } = await document(input); let previous = 1;
    const headings = [...html.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((heading,index) => { const level=Number(heading.tagName.slice(1)); const issues = [...(level > previous + 1 ? ['skipped_level'] : []), ...(level === 1 ? ['body_h1_review_page_title'] : [])]; previous=level; return { index,level,text:heading.textContent,issues }; });
    return { revision:state.revision,headings,scope:'Contenido guardado; no es una auditoría completa de accesibilidad.' };
  }, true);
  await register('wp_audit_links', 'Check at most ten unique public same-origin links in saved content using bounded HEAD requests. Reports 404/410 as broken. External, admin/API, query/action and redirect URLs are skipped or unknown. Does not crawl the site or inspect unsaved content.', target.strict(), async (input: any) => {
    const { state, html } = await document(input); const results: any[] = []; const seen = new Set<string>(); let checked = 0;
    for (const anchor of html.querySelectorAll('a[href]')) {
      const raw=anchor.getAttribute('href')!; let url: URL;
      try { url=new URL(raw,state.values.link); } catch { results.push({ url:raw,status:'invalid_url' }); continue; }
      url.hash=''; if (seen.has(url.href)) continue; seen.add(url.href);
      if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin || /\/(wp-admin|wp-json|wp-login\.php|wp-comments-post\.php)(\/|$|\?)/.test(url.pathname) || url.search || checked>=10) { results.push({url:url.href,status:'skipped'}); continue; }
      checked++;
      try { const response=await fetch(url.href,{method:'HEAD',credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(4000)}); results.push({url:url.href,httpStatus:response.status,status:response.status===404||response.status===410?'broken':response.ok?'reachable':'unknown'}); }
      catch(error){results.push({url:url.href,status:'unknown',reason:String(error)});}
    }
    return {revision:state.revision,results,checked,scope:'Hasta diez enlaces públicos del mismo origen; no revisa destinos externos.'};
  }, true);
}
