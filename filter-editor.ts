const wp = (window as any).wp;
const h = wp.element.createElement;
wp.blocks.registerBlockType('fastwebmcp/content-filter', {
  title: 'Filtros de contenido', icon: 'filter', category: 'widgets',
  attributes: { label: { type: 'string', default: 'Explorar contenido' }, type: { type: 'string', default: 'post' }, limit: { type: 'number', default: 6 } },
  edit({ attributes, setAttributes }: any) {
    return h('div', wp.blockEditor.useBlockProps(),
      h(wp.blockEditor.InspectorControls, {}, h(wp.components.PanelBody, { title: 'Filtros' },
        h(wp.components.TextControl, { label: 'Título', value: attributes.label, onChange: (label: string) => setAttributes({ label }) }),
        h(wp.components.SelectControl, { label: 'Contenido', value: attributes.type, options: [{ label: 'Entradas', value: 'post' }, { label: 'Páginas', value: 'page' }], onChange: (type: string) => setAttributes({ type }) }),
        h(wp.components.RangeControl, { label: 'Máximo de resultados', min: 1, max: 12, value: attributes.limit, onChange: (limit: number) => setAttributes({ limit }) }))),
      h('h2', {}, attributes.label), h('p', {}, 'Búsqueda y filtros disponibles en el sitio. Los resultados usan contenido público.'));
  }, save() { return null; },
});
