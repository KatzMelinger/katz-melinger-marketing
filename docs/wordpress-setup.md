# WordPress setup for Huraqan publishing (one-time)

For whoever administers the law-firm WordPress site. This is done **once**. After it's done,
posts publish automatically from Huraqan — no per-post work in WordPress.

Total time: ~5 minutes (Steps 1–3). Step 4 is optional (SEO meta sync).

---

## Step 0 — Confirm the site is on HTTPS
Open the site; the address should start with `https://` (padlock icon). WordPress disables
Application Passwords on non-secure (`http://`) sites by default. Almost every live site already
qualifies — just confirm.

## Step 1 — Log in as an admin (or an Editor)
The account you use must be able to publish posts. Administrator is simplest; Editor also works.

## Step 2 — Generate an Application Password
1. In the WordPress admin sidebar, go to **Users → Profile** (or **Users → All Users → [your user] → Edit**).
2. Scroll to the **Application Passwords** section near the bottom.
3. In **New Application Password Name**, type: `Huraqan`
4. Click **Add New Application Password**.
5. WordPress shows a password like `abcd EFGH 1234 ijkl 5678 mnop` (24 characters, spaces shown).
   **Copy it now** — it is shown only once.

> Note: this is NOT the user's login password. It's a separate, revocable key that only allows
> API access. You can revoke it anytime from this same screen without affecting the login.

### If you see "Application passwords are disabled" / blocked by Wordfence
Wordfence disables Application Passwords by default as generic hardening. Re-enable them (safe —
this is a core WordPress feature, scoped and revocable):
1. WordPress admin sidebar → **Login Security** (a.k.a. **Wordfence → Login Security**).
2. Open the **Settings** tab.
3. Find the checkbox **"Disable application passwords"** (currently checked) and **uncheck it**.
4. **Save**, then return to **Users → Profile → Application Passwords** and try Step 2 again.

> Second possible Wordfence hurdle (later, not now): the Wordfence **firewall** may block the
> publish requests from Huraqan's server. If so, allowlist Huraqan's server IP under
> **Wordfence → Firewall → All Firewall Options → Allowlisted IP Addresses**. The Huraqan team
> will provide the exact IP when the publish step is built.

## Step 3 — Send the credentials to the Huraqan team (securely)
Send these three things (use a password manager / secure note, not plain email if possible):
- **Site URL** — e.g. `https://www.example-lawfirm.com`
- **WordPress username** — the account from Step 1
- **Application password** — the 24-character value from Step 2

That's all that's required to publish posts, titles, content, and URL slugs automatically.

---

## Step 4 — (Optional) Enable SEO title/description sync
Only needed if you want Huraqan to also set the **SEO meta title & description** (the Yoast or
RankMath fields). Without this, posts still publish perfectly — you'd just set those two SEO fields
in WordPress manually if desired.

1. Create a file named `huraqan-seo-bridge.php` inside `wp-content/mu-plugins/`
   (create the `mu-plugins` folder if it doesn't exist — files there load automatically, no
   activation needed).
2. Paste the snippet below.
3. **Keep only the keys for your SEO plugin** (Yoast OR RankMath) — leaving both is harmless too.

```php
<?php
/**
 * Plugin Name: Huraqan SEO Meta Bridge
 * Description: Exposes SEO title & description to the REST API so Huraqan can set them on publish.
 */
add_action('init', function () {
    $keys = [
        // Yoast SEO:
        '_yoast_wpseo_title',
        '_yoast_wpseo_metadesc',
        // RankMath (remove if you use Yoast):
        'rank_math_title',
        'rank_math_description',
    ];
    foreach ($keys as $key) {
        register_post_meta('post', $key, [
            'show_in_rest'  => true,
            'single'        => true,
            'type'          => 'string',
            'auth_callback' => function () { return current_user_can('edit_posts'); },
        ]);
    }
});
```

---

## What happens after setup (the ongoing flow — no WordPress login needed)
1. A post is drafted and approved inside Huraqan.
2. Huraqan sends it to WordPress over the REST API using the Application Password.
3. The post appears in WordPress (as a published post, or a draft if we choose to stage it).
4. The live URL is recorded back in Huraqan's production board.

No copy-paste, no manual publishing, no per-post WordPress login.

## Security notes
- The Application Password can be **revoked anytime** (Users → Profile → Application Passwords)
  without changing the login password.
- It only grants REST API access at the permissions of that user.
- If you ever rotate it, just generate a new one and send the new value to the Huraqan team.
