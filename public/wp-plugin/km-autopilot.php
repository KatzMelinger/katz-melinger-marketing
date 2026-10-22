<?php
/**
 * Plugin Name:       KM AutoPilot
 * Plugin URI:        https://katzmelinger.com
 * Description:       Pulls approved on-page SEO fixes (meta titles, descriptions, canonicals, OG tags, JSON-LD) AND approved long-form content from the marketing dashboard and applies them. On-page fixes only touch Yoast/RankMath fields or post meta; content publishing (opt-in) creates new posts OR updates an existing page in place (Redraft) from approved, compliance-cleared drafts.
 * Version:           0.7.1
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Katz Melinger
 * License:           Proprietary
 * Text Domain:       km-autopilot
 *
 * Companion to the dashboard's /api/wp/recommendations + /api/wp/applied (on-page
 * fixes) and /api/wp/content + /api/wp/content/applied (long-form posts).
 * Settings → KM AutoPilot to configure base URL + token. Sync runs on WP-Cron every 15 minutes.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('KM_AUTOPILOT_VERSION', '0.7.1');
define('KM_AUTOPILOT_OPTION', 'km_autopilot_settings');
define('KM_AUTOPILOT_LOG_OPTION', 'km_autopilot_log');
define('KM_AUTOPILOT_CRON_HOOK', 'km_autopilot_sync_cron');

// -----------------------------------------------------------------------------
// Activation / deactivation
// -----------------------------------------------------------------------------

register_activation_hook(__FILE__, function () {
    if (!wp_next_scheduled(KM_AUTOPILOT_CRON_HOOK)) {
        wp_schedule_event(time() + 60, 'km_autopilot_15min', KM_AUTOPILOT_CRON_HOOK);
    }
});

register_deactivation_hook(__FILE__, function () {
    $ts = wp_next_scheduled(KM_AUTOPILOT_CRON_HOOK);
    if ($ts) {
        wp_unschedule_event($ts, KM_AUTOPILOT_CRON_HOOK);
    }
});

add_filter('cron_schedules', function ($schedules) {
    $schedules['km_autopilot_15min'] = [
        'interval' => 15 * MINUTE_IN_SECONDS,
        'display'  => __('Every 15 minutes (KM AutoPilot)', 'km-autopilot'),
    ];
    return $schedules;
});

// -----------------------------------------------------------------------------
// Settings helpers
// -----------------------------------------------------------------------------

function km_autopilot_get_settings() {
    $defaults = [
        'base_url'        => '',
        'token'           => '',
        'enabled'         => false,
        // Long-form content publishing is opt-in and separate from on-page fixes.
        'content_enabled' => false,
        // 'publish' = post goes live on confirm; 'draft' = created as a WP draft
        // for a human to publish in WP (the dashboard still marks it handed-off).
        'content_status'  => 'draft',
        // E-E-A-T: optional "reviewed by" attorney, added as reviewedBy on
        // Yoast's Article schema (YMYL trust signal). Opt-in — a blank name
        // means the schema filter does nothing.
        'reviewer_name'   => '',
        'reviewer_title'  => '',
        'reviewer_url'    => '',
    ];
    return wp_parse_args(get_option(KM_AUTOPILOT_OPTION, []), $defaults);
}

function km_autopilot_log_event($message, $context = []) {
    $log = get_option(KM_AUTOPILOT_LOG_OPTION, []);
    if (!is_array($log)) {
        $log = [];
    }
    array_unshift($log, [
        'time'    => current_time('mysql'),
        'message' => $message,
        'context' => $context,
    ]);
    $log = array_slice($log, 0, 200);
    update_option(KM_AUTOPILOT_LOG_OPTION, $log, false);
}

// -----------------------------------------------------------------------------
// HTTP — fetch queue + confirm applied
// -----------------------------------------------------------------------------

function km_autopilot_http_request($method, $path, $body = null) {
    $settings = km_autopilot_get_settings();
    if (empty($settings['base_url']) || empty($settings['token'])) {
        return new WP_Error('km_autopilot_unconfigured', 'KM AutoPilot is not configured.');
    }
    $url  = rtrim($settings['base_url'], '/') . $path;
    $args = [
        'method'  => $method,
        'timeout' => 30,
        'headers' => [
            'X-KM-AutoPilot-Token' => $settings['token'],
            'X-KM-AutoPilot-Version' => KM_AUTOPILOT_VERSION,
            'Content-Type'         => 'application/json',
            'Accept'               => 'application/json',
        ],
    ];
    if ($body !== null) {
        $args['body'] = wp_json_encode($body);
    }
    $resp = wp_remote_request($url, $args);
    if (is_wp_error($resp)) {
        return $resp;
    }
    $code = wp_remote_retrieve_response_code($resp);
    $raw  = wp_remote_retrieve_body($resp);
    $json = json_decode($raw, true);
    if ($code >= 400) {
        return new WP_Error(
            'km_autopilot_http_' . $code,
            isset($json['error']) ? $json['error'] : ('HTTP ' . $code),
            $json
        );
    }
    return $json;
}

// -----------------------------------------------------------------------------
// Locate WP post by URL
// -----------------------------------------------------------------------------

function km_autopilot_post_id_for_url($page_url) {
    $page_id = url_to_postid($page_url);
    if ($page_id) {
        return $page_id;
    }
    // Try without trailing slash / query.
    $parts = wp_parse_url($page_url);
    if (!empty($parts['path'])) {
        $rebuilt = home_url($parts['path']);
        $page_id = url_to_postid($rebuilt);
        if ($page_id) {
            return $page_id;
        }
    }
    return 0;
}

// -----------------------------------------------------------------------------
// Apply handlers — one per fix_type. Returns [applied_value, metadata] on
// success or WP_Error on failure / skip.
// -----------------------------------------------------------------------------

function km_autopilot_apply_meta_field($post_id, $value, $yoast_key, $rankmath_key) {
    // Try Yoast first.
    if (defined('WPSEO_VERSION')) {
        update_post_meta($post_id, $yoast_key, $value);
        return [$value, ['handler' => 'yoast', 'key' => $yoast_key]];
    }
    // Then RankMath.
    if (defined('RANK_MATH_VERSION') || class_exists('RankMath')) {
        update_post_meta($post_id, $rankmath_key, $value);
        return [$value, ['handler' => 'rankmath', 'key' => $rankmath_key]];
    }
    // Fall back to a neutral key — useful even without an SEO plugin.
    $fallback_key = '_km_autopilot_' . trim($yoast_key, '_');
    update_post_meta($post_id, $fallback_key, $value);
    return [$value, ['handler' => 'fallback', 'key' => $fallback_key]];
}

/**
 * Sideload an auto-generated featured image and attach it to $post_id, if the
 * post doesn't already have one. Never fatal — a failure just means no
 * featured image this round; logged and swallowed by the caller.
 */
function km_autopilot_set_featured_image($post_id, $image_url, $alt = '', $name = '') {
    if (empty($image_url) || has_post_thumbnail($post_id)) {
        return;
    }
    require_once ABSPATH . 'wp-admin/includes/media.php';
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/image.php';

    $attachment_id = media_sideload_image($image_url, $post_id, null, 'id');
    if (is_wp_error($attachment_id)) {
        km_autopilot_log_event(
            'Featured image download failed for post ' . $post_id . ': ' . $attachment_id->get_error_message(),
            ['wp_post_id' => $post_id, 'image_url' => $image_url]
        );
        return;
    }
    set_post_thumbnail($post_id, $attachment_id);
    // Oct 20 spec, Task A12: descriptive alt text and file title.
    if ($alt !== '') {
        update_post_meta($attachment_id, '_wp_attachment_image_alt', sanitize_text_field($alt));
    }
    if ($name !== '') {
        wp_update_post(['ID' => $attachment_id, 'post_title' => sanitize_text_field($name), 'post_name' => sanitize_title($name)]);
    }
}

function km_autopilot_apply_one($rec) {
    $page_url = isset($rec['page_url']) ? $rec['page_url'] : '';
    $fix_type = isset($rec['fix_type']) ? $rec['fix_type'] : '';
    $value    = isset($rec['suggested_value']) ? $rec['suggested_value'] : '';

    $post_id = km_autopilot_post_id_for_url($page_url);
    if (!$post_id) {
        return new WP_Error('km_autopilot_no_post', 'Could not resolve a post for URL: ' . $page_url);
    }

    switch ($fix_type) {
        case 'meta_title':
            return km_autopilot_apply_meta_field(
                $post_id, $value, '_yoast_wpseo_title', 'rank_math_title'
            );
        case 'meta_description':
            return km_autopilot_apply_meta_field(
                $post_id, $value, '_yoast_wpseo_metadesc', 'rank_math_description'
            );
        case 'canonical':
            return km_autopilot_apply_meta_field(
                $post_id, $value, '_yoast_wpseo_canonical', 'rank_math_canonical_url'
            );
        case 'og_title':
            return km_autopilot_apply_meta_field(
                $post_id, $value, '_yoast_wpseo_opengraph-title', 'rank_math_facebook_title'
            );
        case 'og_description':
            return km_autopilot_apply_meta_field(
                $post_id, $value, '_yoast_wpseo_opengraph-description', 'rank_math_facebook_description'
            );
        case 'schema_jsonld':
            // Schema is risky to overwrite Yoast/RankMath defaults. We store
            // it as a custom meta key and inject via wp_head — see below.
            update_post_meta($post_id, '_km_autopilot_schema_jsonld', $value);
            return [$value, ['handler' => 'km_inject_schema']];
        case 'h1':
        case 'internal_link_insert':
        case 'alt_text':
            // These would mutate post content / attachments. v1 logs and skips
            // so a marketer can apply manually — we'll come back for them.
            return new WP_Error(
                'km_autopilot_skip_risky',
                'Fix type "' . $fix_type . '" is not yet auto-applied in this plugin version.'
            );
        default:
            return new WP_Error('km_autopilot_unknown_fix', 'Unknown fix_type: ' . $fix_type);
    }
}

// Inject schema JSON-LD stored by AutoPilot into the head when present.
add_action('wp_head', function () {
    if (!is_singular()) {
        return;
    }
    $post_id = get_queried_object_id();
    if (!$post_id) {
        return;
    }
    $schema = get_post_meta($post_id, '_km_autopilot_schema_jsonld', true);
    if (!$schema) {
        return;
    }
    echo "\n<!-- KM AutoPilot schema -->\n";
    echo '<script type="application/ld+json">' . wp_kses_post($schema) . '</script>' . "\n";
}, 99);

// E-E-A-T: add a "reviewed by" attorney to Yoast's Article schema. Yoast owns
// the Article node, so we augment it IN PLACE via its filter rather than
// emitting a competing script (which would duplicate). Opt-in — does nothing
// unless a reviewer name is configured in settings, and no-ops when Yoast is
// not installed (the filter simply never fires).
add_filter('wpseo_schema_article', function ($data) {
    if (!is_array($data)) {
        return $data;
    }
    // Oct 20 spec, Task A2: the attorney who reviewed THIS page first.
    $post_id = get_queried_object_id();
    $page = $post_id ? json_decode(get_post_meta($post_id, '_km_reviewed_by', true), true) : null;
    if (is_array($page) && !empty($page['name'])) {
        $reviewer = ['@type' => 'Person', 'name' => $page['name']];
        if (!empty($page['url'])) {
            $reviewer['url'] = $page['url'];
        }
        $data['reviewedBy'] = $reviewer;
        return $data;
    }
    $settings = km_autopilot_get_settings();
    $name = isset($settings['reviewer_name']) ? trim($settings['reviewer_name']) : '';
    if ($name === '') {
        return $data;
    }
    $reviewer = ['@type' => 'Person', 'name' => $name];
    if (!empty($settings['reviewer_title'])) {
        $reviewer['jobTitle'] = $settings['reviewer_title'];
    }
    if (!empty($settings['reviewer_url'])) {
        $reviewer['url'] = $settings['reviewer_url'];
    }
    $data['reviewedBy'] = $reviewer;
    return $data;
});

// -----------------------------------------------------------------------------
// Failure write-back — tell the dashboard a fix could not be applied so the row
// leaves the approved queue instead of being re-attempted every sync.
// -----------------------------------------------------------------------------

function km_autopilot_report_failure($rec_id, $reason, $status, $wp_post_id = null) {
    $resp = km_autopilot_http_request('POST', '/api/wp/failed', [
        'id'         => $rec_id,
        'reason'     => $reason,
        'status'     => ($status === 'needs_manual') ? 'needs_manual' : 'failed',
        'wp_post_id' => $wp_post_id,
    ]);
    if (is_wp_error($resp)) {
        // Report itself failed — leave the row 'approved' so a later sync retries
        // the report. Logged locally so it's visible in Recent activity.
        km_autopilot_log_event(
            'Could not report failure for ' . $rec_id . ': ' . $resp->get_error_message(),
            ['rec_id' => $rec_id]
        );
        return false;
    }
    return true;
}

// -----------------------------------------------------------------------------
// Sync routine
// -----------------------------------------------------------------------------

function km_autopilot_run_sync() {
    $settings = km_autopilot_get_settings();
    if (empty($settings['enabled'])) {
        return ['skipped' => true, 'reason' => 'disabled'];
    }

    $resp = km_autopilot_http_request('GET', '/api/wp/recommendations?status=approved&limit=50');
    if (is_wp_error($resp)) {
        km_autopilot_log_event('Fetch failed: ' . $resp->get_error_message());
        return ['error' => $resp->get_error_message()];
    }

    $items = isset($resp['items']) && is_array($resp['items']) ? $resp['items'] : [];
    $applied = 0;
    $skipped = 0;
    foreach ($items as $rec) {
        $result = km_autopilot_apply_one($rec);
        if (is_wp_error($result)) {
            $skipped++;
            // 'km_autopilot_skip_risky' = fix_type we can't auto-apply yet, not
            // an error → needs_manual. Anything else is a real failure.
            $is_manual = ($result->get_error_code() === 'km_autopilot_skip_risky');
            $report_status = $is_manual ? 'needs_manual' : 'failed';
            $post_id = km_autopilot_post_id_for_url($rec['page_url']);
            km_autopilot_report_failure(
                $rec['id'],
                $result->get_error_message(),
                $report_status,
                $post_id ?: null
            );
            km_autopilot_log_event(
                ($is_manual ? 'Needs manual ' : 'Failed ') . $rec['id']
                    . ' (' . $rec['fix_type'] . '): ' . $result->get_error_message(),
                ['rec_id' => $rec['id'], 'status' => $report_status]
            );
            continue;
        }
        list($applied_value, $metadata) = $result;
        $post_id = km_autopilot_post_id_for_url($rec['page_url']);
        $confirm = km_autopilot_http_request('POST', '/api/wp/applied', [
            'id'             => $rec['id'],
            'applied_value'  => $applied_value,
            'wp_post_id'     => $post_id,
            'metadata'       => array_merge($metadata, [
                'plugin_version' => KM_AUTOPILOT_VERSION,
                'site_url'       => home_url(),
            ]),
        ]);
        if (is_wp_error($confirm)) {
            km_autopilot_log_event(
                'Applied locally but confirm failed for ' . $rec['id'] . ': ' . $confirm->get_error_message(),
                ['rec_id' => $rec['id']]
            );
            // We intentionally do NOT revert — the local apply succeeded and
            // the next sync will retry the confirm via a separate flow once
            // we add it. For now the dashboard will show the rec as stuck in
            // 'approved' — a marketer can flip it manually.
            continue;
        }
        $applied++;
        km_autopilot_log_event(
            'Applied ' . $rec['fix_type'] . ' to ' . $rec['page_url'],
            ['rec_id' => $rec['id'], 'value' => substr($applied_value, 0, 120)]
        );
    }
    // Long-form content publishing rides on the same cron (opt-in).
    $content = km_autopilot_publish_content();

    return [
        'applied' => $applied,
        'skipped' => $skipped,
        'fetched' => count($items),
        'content' => $content,
    ];
}

// -----------------------------------------------------------------------------
// Long-form content publishing — create posts from approved, queued drafts.
// -----------------------------------------------------------------------------

function km_autopilot_publish_content() {
    $settings = km_autopilot_get_settings();
    if (empty($settings['content_enabled'])) {
        return ['skipped' => true, 'reason' => 'content disabled'];
    }

    $resp = km_autopilot_http_request('GET', '/api/wp/content?status=approved&limit=25');
    if (is_wp_error($resp)) {
        km_autopilot_log_event('Content fetch failed: ' . $resp->get_error_message());
        return ['error' => $resp->get_error_message()];
    }

    $items = isset($resp['items']) && is_array($resp['items']) ? $resp['items'] : [];
    $done   = 0;
    $failed = 0;

    foreach ($items as $item) {
        if (empty($item['id'])) {
            continue;
        }
        $action = isset($item['action']) ? $item['action'] : 'create';
        if ($action === 'go_live') {
            $r = km_autopilot_go_live($item);
        } elseif ($action === 'rollback') {
            $r = km_autopilot_rollback($item);
        } else {
            $r = km_autopilot_save_draft($item);
        }
        if (is_wp_error($r)) {
            $failed++;
            km_autopilot_log_event($action . ' failed for ' . $item['id'] . ': ' . $r->get_error_message(), ['draft_id' => $item['id']]);
        } else {
            $done++;
        }
    }

    return ['done' => $done, 'failed' => $failed, 'fetched' => count($items)];
}

/**
 * Oct 20 spec, Task A12: draft first. A new post is saved as a WordPress
 * draft; an update of a live page keeps the live page untouched and stores
 * the new version as pending, viewable at a token preview link. Either way
 * the dashboard gets a preview link, and "Publish live" is a separate step.
 */
function km_autopilot_save_draft($item) {
    $title   = isset($item['title']) ? wp_strip_all_tags($item['title']) : 'Untitled';
    $content = isset($item['content_html']) ? wp_kses_post($item['content_html']) : '';
    $update_url = !empty($item['update_url']) ? $item['update_url'] : '';

    // Idempotency: the post already made for this draft, if any.
    $existing = get_posts([
        'post_type'   => 'any',
        'post_status' => 'any',
        'numberposts' => 1,
        'fields'      => 'ids',
        'meta_key'    => '_km_autopilot_draft_id',
        'meta_value'  => $item['id'],
    ]);
    $post_id = !empty($existing) ? (int) $existing[0] : 0;

    if ($update_url) {
        // A live page: never change it here. Store the new version as pending.
        if (!$post_id) {
            $post_id = (int) url_to_postid($update_url);
        }
        if (!$post_id) {
            return new WP_Error('km_autopilot_no_post', 'Could not resolve ' . $update_url . ' to a post; nothing was changed.');
        }
        update_post_meta($post_id, '_km_autopilot_draft_id', $item['id']);
        update_post_meta($post_id, '_km_pending_title', $title);
        update_post_meta($post_id, '_km_pending_content', $content);
        update_post_meta($post_id, '_km_pending_item', wp_slash(wp_json_encode($item)));
        $token = wp_generate_password(24, false);
        update_post_meta($post_id, '_km_preview_token', $token);
        $preview = add_query_arg('km_preview', $token, get_permalink($post_id));
        return km_autopilot_confirm($item['id'], $post_id, get_permalink($post_id), 'wp_draft', $preview);
    }

    $postarr = [
        'post_title'   => $title,
        'post_content' => $content,
        'post_status'  => 'draft',
        'post_type'    => 'post',
    ];
    if (!empty($item['slug'])) {
        $postarr['post_name'] = sanitize_title($item['slug']);
    }
    if (!empty($item['meta_description'])) {
        $postarr['post_excerpt'] = sanitize_text_field($item['meta_description']);
    }
    if ($post_id) {
        $postarr['ID'] = $post_id;
        $res = wp_update_post($postarr, true);
    } else {
        $res = wp_insert_post($postarr, true);
    }
    if (is_wp_error($res) || !$res) {
        return is_wp_error($res) ? $res : new WP_Error('km_autopilot_insert', 'Could not save the post.');
    }
    $post_id = (int) $res;
    update_post_meta($post_id, '_km_autopilot_draft_id', $item['id']);
    km_autopilot_apply_item_meta($post_id, $item);
    if (!empty($item['author']['login'])) {
        $user = get_user_by('login', $item['author']['login']);
        if ($user) {
            wp_update_post(['ID' => $post_id, 'post_author' => $user->ID]);
        }
    }
    if (!empty($item['featured_image_url'])) {
        km_autopilot_set_featured_image($post_id, $item['featured_image_url'], isset($item['featured_image_alt']) ? $item['featured_image_alt'] : '', isset($item['featured_image_name']) ? $item['featured_image_name'] : '');
    }
    return km_autopilot_confirm($item['id'], $post_id, get_permalink($post_id), 'wp_draft', get_preview_post_link($post_id));
}

/** SEO fields, schema, reviewer, category, tags and redirects for a post. */
function km_autopilot_apply_item_meta($post_id, $item) {
    if (!empty($item['meta_title'])) {
        km_autopilot_apply_meta_field($post_id, $item['meta_title'], '_yoast_wpseo_title', 'rank_math_title');
    }
    if (!empty($item['meta_description'])) {
        km_autopilot_apply_meta_field($post_id, $item['meta_description'], '_yoast_wpseo_metadesc', 'rank_math_description');
    }
    if (!empty($item['focus_keyphrase'])) {
        km_autopilot_apply_meta_field($post_id, $item['focus_keyphrase'], '_yoast_wpseo_focuskw', 'rank_math_focus_keyword');
    }
    if (!empty($item['schema_jsonld'])) {
        update_post_meta($post_id, '_km_autopilot_schema_jsonld', wp_slash($item['schema_jsonld']));
    }
    if (!empty($item['reviewed_by']['name'])) {
        update_post_meta($post_id, '_km_reviewed_by', wp_slash(wp_json_encode($item['reviewed_by'])));
    }
    if (!empty($item['category'])) {
        $cat = get_cat_ID($item['category']);
        if (!$cat) {
            $cat = wp_create_category($item['category']);
        }
        if ($cat) {
            wp_set_post_categories($post_id, [(int) $cat], false);
        }
    }
    if (!empty($item['tags']) && is_array($item['tags'])) {
        wp_set_post_tags($post_id, array_map('sanitize_text_field', $item['tags']), false);
    }
    // Oct 20 spec, Task A13: English and Spanish versions point at each other (hreflang).
    if (!empty($item['language']) && in_array($item['language'], ['en', 'es'], true)) {
        update_post_meta($post_id, '_km_lang', $item['language']);
        $pair = isset($item['hreflang_pair']) && is_array($item['hreflang_pair']) ? $item['hreflang_pair'] : null;
        if ($pair && !empty($pair['wp_post_id']) && get_post((int) $pair['wp_post_id'])) {
            $pair_id = (int) $pair['wp_post_id'];
            update_post_meta($post_id, '_km_hreflang_pair', $pair_id);
            update_post_meta($pair_id, '_km_hreflang_pair', (int) $post_id);
            if (!empty($pair['language']) && in_array($pair['language'], ['en', 'es'], true)) {
                update_post_meta($pair_id, '_km_lang', $pair['language']);
            }
        }
    }
    if (!empty($item['redirects']) && is_array($item['redirects'])) {
        $map = get_option('km_autopilot_redirects', []);
        foreach ($item['redirects'] as $r) {
            if (!empty($r['from']) && !empty($r['to'])) {
                $from = untrailingslashit(wp_parse_url($r['from'], PHP_URL_PATH) ?: '');
                if ($from) {
                    $map[$from] = esc_url_raw($r['to']);
                }
            }
        }
        update_option('km_autopilot_redirects', $map, false);
    }
}

/** Publish what was saved: the draft post, or the pending version of a live page. */
function km_autopilot_go_live($item) {
    $post_id = isset($item['wp_post_id']) ? (int) $item['wp_post_id'] : 0;
    if (!$post_id || !get_post($post_id)) {
        return new WP_Error('km_autopilot_no_post', 'The WordPress post for this draft no longer exists.');
    }
    $pending = get_post_meta($post_id, '_km_pending_content', true);
    if ($pending !== '') {
        // Keep the live version for a one-click rollback, then swap in the new one.
        $post = get_post($post_id);
        update_post_meta($post_id, '_km_previous_title', wp_slash($post->post_title));
        update_post_meta($post_id, '_km_previous_content', wp_slash($post->post_content));
        $res = wp_update_post([
            'ID'           => $post_id,
            'post_title'   => get_post_meta($post_id, '_km_pending_title', true),
            'post_content' => $pending,
        ], true);
        if (is_wp_error($res)) {
            return $res;
        }
        $saved = json_decode(get_post_meta($post_id, '_km_pending_item', true), true);
        if (is_array($saved)) {
            km_autopilot_apply_item_meta($post_id, $saved);
        }
        delete_post_meta($post_id, '_km_pending_content');
        delete_post_meta($post_id, '_km_pending_title');
        delete_post_meta($post_id, '_km_pending_item');
        delete_post_meta($post_id, '_km_preview_token');
    } else {
        update_post_meta($post_id, '_km_previous_status', 'draft');
        wp_publish_post($post_id);
    }
    return km_autopilot_confirm($item['id'], $post_id, get_permalink($post_id), 'published', null);
}

/** Restore the previous version (an update) or take a new post back to draft. */
function km_autopilot_rollback($item) {
    $post_id = isset($item['wp_post_id']) ? (int) $item['wp_post_id'] : 0;
    if (!$post_id || !get_post($post_id)) {
        return new WP_Error('km_autopilot_no_post', 'The WordPress post for this draft no longer exists.');
    }
    $prev = get_post_meta($post_id, '_km_previous_content', true);
    if ($prev !== '') {
        $res = wp_update_post([
            'ID'           => $post_id,
            'post_title'   => get_post_meta($post_id, '_km_previous_title', true),
            'post_content' => $prev,
        ], true);
        if (is_wp_error($res)) {
            return $res;
        }
        delete_post_meta($post_id, '_km_previous_content');
        delete_post_meta($post_id, '_km_previous_title');
    } else {
        wp_update_post(['ID' => $post_id, 'post_status' => 'draft']);
    }
    return km_autopilot_confirm($item['id'], $post_id, get_permalink($post_id), 'rolled_back', null);
}

function km_autopilot_confirm($draft_id, $post_id, $url, $state, $preview_url) {
    $confirm = km_autopilot_http_request('POST', '/api/wp/content/applied', [
        'id'          => $draft_id,
        'wp_post_id'  => $post_id,
        'url'         => $url,
        'state'       => $state,
        'preview_url' => $preview_url,
    ]);
    if (is_wp_error($confirm)) {
        km_autopilot_log_event('Saved post ' . $post_id . ' (' . $state . ') but the dashboard confirm failed for ' . $draft_id . ': ' . $confirm->get_error_message(), ['draft_id' => $draft_id, 'wp_post_id' => $post_id]);
        return $confirm;
    }
    km_autopilot_log_event('Post ' . $post_id . ' is now ' . $state . ' for draft ' . $draft_id, ['draft_id' => $draft_id, 'wp_post_id' => $post_id]);
    return true;
}

// The pending version of a live page, shown only with its preview token.
add_filter('the_content', function ($content) {
    if (empty($_GET['km_preview']) || !is_singular()) {
        return $content;
    }
    $post_id = get_queried_object_id();
    $token = get_post_meta($post_id, '_km_preview_token', true);
    if ($token && hash_equals($token, sanitize_text_field(wp_unslash($_GET['km_preview'])))) {
        $pending = get_post_meta($post_id, '_km_pending_content', true);
        if ($pending !== '') {
            return $pending;
        }
    }
    return $content;
}, 1);

// A preview must never be indexed.
add_action('wp_head', function () {
    if (!empty($_GET['km_preview'])) {
        echo '<meta name="robots" content="noindex,nofollow">' . "\n";
    }
}, 1);

// 301 redirects for pages a published draft replaces.
add_action('template_redirect', function () {
    $map = get_option('km_autopilot_redirects', []);
    if (empty($map) || !is_array($map)) {
        return;
    }
    $path = untrailingslashit(wp_parse_url(isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '', PHP_URL_PATH) ?: '');
    if ($path && isset($map[$path])) {
        wp_redirect($map[$path], 301);
        exit;
    }
}, 1);

add_action(KM_AUTOPILOT_CRON_HOOK, 'km_autopilot_run_sync');

// -----------------------------------------------------------------------------
// Admin UI
// -----------------------------------------------------------------------------

add_action('admin_menu', function () {
    add_options_page(
        'KM AutoPilot',
        'KM AutoPilot',
        'manage_options',
        'km-autopilot',
        'km_autopilot_render_settings_page'
    );
});

add_action('admin_init', function () {
    register_setting('km_autopilot_group', KM_AUTOPILOT_OPTION, [
        'sanitize_callback' => function ($input) {
            $out = [];
            $out['base_url'] = isset($input['base_url']) ? esc_url_raw(trim($input['base_url'])) : '';
            $out['token']    = isset($input['token']) ? sanitize_text_field(trim($input['token'])) : '';
            $out['enabled']  = !empty($input['enabled']);
            $out['content_enabled'] = !empty($input['content_enabled']);
            $out['content_status']  = (isset($input['content_status']) && $input['content_status'] === 'publish')
                ? 'publish'
                : 'draft';
            $out['reviewer_name']   = isset($input['reviewer_name']) ? sanitize_text_field(trim($input['reviewer_name'])) : '';
            $out['reviewer_title']  = isset($input['reviewer_title']) ? sanitize_text_field(trim($input['reviewer_title'])) : '';
            $out['reviewer_url']    = isset($input['reviewer_url']) ? esc_url_raw(trim($input['reviewer_url'])) : '';
            return $out;
        },
    ]);
});

function km_autopilot_render_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }
    // Handle manual sync.
    if (isset($_POST['km_autopilot_sync_now']) && check_admin_referer('km_autopilot_sync_now')) {
        $result = km_autopilot_run_sync();
        echo '<div class="notice notice-info"><p>Sync result: '
            . esc_html(wp_json_encode($result)) . '</p></div>';
    }
    $settings = km_autopilot_get_settings();
    $log      = get_option(KM_AUTOPILOT_LOG_OPTION, []);
    ?>
    <div class="wrap">
        <h1>KM AutoPilot</h1>
        <p>Pulls approved on-page SEO fixes from the Katz Melinger marketing dashboard and applies them to this site.</p>

        <form method="post" action="options.php">
            <?php settings_fields('km_autopilot_group'); ?>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="km_base_url">Dashboard base URL</label></th>
                    <td>
                        <input type="url" id="km_base_url" name="<?php echo esc_attr(KM_AUTOPILOT_OPTION); ?>[base_url]"
                               value="<?php echo esc_attr($settings['base_url']); ?>"
                               class="regular-text" placeholder="https://marketing.katzmelinger.com" />
                        <p class="description">No trailing slash. The plugin will hit <code>/api/wp/recommendations</code> on this host.</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="km_token">API token</label></th>
                    <td>
                        <input type="password" id="km_token" name="<?php echo esc_attr(KM_AUTOPILOT_OPTION); ?>[token]"
                               value="<?php echo esc_attr($settings['token']); ?>" class="regular-text" autocomplete="off" />
                        <p class="description">Generate one in the marketing dashboard at <code>POST /api/wp/tokens</code>.</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row">Enable auto-sync</th>
                    <td>
                        <label>
                            <input type="checkbox" name="<?php echo esc_attr(KM_AUTOPILOT_OPTION); ?>[enabled]"
                                   value="1" <?php checked($settings['enabled']); ?> />
                            Run every 15 minutes via WP-Cron
                        </label>
                    </td>
                </tr>
                <tr>
                    <th scope="row">Publish long-form content</th>
                    <td>
                        <label>
                            <input type="checkbox" name="<?php echo esc_attr(KM_AUTOPILOT_OPTION); ?>[content_enabled]"
                                   value="1" <?php checked($settings['content_enabled']); ?> />
                            Create posts from approved, compliance-cleared drafts (<code>/api/wp/content</code>)
                        </label>
                        <p class="description">Opt-in. Off by default — on-page fixes run independently of this.</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="km_content_status">New post status</label></th>
                    <td>
                        <select id="km_content_status" name="<?php echo esc_attr(KM_AUTOPILOT_OPTION); ?>[content_status]">
                            <option value="draft" <?php selected($settings['content_status'], 'draft'); ?>>Draft (review in WordPress before going live)</option>
                            <option value="publish" <?php selected($settings['content_status'], 'publish'); ?>>Publish immediately (fully autonomous)</option>
                        </select>
                        <p class="description">The dashboard has already gated each draft on approval + compliance. "Draft" creates the post for a final human publish in WP.</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="km_reviewer_name">Reviewed by (E-E-A-T)</label></th>
                    <td>
                        <input type="text" id="km_reviewer_name" name="<?php echo esc_attr(KM_AUTOPILOT_OPTION); ?>[reviewer_name]"
                               value="<?php echo esc_attr($settings['reviewer_name']); ?>" class="regular-text" placeholder="Jane Attorney, Esq." />
                        <p class="description">Attorney who reviews content. Added as <code>reviewedBy</code> on Yoast's Article schema for YMYL trust. Leave blank to disable.</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="km_reviewer_title">Reviewer title</label></th>
                    <td>
                        <input type="text" id="km_reviewer_title" name="<?php echo esc_attr(KM_AUTOPILOT_OPTION); ?>[reviewer_title]"
                               value="<?php echo esc_attr($settings['reviewer_title']); ?>" class="regular-text" placeholder="Partner, Katz Melinger PLLC" />
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="km_reviewer_url">Reviewer profile URL</label></th>
                    <td>
                        <input type="url" id="km_reviewer_url" name="<?php echo esc_attr(KM_AUTOPILOT_OPTION); ?>[reviewer_url]"
                               value="<?php echo esc_attr($settings['reviewer_url']); ?>" class="regular-text" placeholder="https://katzmelinger.com/attorneys/..." />
                        <p class="description">Optional. The reviewer's bio page.</p>
                    </td>
                </tr>
            </table>
            <?php submit_button('Save settings'); ?>
        </form>

        <hr />

        <h2>Run sync now</h2>
        <form method="post">
            <?php wp_nonce_field('km_autopilot_sync_now'); ?>
            <input type="submit" name="km_autopilot_sync_now" value="Sync now" class="button button-primary" />
        </form>

        <hr />

        <h2>Recent activity</h2>
        <?php if (empty($log)) : ?>
            <p>No sync activity yet.</p>
        <?php else : ?>
            <table class="widefat striped" style="max-width: 100%;">
                <thead><tr><th style="width: 180px;">Time</th><th>Event</th></tr></thead>
                <tbody>
                <?php foreach (array_slice($log, 0, 50) as $entry) : ?>
                    <tr>
                        <td><?php echo esc_html($entry['time']); ?></td>
                        <td><?php echo esc_html($entry['message']); ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        <?php endif; ?>
    </div>
    <?php
}

/**
 * hreflang (Oct 20 spec, Task A13): a page with an English or Spanish version
 * names both, so Google shows each reader the right one.
 */
add_action('wp_head', function () {
    if (!is_singular()) {
        return;
    }
    $id = get_queried_object_id();
    $lang = get_post_meta($id, '_km_lang', true);
    $pair_id = (int) get_post_meta($id, '_km_hreflang_pair', true);
    if (!$lang || !$pair_id || get_post_status($pair_id) !== 'publish') {
        return;
    }
    $pair_lang = get_post_meta($pair_id, '_km_lang', true) ?: ($lang === 'es' ? 'en' : 'es');
    $en = $lang === 'en' ? $id : $pair_id;
    printf("<link rel=\"alternate\" hreflang=\"%s\" href=\"%s\" />\n", esc_attr($lang), esc_url(get_permalink($id)));
    printf("<link rel=\"alternate\" hreflang=\"%s\" href=\"%s\" />\n", esc_attr($pair_lang), esc_url(get_permalink($pair_id)));
    printf("<link rel=\"alternate\" hreflang=\"x-default\" href=\"%s\" />\n", esc_url(get_permalink($en)));
}, 5);
