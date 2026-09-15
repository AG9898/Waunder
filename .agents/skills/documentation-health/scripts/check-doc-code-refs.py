#!/usr/bin/env python3
"""Read-only advisory check for literal repository paths in Markdown inline code."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


MARKDOWN_SUFFIXES = {".md", ".mdx"}
INLINE_CODE = re.compile(r"`([^`\n]+)`")
PATHISH = re.compile(r"^(?:\.?\.?/)?[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+(?:\.[A-Za-z0-9_.-]+)?$|^[A-Za-z0-9_.-]+\.(?:py|ts|tsx|js|jsx|rs|go|java|json|yaml|yml|toml|sql|sh)$")
HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)


def relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def classify(value: str) -> str | None:
    if any(marker in value for marker in ("*", "{", "}", "<", ">", "...", "$")):
        return "pattern"
    if PATHISH.fullmatch(value):
        return "literal"
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".", help="repository root (default: current directory)")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    docs = root / "docs"
    files = sorted(path for path in docs.rglob("*") if path.is_file() and path.suffix.lower() in MARKDOWN_SUFFIXES) if docs.is_dir() else []
    files.extend(path for path in (root / "AGENTS.md", root / "CLAUDE.md") if path.is_file())
    existing, missing, patterns = [], [], []

    for source in sorted(files):
        source_rel = relative(source, root)
        text = HTML_COMMENT.sub(
            lambda match: "\n" * match.group(0).count("\n"),
            source.read_text(encoding="utf-8", errors="replace"),
        )
        for line_number, line in enumerate(text.splitlines(), start=1):
            for value in INLINE_CODE.findall(line):
                kind = classify(value)
                if kind is None:
                    continue
                record = {"source": source_rel, "line": line_number, "reference": value}
                if kind == "pattern":
                    patterns.append(record)
                    continue
                resolved = (root / value).resolve()
                try:
                    resolved.relative_to(root)
                except ValueError:
                    record["reason"] = "outside_repository"
                    missing.append(record)
                    continue
                (existing if resolved.exists() else missing).append(record)

    result = {"repository": str(root), "existing": existing, "missing": missing, "patterns": patterns}
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Existing literal paths: {len(existing)}")
        print(f"Missing literal paths (advisory): {len(missing)}")
        for item in missing:
            print(f"  {item['source']}:{item['line']}  {item['reference']}")
        print(f"Patterns/placeholders skipped: {len(patterns)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
