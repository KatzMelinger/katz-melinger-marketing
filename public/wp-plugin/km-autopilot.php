<?php
/**
 * Plugin Name:       KM AutoPilot
 * Plugin URI:        https://katzmelinger.com
 * Description:       Pulls approved on-page SEO fixes from the Katz Melinger marketing dashboard and applies them — meta titles, descriptions, canonicals, Open Graph tags, JSON-LD schema. Safe-by-default: only writes to Yoast/RankMath fields or post meta, never to raw post content.
 * Version:           0.1.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Katz Melinger
 * License:           Proprietary
 * Text Domain:       km-autopilot
 *
 * Companion to the marketing dashboard's /api/wp/recommendations + /api/wp/applied endpoints.
 * Settings → KM AutoPilot to configure base URL + token. Sync runs on WP-Cron every 15 minutes.
 */

if (!defined('ABSPATH')) {
    exit;
}

define('KM_AUTOPILOT_VERSION', '0.1.0');
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
        'base_url' => '',
        'token'    => '',
        'enabled'  => false,
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
            km_autopilot_log_event(
                'Skipped ' . $rec['id'] . ' (' . $rec['fix_type'] . '): ' . $result->get_error_message(),
                ['rec_id' => $rec['id']]
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
    return ['applied' => $applied, 'skipped' => $skipped, 'fetched' => count($items)];
}

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
