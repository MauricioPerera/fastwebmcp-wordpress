export function supportsWebMcp(): boolean {
  if (typeof globalThis.document !== 'object' || globalThis.document === null) {
    return false;
  }
  const modelContext = (globalThis.document as { modelContext?: unknown }).modelContext;
  return typeof modelContext === 'object' && modelContext !== null;
}
