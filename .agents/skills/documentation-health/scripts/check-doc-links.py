#!/usr/bin/env python3
"""Read-only validation for local Markdown link targets and heading anchors."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from urllib.parse import unquote


MARKDOWN_SUFFIXES = {".md", ".mdx"}
INLINE_LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")
HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$")
HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)


def slug(text: str) -> str:
    text = text.strip().lower()
    text = re.sub(r"[\[\]`*_~]", "", text)
    text = re.sub(r"[^\w\- ]", "", text)
    return re.sub(r"[\s_]+", "-", text).strip("-")


def anchors(path: Path) -> set[str]:
    values: set[str] = set()
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        match = HEADING.match(line)
        if match:
            values.add(slug(match.group(1)))
    return values


def relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def parse_target(raw: str) -> tuple[str | None, str | None]:
    target = raw.strip().split(maxsplit=1)[0].strip("<>")
    if not target or "://" in target or target.startswith(("mailto:", "tel:")):
        return None, None
    path, separator, anchor = unquote(target).partition("#")
    return path or None, anchor if separator else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".", help="repository root (default: current directory)")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    docs = root / "docs"
    files = sorted(path for path in docs.rglob("*") if path.is_file() and path.suffix.lower() in MARKDOWN_SUFFIXES) if docs.is_dir() else []
    files.extend(path for path in (root / "AGENTS.md", root / "CLAUDE.md") if path.is_file())
    failures = []
    checked = 0
    anchor_cache: dict[Path, set[str]] = {}

    for source in sorted(files):
        text = HTML_COMMENT.sub("", source.read_text(encoding="utf-8", errors="replace"))
        for raw in INLINE_LINK.findall(text):
            path_part, anchor = parse_target(raw)
            if path_part is None and anchor is None:
                continue
            target = source if path_part is None else (source.parent / path_part).resolve()
            checked += 1
            try:
                target_rel = relative(target, root)
            except ValueError:
                failures.append({"source": relative(source, root), "target": raw, "reason": "target_outside_repository"})
                continue
            if not target.exists():
                failures.append({"source": relative(source, root), "target": raw, "reason": "missing_target", "resolved": target_rel})
                continue
            if anchor and target.is_file() and target.suffix.lower() in MARKDOWN_SUFFIXES:
                available = anchor_cache.setdefault(target, anchors(target))
                if slug(anchor) not in available:
                    failures.append({"source": relative(source, root), "target": raw, "reason": "missing_anchor", "resolved": target_rel})

    result = {"repository": str(root), "checked_links": checked, "failures": failures}
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Checked local links: {checked}")
        if failures:
            print("Failures:")
            for item in failures:
                print(f"  {item['source']}: {item['target']} ({item['reason']})")
        else:
            print("No broken local links or Markdown anchors found.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
