<?php
if (!defined('ABSPATH')) { exit; }
$GLOBALS['fwmcp_frontend_tools'] = array();
/** Register a frontend operation before rest_api_init. Never serialize callbacks. */
function fwmcp_register_frontend_tool($name, $spec) {
    if (!is_string($name) || !preg_match('/^[a-z][a-z0-9_.-]{0,59}$/', $name) || isset($GLOBALS['fwmcp_frontend_tools'][$name])) { throw new InvalidArgumentException('Nombre inválido o duplicado.'); }
    if (!is_array($spec) || empty($spec['description']) || !is_string($spec['description']) || !isset($spec['schema']) || !is_array($spec['schema']) || ($spec['schema']['type'] ?? '') !== 'object' || ($spec['schema']['additionalProperties'] ?? null) !== false || !isset($spec['callback'], $spec['permission_callback']) || !is_callable($spec['callback']) || !is_callable($spec['permission_callback'])) { throw new InvalidArgumentException('Descripción, esquema estricto, callback y permission_callback necesarios.'); }
    if (did_action('rest_api_init')) { throw new LogicException('Registra operaciones antes de rest_api_init.'); }
    $GLOBALS['fwmcp_frontend_tools'][$name] = array_merge(array('public' => false, 'readOnly' => false, 'capability' => ''), $spec);
}
function fwmcp_frontend_permission($spec, $request) {
    if (empty($spec['public']) && !is_user_logged_in()) { return false; }
    if (!empty($spec['capability']) && !current_user_can($spec['capability'])) { return false; }
    return call_user_func($spec['permission_callback'], $request);
}
function fwmcp_frontend_schema_json($schema) {
    if (isset($schema['properties']) && is_array($schema['properties'])) {
        foreach ($schema['properties'] as $key=>$child) { $schema['properties'][$key]=fwmcp_frontend_schema_json($child); }
        $schema['properties']=(object)$schema['properties'];
    }
    if (isset($schema['items']) && is_array($schema['items'])) { $schema['items']=fwmcp_frontend_schema_json($schema['items']); }
    return $schema;
}
add_action('rest_api_init', function () {
    register_rest_route('fastwebmcp/v1', '/frontend-tools', array('methods'=>'GET','permission_callback'=>'__return_true','callback'=>function(){
        nocache_headers(); $tools=array();
        foreach($GLOBALS['fwmcp_frontend_tools'] as $name=>$spec){
            if ((!$spec['public'] && !is_user_logged_in()) || ($spec['capability'] && !current_user_can($spec['capability']))) { continue; }
            $tools[]=array('name'=>$name,'description'=>$spec['description'],'inputSchema'=>fwmcp_frontend_schema_json($spec['schema']),'readOnly'=>(bool)$spec['readOnly']);
        }
        return array('version'=>1,'tools'=>$tools);
    }));
    foreach($GLOBALS['fwmcp_frontend_tools'] as $name=>$spec){
        register_rest_route('fastwebmcp/v1','/frontend-tools/'.$name,array('methods'=>'POST',
            'permission_callback'=>function($request)use($spec){return fwmcp_frontend_permission($spec,$request);},
            'args'=>array('input'=>array('type'=>'object','required'=>true,
                'validate_callback'=>function($value)use($spec){return rest_validate_value_from_schema($value,$spec['schema'],'input');},
                'sanitize_callback'=>function($value)use($spec){return rest_sanitize_value_from_schema($value,$spec['schema']);})),
            'callback'=>function($request)use($spec){return call_user_func($spec['callback'],$request['input'],$request);}));
    }
});
function fwmcp_frontend_session() { nocache_headers(); wp_send_json_success(array('nonce'=>is_user_logged_in()?wp_create_nonce('wp_rest'):'','authenticated'=>is_user_logged_in())); }
add_action('wp_ajax_fwmcp_frontend_session','fwmcp_frontend_session');
add_action('wp_ajax_nopriv_fwmcp_frontend_session','fwmcp_frontend_session');
function fwmcp_enqueue_frontend() {
    wp_enqueue_script('fwmcp-runtime',plugins_url('assets/runtime.js',__FILE__),array(),'0.6.0',true);
    wp_enqueue_script('fwmcp-frontend',plugins_url('assets/frontend.js',__FILE__),array('fwmcp-runtime'),'0.6.0',true);
    wp_localize_script('fwmcp-runtime','FastWebMCPFrontend',array('root'=>rest_url('fastwebmcp/v1/'),'sessionUrl'=>admin_url('admin-ajax.php?action=fwmcp_frontend_session'),'enabled'=>(bool)apply_filters('fwmcp_frontend_enabled',true)));
}
add_filter('render_block_core/search',function($html){
    if(is_admin()){return $html;} fwmcp_enqueue_frontend(); $tags=new WP_HTML_Tag_Processor($html);
    if($tags->next_tag('FORM')){$tags->set_attribute('data-fwmcp-component','search');} return $tags->get_updated_html();
});
add_action('init',function(){
    fwmcp_register_frontend_tool('filter_content',array('description'=>'Find public posts/pages matching query and category. Returns titles and URLs. Excludes drafts and password-protected content.', 'public'=>true,'readOnly'=>true,'permission_callback'=>'__return_true',
        'schema'=>array('type'=>'object','additionalProperties'=>false,'properties'=>array('query'=>array('type'=>'string','maxLength'=>200),'type'=>array('type'=>'string','enum'=>array('post','page')),'category'=>array('type'=>'integer','minimum'=>0),'limit'=>array('type'=>'integer','minimum'=>1,'maximum'=>12)),'required'=>array('query','type','category','limit')),
        'callback'=>'fwmcp_filter_content'));
    wp_register_script('fwmcp-filter-editor',plugins_url('assets/filter-editor.js',__FILE__),array('wp-blocks','wp-element','wp-block-editor','wp-components'),'0.6.0',true);
    register_block_type(__DIR__.'/blocks/content-filter',array('render_callback'=>'fwmcp_render_content_filter'));
});
function fwmcp_filter_content($input) {
    $query=trim($input['query']);$args=array('post_type'=>$input['type'],'post_status'=>'publish','has_password'=>false,'posts_per_page'=>$input['limit'],'s'=>$query);
    if($input['type']==='post' && $input['category']){$args['cat']=$input['category'];}
    $posts=get_posts($args);return array('query'=>$query,'category'=>$input['category'],'type'=>$input['type'],'results'=>array_map(function($post){return array('id'=>$post->ID,'title'=>wp_strip_all_tags(get_the_title($post)),'url'=>get_permalink($post));},$posts));
}
function fwmcp_render_content_filter($attrs) {
    fwmcp_enqueue_frontend();$label=isset($attrs['label'])?sanitize_text_field($attrs['label']):'Explorar contenido';$type=($attrs['type']??'post')==='page'?'page':'post';$limit=max(1,min(12,(int)($attrs['limit']??6)));
    $query=isset($_GET['fwmcp_query'])?substr(sanitize_text_field(wp_unslash($_GET['fwmcp_query'])),0,200):'';$category=isset($_GET['fwmcp_category'])?absint($_GET['fwmcp_category']):0;
    $result=fwmcp_filter_content(array('query'=>$query,'category'=>$category,'type'=>$type,'limit'=>$limit));$id=wp_unique_id('fwmcp-filter-');ob_start(); ?>
    <section <?php echo get_block_wrapper_attributes(array('data-fwmcp-component'=>'filter','data-fwmcp-label'=>$label,'data-fwmcp-type'=>$type,'data-fwmcp-limit'=>(string)$limit)); ?>>
      <h2><?php echo esc_html($label); ?></h2>
      <form method="get" action="<?php echo esc_url(get_permalink()); ?>">
        <?php if (!get_option('permalink_structure')) : ?><input type="hidden" name="<?php echo get_post_type()==='page'?'page_id':'p'; ?>" value="<?php echo (int)get_the_ID(); ?>" /><?php endif; ?>
        <label for="<?php echo esc_attr($id); ?>query">Buscar contenido</label>
        <input id="<?php echo esc_attr($id); ?>query" type="search" name="fwmcp_query" maxlength="200" value="<?php echo esc_attr($query); ?>" />
        <?php if ($type==='post') : ?><label for="<?php echo esc_attr($id); ?>category">Categoría</label><select id="<?php echo esc_attr($id); ?>category" name="fwmcp_category"><option value="0">Todas</option><?php foreach(get_categories(array('hide_empty'=>false,'number'=>30))as$term): ?><option value="<?php echo (int)$term->term_id; ?>" <?php selected($category,$term->term_id); ?>><?php echo esc_html($term->name); ?></option><?php endforeach; ?></select><?php endif; ?>
        <button type="submit">Aplicar filtros</button>
      </form>
      <p data-fwmcp-status role="status"><?php echo count($result['results']); ?> resultados.</p>
      <ol data-fwmcp-results><?php foreach($result['results']as$item): ?><li><a href="<?php echo esc_url($item['url']); ?>"><?php echo esc_html($item['title']); ?></a></li><?php endforeach; ?></ol>
    </section>
    <?php return ob_get_clean();
}
