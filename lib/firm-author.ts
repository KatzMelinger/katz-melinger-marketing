/**
 * Author byline directive for the content generators — a thin adapter over the
 * structured author records in lib/authors.ts (master-spec Part 3), kept so
 * km-draft / update-draft don't need to change their imports. Ensures generated
 * and refreshed content is attributed to the firm's real author and never invents
 * or carries forward a wrong byline.
 */

import { defaultAuthor, type Author } from "./authors";

/** Prompt directive: attribute content to the firm author, replacing any other byline. */
export function renderAuthorDirective(author: Author = defaultAuthor()): string {
  return [
    "AUTHOR ATTRIBUTION (required):",
    `- This content's author is ${author.name}, ${author.title}, ${author.firm} (${author.experience} of experience).`,
    "- If the content includes an author line or byline, it MUST name this author exactly.",
    "- REPLACE any other author name or existing byline — including one already on the page — with this author. Never keep, invent, or attribute the content to a different name.",
  ].join("\n");
}
