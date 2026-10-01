<?php
if (!defined('ABSPATH')) { exit; }
function fwmcp_settings_map() {
    return array('title' => 'blogname', 'description' => 'blogdescription', 'timezone' => 'timezone_string',
        'date_format' => 'date_format', 'time_format' => 'time_format', 'start_of_week' => 'start_of_week',
        'posts_per_page' => 'posts_per_page', 'posts_per_rss' => 'posts_per_rss',
        'default_comment_status' => 'default_comment_status', 'default_ping_status' => 'default_ping_status');
}
function fwmcp_settings_snapshot() {
    $values = array();
    foreach (fwmcp_settings_map() as $key => $option) {
        $value = get_option($option);
        $values[$key] = in_array($key, array('start_of_week', 'posts_per_page', 'posts_per_rss'), true) ? (int) $value : (string) $value;
    }
    return array('values' => $values, 'revision' => hash('sha256', wp_json_encode($values)));
}
add_action('rest_api_init', function () {
    register_rest_route('fastwebmcp/v1', '/settings', array(
        array('methods' => 'GET', 'permission_callback' => function () { return current_user_can('manage_options'); }, 'callback' => 'fwmcp_settings_snapshot'),
        array('methods' => 'POST', 'permission_callback' => function () { return current_user_can('manage_options'); },
            'args' => array('expectedRevision' => array('type' => 'string', 'required' => true), 'changes' => array('type' => 'object', 'required' => true)),
            'callback' => function ($request) {
                $current = fwmcp_settings_snapshot();
                if (!hash_equals($current['revision'], $request['expectedRevision'])) { return new WP_Error('stale_settings', 'Los ajustes cambiaron. Lee la revisión actual.', array('status' => 409)); }
                $changes = $request['changes']; $map = fwmcp_settings_map();
                if (!$changes || array_diff(array_keys($changes), array_keys($map))) { return new WP_Error('invalid_settings', 'Campos no admitidos o cambios vacíos.', array('status' => 400)); }
                $validated = array();
                foreach ($changes as $key => $value) {
                    if (in_array($key, array('start_of_week', 'posts_per_page', 'posts_per_rss'), true)) {
                        $valid = is_int($value) && $value >= ($key === 'start_of_week' ? 0 : 1) && $value <= ($key === 'start_of_week' ? 6 : 100);
                    } elseif (in_array($key, array('default_comment_status', 'default_ping_status'), true)) {
                        $valid = in_array($value, array('open', 'closed'), true);
                    } elseif ($key === 'timezone') {
                        $valid = is_string($value) && ($value === '' || in_array($value, timezone_identifiers_list(), true));
                    } else {
                        $valid = is_string($value) && strlen($value) <= ($key === 'description' ? 2000 : 400) && ($key === 'description' || trim($value) !== '');
                    }
                    if (!$valid) { return new WP_Error('invalid_settings', 'Valor no admitido: ' . $key, array('status' => 400)); }
                    $validated[$map[$key]] = sanitize_option($map[$key], $value);
                }
                foreach ($validated as $option => $value) { update_option($option, $value); }
                return fwmcp_settings_snapshot();
            })
    ));
    register_rest_route('fastwebmcp/v1', '/tools-summary', array('methods' => 'GET', 'permission_callback' => function () { return current_user_can('manage_options'); },
        'callback' => function () {
            global $wp_version; $counts = array();
            foreach (array('post', 'page', 'attachment') as $type) { $counts[$type] = wp_count_posts($type, 'readable'); }
            return array('wordpress' => $wp_version, 'php' => PHP_VERSION, 'theme' => wp_get_theme()->get('Name'), 'environment' => wp_get_environment_type(), 'uploadLimit' => wp_max_upload_size(), 'contentCounts' => $counts);
        }));
    register_rest_route('fastwebmcp/v1', '/site-health', array('methods' => 'GET', 'permission_callback' => function () { return current_user_can('view_site_health_checks'); },
        'callback' => function () {
            require_once ABSPATH . 'wp-admin/includes/class-wp-site-health.php';
            $health = WP_Site_Health::get_instance(); $results = array();
            foreach (array('file_uploads', 'php_extensions', 'is_in_debug_mode') as $test) {
                $result = $health->{'get_test_' . $test}();
                $results[] = array('test' => $test, 'status' => $result['status'], 'label' => wp_strip_all_tags($result['label']), 'description' => wp_strip_all_tags($result['description']));
            }
            return array('scope' => 'Tres diagnósticos locales; no representa la evaluación completa de Salud del sitio.', 'results' => $results);
        }));
    register_rest_route('fastwebmcp/v1', '/export-link', array('methods' => 'GET', 'permission_callback' => function () { return current_user_can('export'); },
        'args' => array('content' => array('type' => 'string', 'enum' => array('all', 'post', 'page', 'attachment'), 'default' => 'all')),
        'callback' => function ($request) {
            return array('content' => $request['content'], 'format' => 'WXR XML', 'url' => html_entity_decode(wp_nonce_url(add_query_arg(array('action' => 'fwmcp_export', 'content' => $request['content']), admin_url('admin-post.php')), 'fwmcp_export'), ENT_QUOTES, 'UTF-8'));
        }));
});
add_action('admin_post_fwmcp_export', function () {
    if (!current_user_can('export')) { wp_die('Permiso de exportación necesario.', '', array('response' => 403)); }
    check_admin_referer('fwmcp_export');
    $content = isset($_GET['content']) ? sanitize_key(wp_unslash($_GET['content'])) : 'all';
    if (!in_array($content, array('all', 'post', 'page', 'attachment'), true)) { wp_die('Tipo no admitido.', '', array('response' => 400)); }
    require_once ABSPATH . 'wp-admin/includes/export.php'; export_wp(array('content' => $content)); exit;
});
