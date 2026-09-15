#!/usr/bin/env python3
"""Read-only Markdown inventory and local-link graph for a repository."""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote


MARKDOWN_SUFFIXES = {".md", ".mdx"}
INLINE_LINK = re.compile(r"(?<!!)\[[^\]]*\]\(([^)]+)\)")
HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$")
HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)


def relative(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def local_target(raw: str) -> str | None:
    target = raw.strip().split(maxsplit=1)[0].strip("<>")
    if not target or target.startswith("#") or "://" in target or target.startswith(("mailto:", "tel:")):
        return None
    return unquote(target.split("#", 1)[0])


def markdown_links(path: Path, root: Path) -> list[str]:
    links: list[str] = []
    text = HTML_COMMENT.sub("", path.read_text(encoding="utf-8", errors="replace"))
    for raw in INLINE_LINK.findall(text):
        target = local_target(raw)
        if not target:
            continue
        resolved = (path.parent / target).resolve()
        try:
            links.append(relative(resolved, root))
        except ValueError:
            links.append(f"OUTSIDE_REPO:{resolved}")
    return links


def document_files(root: Path) -> list[Path]:
    docs = root / "docs"
    if not docs.is_dir():
        return []
    return sorted(path for path in docs.rglob("*") if path.is_file() and path.suffix.lower() in MARKDOWN_SUFFIXES)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".", help="repository root (default: current directory)")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    files = document_files(root)
    inbound: dict[str, list[str]] = defaultdict(list)
    records = []
    for path in files:
        text = path.read_text(encoding="utf-8", errors="replace")
        rel = relative(path, root)
        links = markdown_links(path, root)
        for target in links:
            inbound[target].append(rel)
        headings = [match.group(1) for line in text.splitlines() if (match := HEADING.match(line))]
        records.append(
            {
                "path": rel,
                "lines": len(text.splitlines()),
                "words": len(re.findall(r"\S+", text)),
                "bytes": len(text.encode("utf-8")),
                "headings": headings,
                "outbound_local_links": sorted(set(links)),
            }
        )

    record_paths = {record["path"] for record in records}
    routing = [record["path"] for record in records if Path(record["path"]).name in {"INDEX.md", "README.md"}]
    root_routing = []
    for name in ("AGENTS.md", "CLAUDE.md"):
        candidate = root / name
        if candidate.is_file():
            routing.append(name)
            root_routing.append(candidate)
    for path in root_routing:
        for target in markdown_links(path, root):
            inbound[target].append(relative(path, root))
    for record in records:
        record["inbound_local_links"] = sorted(inbound.get(record["path"], []))

    result = {
        "repository": str(root),
        "documents": records,
        "summary": {
            "document_count": len(records),
            "routing_candidates": sorted(routing),
            "largest_by_words": [
                {"path": record["path"], "words": record["words"], "lines": record["lines"]}
                for record in sorted(records, key=lambda item: item["words"], reverse=True)[:10]
            ],
            "unlinked_candidates": sorted(
                path for path in record_paths if not inbound.get(path) and path not in routing
            ),
        },
    }
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Documents: {result['summary']['document_count']}")
        print("Routing candidates:")
        for item in result["summary"]["routing_candidates"]:
            print(f"  {item}")
        print("Largest documents by words:")
        for item in result["summary"]["largest_by_words"]:
            print(f"  {item['words']:>6} words  {item['path']}")
        print("Unlinked candidates:")
        for item in result["summary"]["unlinked_candidates"]:
            print(f"  {item}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
