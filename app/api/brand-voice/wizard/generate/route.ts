/**
 * POST /api/brand-voice/wizard/generate
 *
 * Drafts ONE brand asset from a short intake. Each of the three brand-voice
 * wizards (components/brand-voice-wizard.tsx) calls this with a different
 * `target`; the wizards are independent and never chained, so this route only
 * ever drafts the single slice it's asked for.
 *
 *   body: {
 *     target: "brandVoice" | "avatars" | "directions",   // required
 *     firmName?, description, targetGeography?, website?,
 *     services?, audienceNotes?, tonePreferences?,
 *   }
 *
 * Response (only the relevant key is present):
 *   target "brandVoice" → { settings: { firmName, targetGeography, brandVoice, keyMessages, toneOfVoice } }
 *   target "avatars"    → { avatars: [...] }
 *   target "directions" → { directions: [...] }
 *
 * Nothing is persisted here — the wizard saves through the existing
 * /api/brand-voice/* and /api/content/skills endpoints after the user edits.
 *
 * Forced tool-use guarantees the model output is parsed by the SDK into a valid
 * object — critical because brandVoice is long markdown with newlines and quotes
 * that routinely break raw-JSON parsing.
 */

import { NextRequest, NextResponse } from "next/server";

import { getAnthropic, KEYWORD_RESEARCH_MODEL } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const TARGETS = ["brandVoice", "avatars", "directions"] as const;
type Target = (typeof TARGETS)[number];

const VALID_SKILL_TYPES = ["direction", "voice_rule", "do_dont", "compliance"] as const;
type DirectionType = (typeof VALID_SKILL_TYPES)[number];

type Intake = {
  firmName: string;
  description: string;
  targetGeography: string;
  website: string;
  services: string;
  audienceNotes: string;
  tonePreferences: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

const SYSTEM = `You are a senior brand strategist and copy chief helping a business define its brand voice for an AI marketing system. The output you produce will be injected verbatim into the system prompt of every piece of content the business generates — blog posts, social posts, emails, landing pages. So it must be concrete, opinionated, and immediately usable, not generic marketing fluff.

Write in plain, direct language. Never fabricate facts about the business (addresses, phone numbers, statistics, awards) — work only from what the intake gives you. When you don't know a detail, keep guidance about *how* to write rather than inventing *what* to say.`;

function intakeBlock(intake: Intake): string {
  return `Here is the intake for the business:

- Name: ${intake.firmName || "(not given — infer a placeholder, the user will correct it)"}
- What they do / who they serve: ${intake.description}
- Target geography: ${intake.targetGeography || "(not specified)"}
- Website: ${intake.website || "(not specified)"}
- Services / practice areas: ${intake.services || "(not specified — infer from the description)"}
- Who they want to reach: ${intake.audienceNotes || "(not specified — infer from the description)"}
- Tone preferences / words to avoid: ${intake.tonePreferences || "(none given — choose a tone that fits the business)"}`;
}

// ---- per-target prompt + tool --------------------------------------------

type ToolDef = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
};

const CONTENT_TYPE_LIST =
  "Blog Post, FAQ, Practice Page, Case Study, Landing Page, Press Release, Email Newsletter, Social Media Post, Video Script, Website Copy";

function buildRequest(target: Target, intake: Intake): { user: string; tool: ToolDef } {
  const intro = intakeBlock(intake);

  if (target === "brandVoice") {
    return {
      user: `${intro}

Draft the brand-voice guide for this business. Call the save_brand_voice tool with:
- brandVoice: 250-450 words of markdown. Cover who we are and who we serve; the voice in 3-5 adjectives with a one-line gloss each; how we explain complex/technical ideas; sentence and paragraph rhythm; how we open and close pieces (hooks and CTAs); and a short "never do this" list. Specific to THIS business.
- keyMessages: 3-6 markdown bullets ("- ") of the core things every piece should reinforce.
- toneOfVoice: 2-4 sentences on exactly how the writing should sound. Concrete adjectives, not "professional yet approachable".
- firmName and targetGeography: echo the intake (or a clean placeholder).`,
      tool: {
        name: "save_brand_voice",
        description: "Save the drafted brand-voice guide.",
        input_schema: {
          type: "object",
          properties: {
            firmName: { type: "string" },
            targetGeography: { type: "string" },
            brandVoice: { type: "string", description: "250-450 words of markdown." },
            keyMessages: { type: "string", description: "3-6 markdown bullets." },
            toneOfVoice: { type: "string" },
          },
          required: ["brandVoice", "keyMessages", "toneOfVoice"],
        },
      },
    };
  }

  if (target === "avatars") {
    return {
      user: `${intro}

Draft 2-3 audience avatars (personas) for this business — genuinely distinct segments, not variations of one. Call the save_avatars tool. For each avatar:
- name: short persona label (e.g. "Overworked Hourly Employee")
- role: one-line who-they-are
- description: 2-4 sentences on their situation and what they need from this business
- demographics: age range, location, income/job type — one line
- painPoints: the problems and frustrations they face
- goals: what they are trying to achieve
- channels: where they spend attention (search, LinkedIn, Reddit, email, etc.)`,
      tool: {
        name: "save_avatars",
        description: "Save the drafted audience avatars.",
        input_schema: {
          type: "object",
          properties: {
            avatars: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  role: { type: "string" },
                  description: { type: "string" },
                  demographics: { type: "string" },
                  painPoints: { type: "string" },
                  goals: { type: "string" },
                  channels: { type: "string" },
                },
                required: ["name"],
              },
            },
          },
          required: ["avatars"],
        },
      },
    };
  }

  // directions
  return {
    user: `${intro}

Draft 4-6 content directions — rules injected into every matching content generation. Call the save_directions tool. Provide a mix: at least one voice_rule, one do_dont, one or two general "direction" rules, and (only if the business is in a regulated field like law, medicine, or finance) one compliance rule. For each:
- title: short name (e.g. "Second-person framing")
- skillType: one of direction, voice_rule, do_dont, compliance
- content: the actual rule, concrete enough to follow. For do_dont use "DO: ... DON'T: ..." lines.
- contentTypes: usually [] (applies everywhere). Only scope it when a rule is clearly format-specific, using values from: ${CONTENT_TYPE_LIST}.`,
    tool: {
      name: "save_directions",
      description: "Save the drafted content directions.",
      input_schema: {
        type: "object",
        properties: {
          directions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                skillType: { type: "string", enum: [...VALID_SKILL_TYPES] },
                content: { type: "string" },
                contentTypes: { type: "array", items: { type: "string" } },
              },
              required: ["title", "skillType", "content"],
            },
          },
        },
        required: ["directions"],
      },
    },
  };
}

// ---- response normalizers -------------------------------------------------

function normalizeBrandVoice(input: Record<string, unknown>, intake: Intake) {
  return {
    settings: {
      firmName: str(input.firmName) || intake.firmName,
      targetGeography: str(input.targetGeography) || intake.targetGeography,
      brandVoice: str(input.brandVoice),
      keyMessages: str(input.keyMessages),
      toneOfVoice: str(input.toneOfVoice),
    },
  };
}

function normalizeAvatars(input: Record<string, unknown>) {
  const avatars = Array.isArray(input.avatars)
    ? (input.avatars as unknown[])
        .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
        .map((a) => ({
          name: str(a.name),
          role: str(a.role),
          description: str(a.description),
          demographics: str(a.demographics),
          painPoints: str(a.painPoints),
          goals: str(a.goals),
          channels: str(a.channels),
        }))
        .filter((a) => a.name)
    : [];
  return { avatars };
}

function normalizeDirections(input: Record<string, unknown>) {
  const directions = Array.isArray(input.directions)
    ? (input.directions as unknown[])
        .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
        .map((d) => {
          const t = str(d.skillType) as DirectionType;
          return {
            title: str(d.title),
            skillType: VALID_SKILL_TYPES.includes(t) ? t : "direction",
            content: str(d.content),
            contentTypes: strArray(d.contentTypes),
          };
        })
        .filter((d) => d.title && d.content)
    : [];
  return { directions };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const target = str(body?.target) as Target;
  if (!TARGETS.includes(target)) {
    return NextResponse.json(
      { error: `target must be one of: ${TARGETS.join(", ")}` },
      { status: 400 },
    );
  }

  const intake: Intake = {
    firmName: str(body?.firmName),
    description: str(body?.description),
    targetGeography: str(body?.targetGeography),
    website: str(body?.website),
    services: str(body?.services),
    audienceNotes: str(body?.audienceNotes),
    tonePreferences: str(body?.tonePreferences),
  };

  if (!intake.description) {
    return NextResponse.json(
      { error: "description is required — tell us what the business does and who it serves" },
      { status: 400 },
    );
  }

  const { user, tool } = buildRequest(target, intake);

  try {
    const resp = await getAnthropic().messages.create({
      model: KEYWORD_RESEARCH_MODEL,
      // Generous headroom: the voice guide / avatar set / direction set can run
      // long, and truncation drops whichever fields the model emits last.
      max_tokens: 8192,
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
    });

    const block = resp.content.find((b) => b.type === "tool_use");
    const input = (block && block.type === "tool_use"
      ? (block.input as Record<string, unknown>)
      : {}) as Record<string, unknown>;

    const out =
      target === "brandVoice"
        ? normalizeBrandVoice(input, intake)
        : target === "avatars"
          ? normalizeAvatars(input)
          : normalizeDirections(input);

    return NextResponse.json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to generate draft";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
