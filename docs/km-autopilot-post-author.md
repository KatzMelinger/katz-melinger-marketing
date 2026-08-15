# KM AutoPilot — set the WordPress post author (E-E-A-T, master-spec Part 3)

## Why

MarketOS resolves which attorney a piece belongs to (employment → Nicole
Grunfeld, judgment enforcement → Kenneth Katz, collections → Adam Sackowitz) and
prints that name as the visible byline. But the *machine-readable* author — the
one Google reads — comes from Yoast, and Yoast builds it from the WordPress post
author, not from the byline text.

Today the plugin publishes everything as its single configured account. So a
piece bylined "Nicole D. Grunfeld" is recorded as written by that account, and
the structured data contradicts the page. For YMYL legal content, where author
credentials carry real weight, that undoes most of the E-E-A-T work.

We must **not** inject author schema ourselves — Yoast already owns the
Article/author `@graph` on every page, and a second author node is a
duplicate-schema problem. Setting `post_author` is the correct mechanism.

## What MarketOS already sends

No dashboard change is needed. Each item returned from `/api/wp/content`
already carries an `author` object:

```json
{
  "id": "…",
  "title": "…",
  "slug": "…",
  "content_html": "…",
  "practice_area": "employment",
  "author": {
    "login": "ndgrunfeld",
    "name": "Nicole D. Grunfeld",
    "slug": "nicole-d-grunfeld"
  },
  "update_url": null
}
```

`author` is `null` whenever no WordPress account is mapped for that attorney.
Right now that is the case for Nicole and Adam — only `kjkatz` exists — so the
plugin must treat `null` as "carry on as before", not as an error.

## The change

Add this helper to the plugin:

```php
/**
 * Resolve the WordPress user ID an item should be authored by.
 *
 * Returns 0 when MarketOS sent no author, or sent one that doesn't exist on
 * this site. 0 means "leave it alone" — the caller keeps whatever default the
 * plugin already uses. A missing user must never fail the publish: the author
 * is a quality signal, not a precondition for the post existing.
 */
function km_autopilot_resolve_author( $item ) {
    if ( empty( $item['author'] ) || empty( $item['author']['login'] ) ) {
        return 0;
    }

    $login = sanitize_user( $item['author']['login'], true );
    $user  = get_user_by( 'login', $login );

    if ( ! $user ) {
        error_log( sprintf(
            '[KM AutoPilot] author login "%s" not found on this site; using plugin default.',
            $login
        ) );
        return 0;
    }

    return (int) $user->ID;
}
```

Then, where the plugin builds the array for `wp_insert_post()`:

```php
$postarr = array(
    'post_title'   => $item['title'],
    'post_content' => $item['content_html'],
    // …existing fields…
);

$author_id = km_autopilot_resolve_author( $item );
if ( $author_id ) {
    $postarr['post_author'] = $author_id;
}

$post_id = wp_insert_post( $postarr, true );
```

The `if ( $author_id )` guard is the whole fallback: when it's 0 the key is
never added and `wp_insert_post` behaves exactly as it does today.

## Updates vs. new posts

For a refresh of an existing page (`update_url` set), **do not** overwrite
`post_author` if someone has already changed it by hand in WordPress. Safest
rule: set the author on create; on update, only set it when the existing author
is the plugin's own default account.

```php
// On update only:
$current = (int) get_post_field( 'post_author', $post_id );
if ( $author_id && $current === km_autopilot_default_author_id() ) {
    wp_update_post( array( 'ID' => $post_id, 'post_author' => $author_id ) );
}
```

Without that check, every content refresh would silently revert a manual
correction an editor made in wp-admin.

## Prerequisites on the WordPress side

1. A WordPress user must exist for each attorney, with role **Author** or
   higher. A Subscriber cannot be a post author at all; a Contributor cannot
   publish.
2. The username is permanent — WordPress won't rename it through the admin UI.
   Match the existing convention (`kjkatz`), e.g. `ndgrunfeld`, `asackowitz`.
3. Set each user's **display name** to exactly the byline MarketOS uses
   ("Nicole D. Grunfeld", "Adam J. Sackowitz", "Kenneth J. Katz"). Yoast puts
   the display name in the author schema; a mismatch here reintroduces the
   discrepancy this change exists to remove.
4. Fill **Biographical Info** — Yoast uses it for the author description — and
   register the address at gravatar.com so the author image resolves.

Once those accounts exist, send the usernames back and we set `wpLogin` in
`lib/authors.ts`; nothing else on the dashboard side changes.

## How to verify

1. Publish a piece whose practice area routes to a mapped attorney.
2. In wp-admin, confirm the post's Author column shows that attorney.
3. Run the live URL through Google's Rich Results Test and confirm the
   `Article.author.name` in the Yoast graph matches the visible byline.
