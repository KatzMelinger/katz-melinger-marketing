/**
 * The legacy horizontal MarketingNav has been replaced by the sidebar in
 * `app/layout.tsx`. Pages still import this component, so we keep the export
 * but render nothing — removing the imports across 25 pages would balloon
 * this change for no functional benefit.
 *
 * If you're adding a new nav item, edit `components/marketing-sidebar.tsx`.
 */

export const MARKETING_NAV: { label: string; href: string; icon: string }[] = [];

export function MarketingNav() {
  return null;
}
