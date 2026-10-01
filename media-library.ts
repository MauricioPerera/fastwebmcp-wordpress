import { z } from 'zod';
import { registerToolAsync, supportsWebMcp } from './vendor/fastwebmcp/index.ts';
import { registerMedia } from './media.ts';
import { registerSettings } from './settings.ts';
import { registerContent } from './content.ts';
import { registerManagement } from './management.ts';
import { registerAudit } from './audit.ts';
import { registerNavigation } from './navigation.ts';
const config = (window as any).FastWebMCPWP;
const dock = document.createElement('details'); dock.open = true; dock.id = 'fwmcp-media-panel';
dock.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:100000;background:#f5f7fc;color:#172640;padding:14px;border:1px solid #91a3c0;border-radius:10px;width:370px;max-width:calc(100vw - 24px);max-height:65vh;overflow:auto;font:13px/1.4 system-ui';
const summary = document.createElement('summary'); summary.textContent = 'WebMCP · biblioteca de medios';
const output = document.createElement('pre'); output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;max-height:130px;overflow:auto'; output.setAttribute('aria-live', 'polite'); dock.append(summary, output); document.body.append(dock);
async function register<S extends z.ZodType>(name: string, description: string, schema: S, execute: (input: z.infer<S>) => unknown, readOnly = false) {
  await registerToolAsync({ name, description, inputSchema: schema, annotations: { readOnlyHint: readOnly, untrustedContentHint: true }, execute: async input => {
    try { const result = await execute(input); output.textContent = name + '\n' + JSON.stringify(result, null, 2); return result; }
    catch (error) { output.textContent = String(error); throw error; }
  } });
}
async function initialize() {
  if (!supportsWebMcp()) { output.textContent = 'WebMCP no disponible.'; return; }
  await registerMedia(config, register, dock);
    await registerSettings(config, register, dock); await registerContent(config, register, dock); await registerManagement(config, register, dock); await registerAudit(config, register); await registerNavigation(config, register);
  output.textContent = 'Herramientas de medios conectadas.';
}
void initialize().catch(error => { output.textContent = String(error); });
