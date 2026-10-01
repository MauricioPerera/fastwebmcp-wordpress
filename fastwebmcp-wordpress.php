<?php
/**
 * Plugin Name: FastWebMCP for WordPress
 * Description: Herramientas WebMCP visibles para contenido, revisiones, navegación, comentarios, patrones, estilos y administración con permisos de WordPress.
 * Version: 0.6.0
 * Requires at least: 6.5
 * Requires PHP: 8.0
 * License: MIT
 */
if (!defined('ABSPATH')) { exit; }
require_once __DIR__ . '/settings-tools.php';
require_once __DIR__ . '/content-tools.php';
require_once __DIR__ . '/management-tools.php';
require_once __DIR__ . '/inventory-tools.php';
require_once __DIR__ . '/frontend-api.php';

function fwmcp_can_edit() { return current_user_can('edit_posts'); }
function fwmcp_summary($post) {
    return array('id' => $post->ID, 'title' => get_the_title($post), 'type' => $post->post_type,
        'status' => $post->post_status, 'url' => get_permalink($post));
}
add_action('rest_api_init', function () {
    register_rest_route('fastwebmcp/v1', '/editor-link/(?P<id>\d+)', array('methods' => 'GET',
        'permission_callback' => function ($request) { return current_user_can('edit_post', (int) $request['id']); },
        'callback' => function ($request) { return array('url' => get_edit_post_link((int) $request['id'], 'raw')); }));
    register_rest_route('fastwebmcp/v1', '/info', array('methods' => 'GET', 'permission_callback' => '__return_true',
        'callback' => function () { return array('name' => get_bloginfo('name'), 'description' => get_bloginfo('description'),
            'url' => home_url('/'), 'language' => get_bloginfo('language')); }));
    register_rest_route('fastwebmcp/v1', '/search', array('methods' => 'GET', 'permission_callback' => '__return_true',
        'args' => array('query' => array('type' => 'string', 'required' => true, 'sanitize_callback' => 'sanitize_text_field')),
        'callback' => function ($request) {
            $posts = get_posts(array('s' => $request['query'], 'post_type' => array('post', 'page'), 'post_status' => 'publish', 'numberposts' => 10));
            $posts = array_filter($posts, function ($post) { return $post->post_password === ''; });
            return array('results' => array_values(array_map('fwmcp_summary', $posts)), 'note' => count($posts) ? 'Contenido publicado.' : 'Sin coincidencias.');
        }));
    register_rest_route('fastwebmcp/v1', '/content/(?P<id>\d+)', array('methods' => 'GET', 'permission_callback' => '__return_true',
        'callback' => function ($request) {
            $post = get_post((int) $request['id']);
            if (!$post || $post->post_status !== 'publish' || $post->post_password !== '' || !in_array($post->post_type, array('post', 'page'), true)) {
                return new WP_Error('not_found', 'Contenido publico no encontrado.', array('status' => 404));
            }
            return array_merge(fwmcp_summary($post), array('content' => wp_strip_all_tags(strip_shortcodes($post->post_content))));
        }));
    register_rest_route('fastwebmcp/v1', '/drafts', array(
        array('methods' => 'GET', 'permission_callback' => 'fwmcp_can_edit', 'callback' => function () {
            $args = array('post_type' => 'post', 'post_status' => 'draft', 'numberposts' => 20);
            if (!current_user_can('edit_others_posts')) { $args['author'] = get_current_user_id(); }
            return array('results' => array_map('fwmcp_summary', get_posts($args)));
        }),
        array('methods' => 'POST', 'permission_callback' => 'fwmcp_can_edit',
            'args' => array('title' => array('type' => 'string', 'required' => true), 'content' => array('type' => 'string', 'required' => true)),
            'callback' => function ($request) {
                $title = sanitize_text_field($request['title']);
                if (trim($title) === '' || strlen($title) > 1000 || strlen($request['content']) > 200000) {
                    return new WP_Error('invalid_draft', 'Titulo vacio o contenido demasiado largo.', array('status' => 400));
                }
                $id = wp_insert_post(wp_slash(array('post_type' => 'post', 'post_status' => 'draft', 'post_author' => get_current_user_id(),
                    'post_title' => $title, 'post_content' => wp_kses_post($request['content']))), true);
                if (is_wp_error($id)) { return $id; }
                return array('id' => $id, 'title' => get_the_title($id), 'status' => 'draft', 'edit_url' => get_edit_post_link($id, 'raw'));
            })
    ));
});

function fwmcp_assets() {
    wp_enqueue_style('fastwebmcp-wordpress', plugins_url('assets/style.css', __FILE__), array(), '0.6.0');
    wp_enqueue_script('fastwebmcp-wordpress', plugins_url('assets/tools.js', __FILE__), array(), '0.6.0', true);
    wp_localize_script('fastwebmcp-wordpress', 'FastWebMCPWP', array('root' => rest_url('fastwebmcp/v1/'),
        'apiRoot' => rest_url('wp/v2/'), 'adminUrl' => admin_url(),
        'nonce' => is_user_logged_in() ? wp_create_nonce('wp_rest') : '', 'canModerate' => current_user_can('moderate_comments'), 'canManage' => current_user_can('manage_options'), 'canHealth' => current_user_can('view_site_health_checks'), 'canExport' => current_user_can('export'), 'canEdit' => fwmcp_can_edit(),
        'canUpload' => current_user_can('upload_files'), 'uploadLimit' => wp_max_upload_size(), 'canTheme' => current_user_can('edit_theme_options')));
}
add_action('wp_enqueue_scripts', function () { if (apply_filters('fwmcp_frontend_debug_panel', false) && current_user_can('manage_options')) { fwmcp_assets(); } });
add_action('admin_enqueue_scripts', function ($hook) { if ($hook === 'toplevel_page_fastwebmcp') { fwmcp_assets(); } });
add_action('admin_enqueue_scripts', function ($hook) {
    if ($hook !== 'upload.php' || !current_user_can('upload_files')) { return; }
    wp_enqueue_script('fastwebmcp-media', plugins_url('assets/media-library.js', __FILE__), array('media-views'), '0.6.0', true);
    wp_localize_script('fastwebmcp-media', 'FastWebMCPWP', array('root' => rest_url('fastwebmcp/v1/'),
        'apiRoot' => rest_url('wp/v2/'), 'adminUrl' => admin_url(), 'nonce' => wp_create_nonce('wp_rest'),
        'canModerate' => current_user_can('moderate_comments'), 'canManage' => current_user_can('manage_options'), 'canHealth' => current_user_can('view_site_health_checks'), 'canExport' => current_user_can('export'), 'canEdit' => fwmcp_can_edit(), 'canTheme' => current_user_can('edit_theme_options'),
        'canUpload' => true, 'uploadLimit' => wp_max_upload_size()));
});
add_action('admin_enqueue_scripts', function ($hook) {
    $screen = get_current_screen();
    if (!$screen || !(($screen->is_block_editor() && fwmcp_can_edit()) || ($hook === 'site-editor.php' && current_user_can('edit_theme_options')))) { return; }
    wp_enqueue_script('fastwebmcp-editor', plugins_url('assets/editor.js', __FILE__), array('wp-data', 'wp-blocks', 'wp-editor'), '0.6.0', true);
    wp_localize_script('fastwebmcp-editor', 'FastWebMCPWP', array('root' => rest_url('fastwebmcp/v1/'),
        'apiRoot' => rest_url('wp/v2/'), 'adminUrl' => admin_url(), 'nonce' => wp_create_nonce('wp_rest'),
        'canModerate' => current_user_can('moderate_comments'), 'canManage' => current_user_can('manage_options'), 'canHealth' => current_user_can('view_site_health_checks'), 'canExport' => current_user_can('export'), 'canEdit' => fwmcp_can_edit(), 'canUpload' => current_user_can('upload_files'), 'uploadLimit' => wp_max_upload_size(), 'canTheme' => current_user_can('edit_theme_options')));
});

function fwmcp_panel() {
    ?>
    <section id="fwmcp-panel" aria-label="Panel WebMCP">
      <div class="fwmcp-header"><h2>WordPress + WebMCP</h2><span id="fwmcp-status" role="status">Conectando…</span></div>
      <p>El agente usa las herramientas del sitio. Cada resultado aparece aquí.</p>
      <form id="fwmcp-search-form" role="search" method="get" action="<?php echo esc_url(home_url('/')); ?>">
        <label for="fwmcp-search-query">Buscar en el sitio</label>
        <input type="search" id="fwmcp-search-query" name="s" maxlength="200" required value="<?php echo esc_attr(get_search_query(false)); ?>" />
        <button type="submit">Buscar en WordPress</button>
        <p id="fwmcp-search-status" role="status">Prepara una búsqueda y abre sus resultados.</p>
      </form>
      <div class="fwmcp-grid"><div><h3>Herramientas disponibles</h3><ul id="fwmcp-tools"></ul>
      <h3>Resultado</h3><pre id="fwmcp-result" aria-live="polite">Aún no hay llamadas.</pre></div>
      <div><h3>Actividad</h3><ol id="fwmcp-log" aria-live="polite"></ol></div></div>
      <?php if (fwmcp_can_edit()) : ?>
      <div class="fwmcp-draft"><h3>Preparar un borrador</h3>
        <label for="fwmcp-title">Título</label><input id="fwmcp-title" maxlength="200" />
        <label for="fwmcp-content">Contenido</label><textarea id="fwmcp-content" maxlength="200000" rows="7"></textarea>
        <button type="button" id="fwmcp-save">Guardar borrador en WordPress</button><p id="fwmcp-draft-status" role="status">Sin borrador preparado.</p>
      </div>
      <?php else : ?><p>Inicia sesión con permisos de edición para preparar y guardar borradores.</p><?php endif; ?>
    </section>
    <?php
}
add_action('wp_footer', function () { if (apply_filters('fwmcp_frontend_debug_panel', false) && current_user_can('manage_options')) { fwmcp_panel(); } }, 5);
add_action('admin_menu', function () {
    add_menu_page('FastWebMCP', 'FastWebMCP', 'edit_posts', 'fastwebmcp', function () {
        echo '<div class="wrap"><h1>FastWebMCP · laboratorio WordPress</h1>'; fwmcp_panel(); echo '</div>';
    }, 'dashicons-editor-code', 30);
});

add_action('admin_enqueue_scripts', function ($hook) {
    $pages = array('options-general.php', 'options-writing.php', 'options-reading.php', 'options-discussion.php', 'options-media.php', 'options-permalink.php', 'options-privacy.php', 'users.php', 'plugins.php', 'themes.php', 'update-core.php', 'edit.php', 'edit-comments.php', 'tools.php', 'site-health.php', 'export.php', 'import.php');
    if (!in_array($hook, $pages, true) || !(fwmcp_can_edit() || current_user_can('moderate_comments') || current_user_can('edit_theme_options') || current_user_can('manage_options') || current_user_can('view_site_health_checks') || current_user_can('export'))) { return; }
    wp_enqueue_script('fastwebmcp-admin', plugins_url('assets/admin-tools.js', __FILE__), array(), '0.6.0', true);
    wp_localize_script('fastwebmcp-admin', 'FastWebMCPWP', array('root' => rest_url('fastwebmcp/v1/'), 'apiRoot' => rest_url('wp/v2/'), 'adminUrl' => admin_url(), 'nonce' => wp_create_nonce('wp_rest'),
        'canModerate' => current_user_can('moderate_comments'), 'canManage' => current_user_can('manage_options'), 'canHealth' => current_user_can('view_site_health_checks'), 'canExport' => current_user_can('export'), 'canEdit' => fwmcp_can_edit(), 'canTheme' => current_user_can('edit_theme_options'), 'canUpload' => current_user_can('upload_files'), 'uploadLimit' => wp_max_upload_size()));
});
