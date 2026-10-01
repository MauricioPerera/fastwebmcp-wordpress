<?php
if (!defined('ABSPATH')) { exit; }
function fwmcp_core_request($method, $route, $params = array()) {
    $request = new WP_REST_Request($method, '/wp/v2/' . $route);
    foreach ($params as $key => $value) { $request->set_param($key, $value); }
    return rest_do_request($request);
}
function fwmcp_comment_state($id) {
    $response = fwmcp_core_request('GET', 'comments/' . $id, array('context' => 'edit'));
    if ($response->get_status() !== 200) { return $response; }
    $item = $response->get_data();
    $values = array('id' => $item['id'], 'post' => $item['post'], 'parent' => $item['parent'], 'author' => $item['author_name'], 'status' => $item['status'], 'content' => $item['content']['raw']);
    return array('values' => $values, 'revision' => hash('sha256', wp_json_encode($values)));
}
function fwmcp_entity_state($kind, $id) {
    $response = fwmcp_core_request('GET', $kind . '/' . $id, array('context' => 'edit'));
    if ($response->get_status() !== 200) { return $response; }
    $item = $response->get_data();
    if ($kind === 'blocks' && ($item['wp_pattern_sync_status'] ?? '') === 'unsynced') { return new WP_Error('unsynced_pattern', 'Este patrón no está sincronizado.', array('status' => 400)); }
    $values = array('id' => $item['id'], 'title' => $item['title']['raw'], 'content' => $item['content']['raw'], 'status' => $item['status'], 'modified' => $item['modified_gmt']);
    return array('values' => $values, 'revision' => hash('sha256', wp_json_encode($values)));
}
function fwmcp_navigation_tree($nodes, $depth = 0, &$count = 0) {
    if (!is_array($nodes) || $depth > 3) { return new WP_Error('invalid_navigation', 'Máximo cuatro niveles de navegación.', array('status' => 400)); }
    $blocks = array();
    foreach ($nodes as $node) {
        $count++; if ($count > 50 || !is_array($node) || array_diff(array_keys($node), array('label','url','children')) || !isset($node['label'], $node['url']) || !is_string($node['label']) || !is_string($node['url']) || trim($node['label']) === '' || strlen($node['label']) > 400 || strlen($node['url']) > 2000) { return new WP_Error('invalid_navigation', 'Enlace inválido o más de 50 elementos.', array('status' => 400)); }
        $url = esc_url_raw($node['url'], array('http','https'));
        if (!$url || !preg_match('#^https?://#i', $url)) { return new WP_Error('invalid_navigation', 'Usa enlaces HTTP o HTTPS absolutos.', array('status' => 400)); }
        $children = isset($node['children']) ? fwmcp_navigation_tree($node['children'], $depth + 1, $count) : array(); if (is_wp_error($children)) { return $children; }
        $blocks[] = array('blockName' => $children ? 'core/navigation-submenu' : 'core/navigation-link', 'attrs' => array('label' => wp_strip_all_tags($node['label']), 'url' => $url, 'kind' => 'custom'), 'innerBlocks' => $children, 'innerHTML' => '', 'innerContent' => array_fill(0, count($children), null));
    }
    return $blocks;
}
function fwmcp_style_state() {
    $item = WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles(wp_get_theme(), false);
    $data = isset($item['post_content']) ? json_decode($item['post_content'], true) : array();
    $values = array('theme' => get_stylesheet(), 'id' => $item['ID'] ?? 0, 'styles' => $data['styles'] ?? array());
    return array('values' => $values, 'revision' => hash('sha256', wp_json_encode($values)));
}
add_action('rest_api_init', function () {
    $moderate = function () { return current_user_can('moderate_comments'); };
    register_rest_route('fastwebmcp/v1', '/comments', array('methods' => 'GET', 'permission_callback' => $moderate,
        'args' => array('status' => array('type' => 'string','enum' => array('hold','approve','spam'),'required' => true), 'page' => array('type' => 'integer','minimum' => 1,'default' => 1)),
        'callback' => function ($request) {
            $response = fwmcp_core_request('GET', 'comments', array('context' => 'edit', 'status' => $request['status'], 'page' => $request['page'], 'per_page' => 20));
            if ($response->get_status() !== 200) { return $response; }
            return array('results' => array_map(function ($item) { return array('id' => $item['id'], 'post' => $item['post'], 'author' => $item['author_name'], 'status' => $item['status'], 'content' => $item['content']['raw']); }, $response->get_data()));
        }));
    register_rest_route('fastwebmcp/v1', '/comment-state/(?P<id>\d+)', array('methods' => 'GET', 'permission_callback' => $moderate, 'callback' => function ($request) { return fwmcp_comment_state($request['id']); }));
    register_rest_route('fastwebmcp/v1', '/comment-commit/(?P<id>\d+)', array('methods' => 'POST', 'permission_callback' => $moderate,
        'args' => array('expectedRevision' => array('type' => 'string','required' => true), 'action' => array('type' => 'string','enum' => array('approve','hold','spam','reply'),'required' => true), 'content' => array('type' => 'string','maxLength' => 5000)),
        'callback' => function ($request) {
            $state = fwmcp_comment_state($request['id']); if (!is_array($state)) { return $state; }
            if (!hash_equals($state['revision'], $request['expectedRevision'])) { return new WP_Error('stale_comment', 'El comentario cambió.', array('status' => 409)); }
            if (!current_user_can('edit_comment', $request['id'])) { return new WP_Error('forbidden', 'Permiso para este comentario necesario.', array('status' => 403)); }
            if ($request['action'] === 'reply') {
                $content = trim((string) $request['content']); if ($content === '') { return new WP_Error('empty_reply','Respuesta vacía.',array('status'=>400)); }
                $response = fwmcp_core_request('POST', 'comments', array('post' => $state['values']['post'], 'parent' => (int) $request['id'], 'content' => esc_html($content), 'author' => get_current_user_id(), 'status' => 'approved'));
                if ($response->get_status() >= 400) { return $response; } return fwmcp_comment_state($response->get_data()['id']);
            }
            $response = fwmcp_core_request('POST','comments/'.$request['id'],array('status'=>$request['action'])); if ($response->get_status()>=400) { return $response; } return fwmcp_comment_state($request['id']);
        }));
    register_rest_route('fastwebmcp/v1', '/entity-state/(?P<kind>navigation|blocks)/(?P<id>\d+)', array('methods' => 'GET', 'permission_callback' => function ($request) { return $request['kind'] === 'navigation' ? current_user_can('edit_theme_options') : current_user_can('edit_posts'); }, 'callback' => function ($request) { return fwmcp_entity_state($request['kind'],$request['id']); }));
    register_rest_route('fastwebmcp/v1', '/entity-commit/(?P<kind>navigation|blocks)/(?P<id>\d+)', array('methods' => 'POST', 'permission_callback' => function ($request) { return $request['kind'] === 'navigation' ? current_user_can('edit_theme_options') : current_user_can('edit_posts'); },
        'args'=>array('expectedRevision'=>array('type'=>'string','required'=>true),'title'=>array('type'=>'string','required'=>true,'minLength'=>1,'maxLength'=>200),'content'=>array('type'=>'string','maxLength'=>50000),'links'=>array('type'=>'array')),
        'callback'=>function($request) {
            $state=fwmcp_entity_state($request['kind'],$request['id']); if (!is_array($state)) { return $state; }
            if (!hash_equals($state['revision'],$request['expectedRevision'])) { return new WP_Error('stale_entity','La entidad cambió.',array('status'=>409)); }
            if ($request['kind']==='navigation') { $count=0;$blocks=fwmcp_navigation_tree($request['links'],0,$count);if(is_wp_error($blocks)){return $blocks;}$content=serialize_blocks($blocks); }
            else { if (!isset($request['content'])) { return new WP_Error('invalid_content','Contenido necesario.',array('status'=>400)); } $content=$request['content']; }
            $response=fwmcp_core_request('POST',$request['kind'].'/'.$request['id'],array('title'=>$request['title'],'content'=>$content));if($response->get_status()>=400){return $response;}return fwmcp_entity_state($request['kind'],$request['id']);
        }));
    register_rest_route('fastwebmcp/v1','/style-state',array('methods'=>'GET','permission_callback'=>function(){return current_user_can('edit_theme_options');},'callback'=>'fwmcp_style_state'));
    register_rest_route('fastwebmcp/v1','/style-commit',array('methods'=>'POST','permission_callback'=>function(){return current_user_can('edit_theme_options');},
        'args'=>array('expectedRevision'=>array('type'=>'string','required'=>true),'changes'=>array('type'=>'object','required'=>true)),
        'callback'=>function($request){
            $state=fwmcp_style_state();if(!hash_equals($state['revision'],$request['expectedRevision'])){return new WP_Error('stale_styles','Los estilos o el tema cambiaron.',array('status'=>409));}
            $changes=$request['changes'];if(!$changes||array_diff(array_keys($changes),array('text','background','fontFamily','fontSize'))){return new WP_Error('invalid_styles','Estilos no admitidos.',array('status'=>400));}
            $styles=$state['values']['styles'];
            foreach($changes as $key=>$value){
                if ($value === null) { $section = in_array($key,array('text','background'),true) ? 'color' : 'typography'; unset($styles[$section][$key]); if (empty($styles[$section])) { unset($styles[$section]); } continue; }
                if(in_array($key,array('text','background'),true)){if(!is_string($value)||!preg_match('/^#[0-9a-fA-F]{6}$/',$value)){return new WP_Error('invalid_color','Color hexadecimal inválido.',array('status'=>400));}$styles['color'][$key]=$value;}
                elseif($key==='fontFamily'){if(!in_array($value,array('system-ui','serif','sans-serif'),true)){return new WP_Error('invalid_font','Familia no admitida.',array('status'=>400));}$styles['typography']['fontFamily']=$value;}
                else{if(!is_int($value)||$value<10||$value>72){return new WP_Error('invalid_size','Tamaño 10–72 px.',array('status'=>400));}$styles['typography']['fontSize']=$value.'px';}
            }
            $id=WP_Theme_JSON_Resolver::get_user_global_styles_post_id();$response=fwmcp_core_request('POST','global-styles/'.$id,array('styles'=>$styles));if($response->get_status()>=400){return $response;}WP_Theme_JSON_Resolver::clean_cached_data();return fwmcp_style_state();
        }));
});
