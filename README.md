# FastWebMCP for WordPress

Herramientas WebMCP para usar WordPress desde un agente en el navegador, con
efectos visibles y permisos comprobados por WordPress. Versión **0.6.0**, MIT.

- Frontend: búsqueda nativa y bloque **Filtros de contenido**, independientes por instancia.
- Extensiones para themes y bloques mediante `window.FastWebMCP` y `fwmcp_register_frontend_tool()`.
- Administración: contenido, revisiones, comentarios, menús de bloques, patrones, estilos, medios, ajustes e inventario.
- Preparación y revisión antes de aplicar cambios, validación Zod/REST y cancelación con AbortSignal.
- Formularios manuales disponibles cuando WebMCP no está disponible.

## Instalar

Descarga el ZIP de una [release](https://github.com/MauricioPerera/fastwebmcp-wordpress/releases),
o constrúyelo siguiendo los pasos de abajo. En WordPress abre **Plugins → Añadir
plugin → Subir plugin**, selecciona `fastwebmcp-wordpress.zip` y actívalo.

Requisitos: WordPress 6.5 o posterior, PHP 8.0 o posterior. Para usar las
herramientas desde un agente, el navegador debe ofrecer WebMCP nativo.
La distribución incluye los scripts compilados; no carga JavaScript remoto.

El panel de laboratorio está en **FastWebMCP** dentro de administración.
En el sitio público, los bloques de búsqueda nativos se adaptan automáticamente;
inserta **Filtros de contenido** desde Gutenberg para filtrar entradas o páginas.
El panel técnico del frontend es opcional y solo se muestra a administradores.

## Extender un theme o bloque

```php
add_action('wp_enqueue_scripts', function () {
    fwmcp_enqueue_frontend();
    wp_enqueue_script('my-theme-tools', get_stylesheet_directory_uri().'/tools.js',
        array('fwmcp-runtime'), '1.0', true);
});
```

El JavaScript accede a `window.FastWebMCP`. La API registra herramientas y
componentes, asigna IDs por instancia y retira herramientas cuando desaparece
el componente. Para operaciones de servidor, la API PHP declara esquema,
callback y comprobación de permisos.

Consulta [FRONTEND.md](FRONTEND.md) para contratos, ejemplos completos,
ciclo de vida, caché, autenticación y límites de los esquemas.
[readme.txt](readme.txt) describe las herramientas administrativas.

## Desarrollo

Node.js 22 o posterior y Python 3 para generar el ZIP:

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run package
```

El ZIP se crea en `dist/fastwebmcp-wordpress.zip`. Incluye el plugin y sus
licencias; excluye las dependencias de desarrollo, tests y datos del sitio.
Los scripts compilados también se incluyen en Git para poder instalar el
plugin directamente desde esta carpeta.

La compilación usa un subconjunto MIT de
[FastWebMCP](https://github.com/MauricioPerera/fastwebmcp) en `vendor/fastwebmcp`
y Zod con versiones fijadas en `package-lock.json`. No necesita una copia
adyacente del repositorio del SDK. Las licencias están en `LICENSE`,
`LICENSE-ZOD` y `vendor/fastwebmcp/LICENSE`.

## Validación y alcance

El runtime cuenta con pruebas de esquemas, duplicados, cancelación,
retirada/remontaje y ausencia de WebMCP. La integración 0.6.0 se probó en un
WordPress local con el navegador vinculado: dos búsquedas, dos filtros,
extensión PHP, permisos, entradas inválidas y funcionamiento manual. En ese
laboratorio pasaron 27 comprobaciones REST nuevas y 105 de regresión.
Esas pruebas de integración requieren WordPress y fixtures del laboratorio;
`npm test` ejecuta las pruebas unitarias del runtime.

El runtime frontend compartido ocupa aproximadamente 429 KiB sin compresión.
La navegación dinámica admite reemplazar raíces completas de componentes;
no incluye un router SPA. El fallback GET de filtros comparte parámetros por
página. Las capacidades y el saneamiento del servidor siguen siendo obligatorios
en las extensiones. El plugin no está publicado en WordPress.org.
