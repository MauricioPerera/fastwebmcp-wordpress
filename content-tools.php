<?php
if (!defined('ABSPATH')) { exit; }
function fwmcp_post_state($id) {
    $post = get_post($id);
    if (!$post || !in_array($post->post_type, array('post', 'page'), true)) { return new WP_Error('not_found', 'Entrada o página no encontrada.', array('status' => 404)); }
    if (!current_user_can('edit_post', $id)) { return new WP_Error('forbidden', 'Permiso de edición necesario.', array('status' => is_user_logged_in() ? 403 : 401)); }
    $request = new WP_REST_Request('GET', '/wp/v2/' . ($post->post_type === 'post' ? 'posts' : 'pages') . '/' . $id);
    $request->set_param('context', 'edit'); $response = rest_do_request($request);
    if ($response->get_status() !== 200) { return new WP_Error('post_read_failed', 'WordPress rechazó la lectura.', array('status' => $response->get_status())); }
    $data = $response->get_data(); $values = array();
    foreach (array('id', 'type', 'status', 'slug', 'date_gmt', 'modified_gmt', 'featured_media', 'categories', 'tags', 'link') as $field) { if (isset($data[$field])) { $values[$field] = $data[$field]; } }
    foreach (array('title', 'content', 'excerpt') as $field) { $values[$field] = $data[$field]['raw']; }
    return array('values' => $values, 'revision' => hash('sha256', wp_json_encode($values)));
}
add_action('rest_api_init', function () {
    $permission = function ($request) { return current_user_can('edit_post', (int) $request['id']); };
    register_rest_route('fastwebmcp/v1', '/post-state/(?P<id>\d+)', array('methods' => 'GET', 'permission_callback' => $permission,
        'callback' => function ($request) { return fwmcp_post_state((int) $request['id']); }));
    register_rest_route('fastwebmcp/v1', '/post-commit/(?P<id>\d+)', array('methods' => 'POST', 'permission_callback' => $permission,
        'args' => array('expectedRevision' => array('type' => 'string', 'required' => true), 'changes' => array('type' => 'object', 'required' => true)),
        'callback' => function ($request) {
            $state = fwmcp_post_state((int) $request['id']); if (is_wp_error($state)) { return $state; }
            if (!hash_equals($state['revision'], $request['expectedRevision'])) { return new WP_Error('stale_post', 'El documento cambió. Lee su revisión actual.', array('status' => 409)); }
            $changes = $request['changes']; $allowed = array('title', 'content', 'excerpt', 'slug', 'featured_media', 'categories', 'tags', 'status', 'date_gmt');
            if (!$changes || array_diff(array_keys($changes), $allowed)) { return new WP_Error('invalid_changes', 'Campos no admitidos o cambios vacíos.', array('status' => 400)); }
            if (isset($changes['status']) && !in_array($changes['status'], array('draft', 'publish', 'future'), true)) { return new WP_Error('invalid_status', 'Estado no admitido.', array('status' => 400)); }
            if (isset($changes['title']) && (!is_string($changes['title']) || trim($changes['title']) === '')) { return new WP_Error('invalid_title', 'Título vacío.', array('status' => 400)); }
            if ($state['values']['type'] === 'page' && (isset($changes['categories']) || isset($changes['tags']))) { return new WP_Error('invalid_taxonomy', 'Las páginas no admiten categorías ni etiquetas.', array('status' => 400)); }
            foreach (array('categories' => 'category', 'tags' => 'post_tag') as $field => $taxonomy) {
                if (!isset($changes[$field])) { continue; }
                $tax = get_taxonomy($taxonomy);
                if (!current_user_can($tax->cap->assign_terms)) { return new WP_Error('forbidden_taxonomy', 'Permiso para asignar términos necesario.', array('status' => 403)); }
                if (!is_array($changes[$field])) { return new WP_Error('invalid_terms', 'Lista de términos inválida.', array('status' => 400)); }
                foreach ($changes[$field] as $term_id) {
                    if (!is_int($term_id) || $term_id <= 0 || !term_exists($term_id, $taxonomy)) { return new WP_Error('invalid_terms', 'Término no encontrado.', array('status' => 400)); }
                }
            }
            if (isset($changes['featured_media']) && (!is_int($changes['featured_media']) || $changes['featured_media'] < 0 || ($changes['featured_media'] > 0 && !wp_attachment_is_image($changes['featured_media'])))) { return new WP_Error('invalid_media', 'Imagen destacada inválida.', array('status' => 400)); }
            require_once ABSPATH . 'wp-admin/includes/post.php';
            if (wp_check_post_lock((int) $request['id'])) { return new WP_Error('post_locked', 'Otro usuario tiene abierto el documento.', array('status' => 409)); }
            if (isset($changes['date_gmt']) || (isset($changes['status']) && $changes['status'] === 'future')) {
                $date = $changes['date_gmt'] ?? null;
                if (($changes['status'] ?? '') !== 'future' || !is_string($date) || !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/', $date)) { return new WP_Error('invalid_schedule', 'Programa con fecha UTC y estado future.', array('status' => 400)); }
                $parsed = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s', $date, new DateTimeZone('UTC'));
                if (!$parsed || $parsed->format('Y-m-d\TH:i:s') !== $date || $parsed->getTimestamp() <= time() + 60) { return new WP_Error('invalid_schedule', 'Fecha UTC inválida o demasiado próxima.', array('status' => 400)); }
            }
            $route = '/wp/v2/' . ($state['values']['type'] === 'post' ? 'posts' : 'pages') . '/' . $request['id'];
            $update = new WP_REST_Request('POST', $route); foreach ($changes as $key => $value) { $update->set_param($key, $value); }
            $response = rest_do_request($update); if ($response->get_status() >= 400) { return $response; }
            return fwmcp_post_state((int) $request['id']);
        }));
    register_rest_route('fastwebmcp/v1', '/post-preview/(?P<id>\d+)', array('methods' => 'GET', 'permission_callback' => $permission,
        'callback' => function ($request) {
            $state = fwmcp_post_state((int) $request['id']); if (is_wp_error($state)) { return $state; }
            return array('id' => (int) $request['id'], 'url' => get_preview_post_link((int) $request['id']), 'note' => 'Vista previa de la versión guardada; no incluye cambios pendientes del editor.');
        }));
});
