# WebMCP en themes y bloques · API 0.6.0

El frontend usa un runtime compartido y adaptadores pequeños. No carga los bundles
administrativos ni inserta el panel de laboratorio. `core/search` se adapta
automáticamente al renderizarse; añade **Filtros de contenido** desde el editor
para usar el bloque `fastwebmcp/content-filter`. Ambos admiten varias instancias.
Los resultados y el estado aparecen en el propio componente del theme.

## Cargar una extensión desde un theme o plugin

```php
add_action('wp_enqueue_scripts', function () {
    fwmcp_enqueue_frontend();
    wp_enqueue_script('mytheme-webmcp', get_stylesheet_directory_uri().'/webmcp.js',
        array('fwmcp-runtime'), '1.0', true);
});
```

Un bloque dinámico puede llamar `fwmcp_enqueue_frontend()` en su render PHP.
Su JavaScript frontend puede utilizar la dependencia `fwmcp-runtime` en un
archivo `.asset.php` asociado a `viewScript`. No necesita importar otro SDK ni
crear un segundo panel. El runtime es un script clásico: las extensiones ESM
consumen `window.FastWebMCP` cuando esté disponible, o esperan el evento
`fastwebmcp:ready` en `document`; ese evento lleva la API en `detail`.

## Registrar un componente JavaScript

Markup por instancia: `<section data-fwmcp-component="counter"><button>Sumar</button><output>0</output></section>`.

```js
const api = window.FastWebMCP;
const disposeAdapter = api.registerComponent('counter',
  '[data-fwmcp-component="counter"]', ({ id, root, signal, registerTool }) => {
    const output = root.querySelector('output');
    let count = 0;
    const increment = () => {
      output.textContent = String(++count);
      return { id, count };
    };
    root.querySelector('button').addEventListener('click', increment, { signal });
    void registerTool({ name: 'increment', description: 'Increment this visible counter.',
      inputSchema: api.z.object({}).strict(), execute: increment
    }).catch(console.error);
    return () => { /* limpiar recursos adicionales */ };
  });
// disposeAdapter() retira todas las instancias de este adaptador.
```

El callback recibe `id`, `root`, `signal` y `registerTool`. Las herramientas
se llaman, por ejemplo, `counter_5_increment`: no reutilices ni almacenes IDs
entre navegaciones. La acción manual y la herramienta llaman la misma función.
Las descripciones deben identificar el componente y explicar el efecto.

El runtime observa inserción/retirada de nodos y cambios de
`data-fwmcp-component`. Abortará las herramientas, listeners y peticiones del
componente retirado; volver a insertarlo produce una instancia nueva. Admite
reemplazar componentes completos en navegación dinámica. Si cambias otros
atributos usados por tu selector llama `api.reconcile()`. Cada raíz pertenece
a un solo adaptador; para cambiar controles internos sustituye la raíz completa.
Un error de montaje se informa en consola y no se reintenta hasta retirar la raíz.

## API JavaScript pública

| Método | Contrato |
|---|---|
| `registerTool(spec, {signal})` | Promise de booleano: `true` confirma registro nativo; `false` indica WebMCP desactivado/no disponible. Errores rechazan la Promise. Usa nombres únicos y un AbortController para retirar herramientas globales. |
| `registerComponent(type, selector, mount)` | Devuelve función para retirar el adaptador. `mount` puede devolver limpieza síncrona. Sus herramientas reciben automáticamente el prefijo de instancia y su señal de vida. |
| `invokeServer(name, input, {signal})` | Ejecuta una operación PHP con cookies, nonce y validación REST. Devuelve el resultado JSON o rechaza con el mensaje del servidor. No registra una herramienta automáticamente. |
| `registerServerTool(name, {signal, onResult})` | Descubre el descriptor permitido y registra `server_NAME`. `onResult` permite mostrar el resultado en la interfaz. Resuelve como `registerTool`. |
| `schemaFromJSON(schema)` | Convierte el subconjunto documentado abajo a Zod. Rechaza claves o restricciones no compatibles. |
| `components()` / `reconcile()` | Lista IDs/tipos montados / reconcilia raíces actuales. |
| `supported()` / `z` / `version` | Disponibilidad efectiva, Zod compartido y versión de la API. |

`spec` contiene `name`, `description`, `inputSchema` Zod, `execute(input,
{signal})` y `readOnly` opcional. La señal de ejecución combina cancelación de
la llamada y retirada del componente. Propágala a peticiones y operaciones largas.
`fastwebmcp:error` en `document` comunica errores del executor con
`detail: {name, error}`; la validación Zod anterior al executor la informa WebMCP.

## Operaciones PHP extensibles

Registra operaciones en `init`, antes de `rest_api_init`. Deben declarar
esquema y comprobación de permisos, aunque sean de lectura pública.

```php
add_action('init', function () {
  fwmcp_register_frontend_tool('theme_echo', array(
    'description' => 'Echo a short label in the visible theme component.',
    'public' => true, 'readOnly' => true,
    'schema' => array('type'=>'object', 'additionalProperties'=>false,
      'properties'=>array('label'=>array('type'=>'string','maxLength'=>80)),
      'required'=>array('label')),
    'permission_callback' => '__return_true',
    'callback' => function ($input, $request) {
      return array('label' => sanitize_text_field($input['label']));
    }
  ));
});
```

```js
const api = window.FastWebMCP;
const lifetime = new AbortController();
await api.registerServerTool('theme_echo', {
  signal: lifetime.signal,
  onResult: result => document.querySelector('#theme-status').textContent = result.label
});
// lifetime.abort() cancela y retira la herramienta.
```

`public` es `false` por defecto y exige sesión. `capability` puede añadir una
capacidad WordPress, por ejemplo `manage_options`. `permission_callback(request)`
se ejecuta siempre en el servidor y puede devolver booleano o WP_Error. Para
permisos por objeto, comprueba `current_user_can('edit_post', $id)` contra el ID
validado del request. El callback recibe entrada validada/saneada y request.
La validación de esquema no sustituye el saneamiento de negocio (`wp_kses_post`,
`sanitize_text_field`, etc.). `readOnly` es una anotación para el agente; no concede
permisos. Para escrituras aplica preparación, revisión y confirmación al caso de uso.

Rutas: `GET /wp-json/fastwebmcp/v1/frontend-tools` descubre descriptores;
`POST /wp-json/fastwebmcp/v1/frontend-tools/NAME` recibe `{"input": {...}}`.
El manifiesto filtra sesión/capacidades, pero las restricciones por objeto se
evalúan al ejecutar. No incluye callbacks ni nonces. El runtime obtiene la sesión
por una petición Ajax sin caché, evitando nonces de usuario en HTML cacheable.
Si expira el nonce, la llamada falla y la siguiente solicita una sesión nueva;
no se reintentan escrituras automáticamente. Respeta respuestas sin caché en CDN.

El puente de JSON Schema admite objetos estrictos (`properties`, `required`,
`additionalProperties:false`), strings (`minLength`, `maxLength`), numbers/integers
(`minimum`, `maximum`), boolean, arrays (`items`, `minItems`, `maxItems`),
`enum` y `description`. Restricciones como `pattern`, `format`, referencias,
combinadores y defaults se rechazan al registrar el puente. Para schemas más
complejos registra herramientas JS con Zod y conserva validación equivalente REST.
Nombres PHP: letra minúscula seguida de letras, números, `_`, `.` o `-`, máximo
60 caracteres. El puente sustituye `.` y `-` por `_`; evita nombres que colisionen
tras esa conversión. Herramientas JS: minúsculas, números y `_`, máximo 100.

## Búsqueda y filtros incluidos

Cada búsqueda nativa registra `state`, `prepare({query})` y
`submit({revision})`. `prepare` rellena el campo; `submit` valida la revisión y
envía el formulario nativo tras 300 ms. Editar el campo invalida/cancela el envío.
La página de destino exige descubrir de nuevo sus herramientas.

Cada filtro registra `state`, `prepare({query,category})` y `apply({revision})`.
`apply` muestra resultados dentro de ese bloque usando la operación pública
`filter_content`. El botón manual llama la misma función. Cambiar los campos
cancela peticiones en curso e invalida revisiones. Solo devuelve entradas/páginas
publicadas sin contraseña, máximo 12. Las categorías están restringidas a las
opciones de la instancia y se omiten en el bloque de páginas.

Sin JavaScript, el filtro conserva formulario GET y resultados renderizados por
PHP. El fallback usa `fwmcp_query` y `fwmcp_category` compartidos por la página;
al navegar esos parámetros inicializan todas las instancias. Con JavaScript,
cada instancia mantiene campos y resultados independientes. Sin WebMCP, se
conserva la interacción manual JavaScript y GET.

Desactivar registro WebMCP: `add_filter('fwmcp_frontend_enabled','__return_false')`.
Panel de depuración opcional: `add_filter('fwmcp_frontend_debug_panel','__return_true')`;
solo aparece a usuarios con `manage_options` y carga el laboratorio administrativo.
No hace falta para themes ni bloques. El frontend no expone por defecto las
herramientas administrativas; estas siguen disponibles en sus pantallas habituales.

## Validación local

En el laboratorio externo, `seed-frontend-fixtures.php` crea las páginas de
prueba y `frontend-fixture.php` demuestra una extensión PHP y controles para
retirar/restaurar un bloque como MU plugin. Esos fixtures y los datos del sitio
no se distribuyen en este repositorio ni en el ZIP. Pruebas del runtime:

```sh
npm test
```

El runtime incluye Zod compartido (aprox. 429 KiB sin compresión); adaptadores
frontend 4.2 KiB y editor del bloque menos de 1 KiB. Se carga cuando hay bloques
compatibles o una extensión llama `fwmcp_enqueue_frontend()`. No se optimizó aún
el tamaño de Zod ni se incluye un motor de navegación SPA.
