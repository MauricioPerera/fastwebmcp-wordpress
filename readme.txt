=== FastWebMCP for WordPress ===
Contributors: mauricioperera
Tags: webmcp, agents, drafts, rest-api
Requires at least: 6.5
Tested up to: 7.1
Requires PHP: 8.0
Stable tag: 0.6.0
License: MIT

Visible WebMCP tools for content, revisions, navigation, comments and administration.

== Description ==

Version 0.6.0 adds a shared frontend runtime, JavaScript/PHP extension APIs,
per-instance native search and content-filter blocks, cancellation and manual
fallbacks. Administrative bundles stay in their admin screens by default.

Five public tools read site metadata and published content, prepare the visible
search form and submit it to WordPress search results. Three additional
tools become available to logged-in users with edit_posts permissions: list,
prepare and save drafts. Calls update the visible panel and activity log.
Draft creation uses WordPress cookie authentication, REST nonces, server-side
capability checks and sanitized post content. It always creates draft posts.
Publication and scheduling use a visible prepare/apply flow. No delete tool is registered. Browser support for native WebMCP is
required for agent use; the draft form remains usable manually.

== Installation ==

Upload fastwebmcp-wordpress.zip under Plugins > Add Plugin > Upload Plugin.
Activate the plugin. Use the FastWebMCP admin menu and the tools in their
WordPress admin screens. Native search blocks and Content Filters expose
frontend tools per instance. The frontend debug panel is optional and requires
manage_options. See FRONTEND.md to extend themes and custom blocks.

== Tools ==

wp_site_info, wp_search_content, wp_read_content, wp_list_drafts,
wp_prepare_draft, wp_save_draft, wp_prepare_search, wp_submit_search.
Editors also get wp_open_editor. Theme managers get wp_list_templates,
wp_create_template and wp_open_template. In Gutenberg, wp_editor_state,
wp_insert_block, wp_update_block, wp_move_block, wp_remove_block,
wp_editor_title and wp_save_editor manage the visible document.
Users with upload_files also get wp_open_media_library, wp_list_media,
wp_get_media, wp_update_media, wp_selected_media_file and
wp_upload_selected_media. Gutenberg additionally gets wp_insert_media_image.

== Settings and Tools ==

Seven additional tools navigate administration sections, read/prepare/save ten
allowlisted settings, summarize the site, run three local Site Health checks,
and prepare a capability/nonce-protected WXR export link. Settings require
manage_options; diagnostics require view_site_health_checks; export requires
export. A server revision check precedes writes but is not an atomic transaction.
WXR contains content and media references, not media binaries or a full backup.
Opening other settings sections or Import does not modify them or run imports.

== Content workflows and administration ==

Version 0.5.0 adds 37 tools for posts/pages, publication and UTC scheduling,
revisions, block navigation menus, comment moderation/replies, synchronized
patterns, pattern insertion, global colors/fonts, content audits and read-only
user/plugin/theme/update inventory. Mutations show a preparation before applying.
WordPress enforces capabilities; optimistic revisions are checked on the server.
Saved-document management is separate from unsaved Gutenberg edits. Menu support
is for block navigation. Update information uses WordPress cached checks. Link
checks cover up to ten public same-origin URLs; external destinations are skipped.

== Changelog ==

= 0.6.0 =
Extensible frontend runtime for themes and custom blocks. Per-instance search and
content filters, server schema/permission validation and AbortSignal cleanup.
Manual functionality preserved when native WebMCP is unavailable.

= 0.5.0 =
37 new tools, validated through real visible WebMCP calls on local fixtures.
84 permission/validation checks and two final persistence/restoration checks.
Pattern insertion uses native Gutenberg APIs and preserves synchronized references.


= 0.4.0 =
Settings and Tools support, visible native-field preparation, consumed saves,
revision validation, partial local diagnostics and protected WXR download.
Verified using native WebMCP in the linked browser and 21 server checks.


= 0.3.0 =
Media library tools for search, details, plain-text metadata updates and selected
file upload. Visible previews and upload input on the panel, native library and
Gutenberg. Image insertion uses attachment IDs and current editor revisions.
WordPress validates upload types, limits and attachment edit permissions.

= 0.2.0 =
Visible Gutenberg and Site Editor tools using official WordPress data stores.
Revision guards, editor locks, plain text block attributes and draft-only post
saving. Template and template-part access follows WordPress theme permissions.
Fallback to the original canvas HTML via srcdoc when an embedded browser leaves
the WordPress blob iframe blank. Nine permission/persistence checks passed.

= 0.1.1 =
Visible search form and two native WebMCP tools. Empty queries and stale revisions
are rejected. Submission navigates to normal WordPress results; rediscover tools
after navigation. Verified in the linked browser with two matching results.

= 0.1.0 =
Initial local demo verified with native WebMCP, WordPress 7.1.2, PHP 8.3.30
and SQLite Database Integration 3.0.2. Not submitted to WordPress.org.
