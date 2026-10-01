import { z } from 'zod';
import type { Config } from './navigation.ts';
export async function registerSettings(config: Config, register: any, host: Element) {
  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(config.root + path, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': config.nonce } });
    const data = await response.json(); if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`); return data;
  }
  if (config.canManage) {
    const status = document.createElement('p'); status.setAttribute('role', 'status'); host.append(status);
    let preparation = 0; let prepared: { changes: Record<string, unknown>; revision: string } | null = null; let pending = false; let filling = false;
    const ids: Record<string, string> = { title: 'blogname', description: 'blogdescription', timezone: 'timezone_string', date_format: 'date_format_custom', time_format: 'time_format_custom', start_of_week: 'start_of_week', posts_per_page: 'posts_per_page', posts_per_rss: 'posts_per_rss', default_comment_status: 'default_comment_status', default_ping_status: 'default_ping_status' };
    for (const event of ['input', 'change']) document.querySelector('#wpbody-content form')?.addEventListener(event, () => { if (!filling && prepared) { prepared = null; status.textContent = 'Preparación cancelada: el formulario cambió.'; } });
    const changes = z.object({ title: z.string().trim().min(1).max(200).optional(), description: z.string().max(1000).optional(), timezone: z.string().max(100).optional(), date_format: z.string().min(1).max(100).optional(), time_format: z.string().min(1).max(100).optional(), start_of_week: z.number().int().min(0).max(6).optional(), posts_per_page: z.number().int().min(1).max(100).optional(), posts_per_rss: z.number().int().min(1).max(100).optional(), default_comment_status: z.enum(['open', 'closed']).optional(), default_ping_status: z.enum(['open', 'closed']).optional() }).strict().refine(value => Object.keys(value).length > 0, 'Indica cambios.');
    await register('wp_get_settings', 'Read supported General, Reading and Discussion settings with their current revision. Requires manage_options. Does not expose credentials or administrator email.', z.object({}).strict(), () => request('settings'), true);
    await register('wp_prepare_settings', 'Prepare supported settings changes without saving. Requires revision from wp_get_settings. Shows proposed changes and fills corresponding native fields when present. Returns preparationRevision for wp_save_settings.', z.object({ expectedRevision: z.string().length(64), changes }).strict(), async (input: any) => {
      if (pending) throw new Error('Guardado en curso.');
      const current = await request('settings'); if (current.revision !== input.expectedRevision) throw new Error('Los ajustes cambiaron. Lee wp_get_settings.');
      prepared = { changes: input.changes, revision: current.revision }; preparation++;
      filling = true;
      try { for (const [key, value] of Object.entries(input.changes)) {
        const field = document.getElementById(ids[key]) as HTMLInputElement | HTMLSelectElement | null;
        if (field) { if (key === 'date_format' || key === 'time_format') { for (const radio of document.querySelectorAll<HTMLInputElement>(`input[name="${key}"]`)) if (radio.value === '\\custom') radio.checked = true; } if (field instanceof HTMLInputElement && field.type === 'checkbox') field.checked = value === 'open'; else field.value = String(value); field.dispatchEvent(new Event('change', { bubbles: true })); }
      } } finally { filling = false; }
      status.textContent = 'Cambios preparados, todavía sin guardar: ' + JSON.stringify(input.changes);
      return { changes: input.changes, preparationRevision: preparation, status: 'prepared' };
    });
    await register('wp_save_settings', 'Persist the prepared settings after checking the server revision and preparationRevision. Requires manage_options. Consumes preparation. Some admin headings refresh on reload.', z.object({ preparationRevision: z.number().int().positive() }).strict(), async (input: any) => {
      if (pending || !prepared || preparation !== input.preparationRevision) throw new Error('Preparación inexistente o desactualizada.');
      pending = true;
      try { const result = await request('settings', { method: 'POST', body: JSON.stringify({ changes: prepared.changes, expectedRevision: prepared.revision }) }); prepared = null; status.textContent = 'Ajustes guardados en WordPress.'; return result; }
      finally { pending = false; }
    });
    await register('wp_tools_summary', 'Read WordPress/PHP versions, active theme, environment, upload limit and content counts. Requires manage_options. No repair or database modification.', z.object({}).strict(), () => request('tools-summary'), true);
  }
  if (config.canHealth) await register('wp_site_health', 'Run three local WordPress Site Health checks: PHP extensions, file uploads and debug mode. Requires view_site_health_checks. Partial diagnostic, not the complete Site Health evaluation.', z.object({}).strict(), () => request('site-health'), true);
  if (config.canExport) await register('wp_prepare_export', 'Prepare a protected WordPress WXR export download link. Requires export permission. Does not download yet; use the visible link. WXR includes content and media references, not media binaries or a full backup.', z.object({ content: z.enum(['all', 'post', 'page', 'attachment']) }).strict(), async (input: any) => {
    const result = await request('export-link?content=' + input.content); let link = host.querySelector<HTMLAnchorElement>('#fwmcp-export-link');
    if (!link) { link = document.createElement('a'); link.id = 'fwmcp-export-link'; host.append(link); }
    link.href = result.url; link.textContent = 'Descargar exportación WXR · ' + input.content; return result;
  });
}
