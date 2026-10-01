<?php
if (!defined('ABSPATH')) { exit; }
add_action('rest_api_init', function () {
    register_rest_route('fastwebmcp/v1','/inventory/users',array('methods'=>'GET','permission_callback'=>function(){return current_user_can('list_users');},
        'args'=>array('page'=>array('type'=>'integer','minimum'=>1,'default'=>1)),
        'callback'=>function($request){
            $users=get_users(array('number'=>20,'offset'=>($request['page']-1)*20,'orderby'=>'ID','order'=>'ASC'));$roles=array();
            foreach(wp_roles()->roles as $slug=>$role){$roles[]=array('slug'=>$slug,'name'=>translate_user_role($role['name']),'capabilities'=>array_keys(array_filter($role['capabilities'])));}
            return array('users'=>array_map(function($user){return array('id'=>$user->ID,'name'=>$user->display_name,'roles'=>$user->roles);},$users),'roles'=>$roles,'page'=>$request['page']);
        }));
    register_rest_route('fastwebmcp/v1','/inventory/plugins',array('methods'=>'GET','permission_callback'=>function(){return current_user_can('activate_plugins');},
        'callback'=>function(){require_once ABSPATH.'wp-admin/includes/plugin.php';$items=array();foreach(get_plugins() as $file=>$plugin){$items[]=array('file'=>$file,'name'=>wp_strip_all_tags($plugin['Name']),'version'=>$plugin['Version'],'active'=>is_plugin_active($file));}return array('results'=>$items,'scope'=>'Plugins normales instalados; no incluye mu-plugins ni drop-ins.');}));
    register_rest_route('fastwebmcp/v1','/inventory/themes',array('methods'=>'GET','permission_callback'=>function(){return current_user_can('switch_themes');},
        'callback'=>function(){$items=array();foreach(wp_get_themes() as $stylesheet=>$theme){$items[]=array('stylesheet'=>$stylesheet,'name'=>wp_strip_all_tags($theme->get('Name')),'version'=>$theme->get('Version'),'active'=>$stylesheet===get_stylesheet());}return array('results'=>$items);}));
    register_rest_route('fastwebmcp/v1','/inventory/updates',array('methods'=>'GET','permission_callback'=>function(){return current_user_can('update_core');},
        'callback'=>function(){
            $result=array('source'=>'Caché de comprobaciones de WordPress; no inicia una comprobación remota ni instala actualizaciones.','core'=>array(),'plugins'=>array(),'themes'=>array(),'lastChecked'=>array());
            foreach(array('core','plugins','themes') as $kind){$cache=get_site_transient('update_'.$kind);$result['lastChecked'][$kind]=is_object($cache)?($cache->last_checked??null):null;
                if($kind==='core'){foreach(($cache->updates??array()) as $offer){if(($offer->response??'')==='upgrade'){$result['core'][]=array('version'=>$offer->current,'locale'=>$offer->locale??'');}}}
                else{foreach(($cache->response??array()) as $id=>$offer){$data=(array)$offer;$result[$kind][]=array('id'=>$id,'newVersion'=>$data['new_version']??'');}}
            }return $result;
        }));
});
