/**
 * Keyword rules shared by the server and the draft panel (Oct 6 spec, Task 15).
 * Pure: no IO, safe in the browser.
 *
 * Draft 7a4bc5e3 stored 'publish "what to do after being fired" action
 * checklist for retaliation cases new york' as its primary keyword: the task
 * title with its verb kept and "new york" appended. Every SEO finding was then
 * measured against a phrase nobody searches. These rules stop that.
 */

/** Words that make a title a task, not a search. */
export const TASK_WORDS = ["publish", "write", "create", "draft", "refresh", "update", "build", "add", "make"];

/** Content-format words that are not part of what anyone searches. */
const FORMAT_PHRASES = ["action checklist", "blog post", "landing page", "guide", "blog", "post", "article"];

const MAX_WORDS = 8;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

/**
 * Why a phrase cannot be a primary keyword, or null when it can: it carries a
 * task word or runs past eight words. SEO findings and Apply fix never run
 * against a keyword that fails this ("Keyword needs selection").
 */
export function keywordProblem(keyword: string | null | undefined): string | null {
  const k = (keyword ?? "").trim().toLowerCase();
  if (!k) return "No keyword has been chosen";
  const task = TASK_WORDS.find((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(k));
  if (task) return `Contains the task word "${task}"`;
  if (words(k).length > MAX_WORDS) return `More than ${MAX_WORDS} words`;
  return null;
}

/**
 * The search seed inside a task title. A quoted phrase wins ('Publish "What to
 * Do After Being Fired" action checklist' -> "what to do after being fired");
 * otherwise the task words and format words are removed.
 */
export function seedFromTitle(title: string): string {
  const t = (title ?? "").trim();
  const quoted = t.match(/["“”'‘’]([^"“”'‘’]{3,})["“”'‘’]/);
  if (quoted && words(quoted[1]).length >= 2) return clean(quoted[1]);
  let s = ` ${t.toLowerCase()} `;
  for (const p of FORMAT_PHRASES) s = s.replace(new RegExp(`\\s${p}s?\\s`, "g"), " ");
  for (const w of TASK_WORDS) s = s.replace(new RegExp(`\\s${w}s?\\s`, "g"), " ");
  return clean(s);
}

function clean(s: string): string {
  return s
    .toLowerCase()
    .replace(/[“”"‘’]/g, "")
    .replace(/[^a-z0-9'\- ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Phrases that mean the same thing for overlap purposes. Longest first. */
const SAME: [RegExp, string][] = [
  [/\bnew york city\b|\bnyc\b|\bnew york\b|\bny\b/g, " ny "],
  [/\blawyers?\b|\battorneys?\b/g, " attorney "],
  [/\bwhat to do\b|\bsteps to take\b|\bthings to do\b|\bnext steps\b|\bsteps\b/g, " steps "],
  [/\bfired\b|\bfiring\b|\bterminated\b|\bterminations?\b|\bdismissed\b|\blet go\b/g, " terminat "],
  [/\blaid off\b|\blayoffs?\b/g, " layoff "],
];

const STOP = new Set([
  "a", "an", "the", "to", "of", "for", "in", "on", "at", "my", "your", "you", "i", "is", "are", "be", "being", "been",
  "do", "does", "can", "will", "with", "and", "or", "by", "from", "about", "how", "what", "when", "why", "who", "if",
  "it", "me", "this", "that", "should", "get", "got", "four", "five", "three", "two", "one", "take", "after",
]);

/** The words that carry a phrase's intent, with synonyms merged. */
export function intentTokens(text: string): Set<string> {
  let s = ` ${clean(text).replace(/-/g, " ")} `;
  for (const [re, to] of SAME) s = s.replace(re, to);
  return new Set(words(s).filter((w) => !STOP.has(w) && w.length > 1));
}

/** Share of A's intent words that B also has (0..1). */
export function coverage(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / a.size;
}
