"""Read the extracted SOP .txt files and generate a TS constants module."""
from pathlib import Path

SRC = Path(__file__).parent / "sops_extract"
OUT = Path(__file__).parent.parent / "lib" / "sales-coach-sops.ts"

ORDER = [
    "5.1.1-b Intake definitions_glossary",
    "5.1.2 New Client Calls (incoming)",
    "5.1.2-a Incoming Intake Script",
    "5.1.2-b Outgoing Intake Script",
    "5.2.2 Sales_Case Evaluator Review Process",
    "5.2.3-a Sales Team Playbook",
    "5.2.4 Attorney Review Process",
    "5.2.6 Fee structure policy",
]

def slugify(stem: str) -> str:
    out = []
    for ch in stem:
        if ch.isalnum():
            out.append(ch.upper())
        elif ch in (" ", "-", "_"):
            out.append("_")
    s = "".join(out)
    while "__" in s:
        s = s.replace("__", "_")
    return s.strip("_")

def escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")

def main() -> None:
    chunks: list[str] = []
    chunks.append(
        "/**\n"
        " * Embedded Katz Melinger SOPs and scripts. Auto-generated from\n"
        " * scripts/sops_extract/ — DO NOT edit by hand. Regenerate with\n"
        " *   python scripts/generate_sop_constants.py\n"
        " *\n"
        " * These constants are injected into the AI scoring system prompt so\n"
        " * Claude grades calls against the firm's own standards. Values are\n"
        " * also mirrored into the public.sales_training_materials table when\n"
        " * the user uploads through /settings/sales-training; until then the\n"
        " * constants here are the source of truth.\n"
        " */\n"
    )
    chunks.append("export type SopDocument = {\n  fileName: string\n  sectionCode: string\n  docType: 'sop' | 'script' | 'playbook' | 'glossary'\n  text: string\n}\n")

    docs: list[tuple[str, str]] = []
    for stem in ORDER:
        fp = SRC / f"{stem}.txt"
        if not fp.exists():
            continue
        text = fp.read_text(encoding="utf-8")
        const_name = slugify(stem)
        docs.append((stem, const_name))
        # Heuristic doc_type and sectionCode
        section_code = stem.split(" ")[0]
        if "Glossary" in stem or "Definitions" in stem or "definitions" in stem:
            doc_type = "glossary"
        elif "Script" in stem:
            doc_type = "script"
        elif "Playbook" in stem:
            doc_type = "playbook"
        else:
            doc_type = "sop"
        chunks.append(
            f"\nexport const SOP_{const_name}: SopDocument = {{\n"
            f"  fileName: {stem!r},\n"
            f"  sectionCode: {section_code!r},\n"
            f"  docType: {doc_type!r},\n"
            f"  text: `{escape(text)}`,\n"
            f"}}\n"
        )

    chunks.append(
        "\nexport const ALL_SOPS: SopDocument[] = [\n"
        + "".join(f"  SOP_{cn},\n" for _, cn in docs)
        + "]\n"
    )

    OUT.write_text("".join(chunks), encoding="utf-8")
    print(f"wrote {OUT}  ({OUT.stat().st_size:,} bytes, {len(docs)} SOPs)")


if __name__ == "__main__":
    main()
