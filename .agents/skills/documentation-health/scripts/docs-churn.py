#!/usr/bin/env python3
"""Read-only advisory comparison of recent documentation and code changes."""

from __future__ import annotations

import argparse
import json
import subprocess
from collections import Counter
from pathlib import PurePosixPath


DOC_SUFFIXES = {".md", ".mdx"}


def bucket(path: str) -> str:
    parts = PurePosixPath(path).parts
    if len(parts) >= 2:
        return "/".join(parts[:2])
    return parts[0] if parts else path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", default=".", help="repository root (default: current directory)")
    parser.add_argument("--since", default="90 days ago", help="Git --since value (default: 90 days ago)")
    parser.add_argument("--json", action="store_true", help="emit JSON")
    args = parser.parse_args()
    try:
        completed = subprocess.run(
            ["git", "-C", args.root, "log", f"--since={args.since}", "--name-only", "--format="],
            check=True,
            text=True,
            capture_output=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        result = {"repository": args.root, "since": args.since, "available": False, "reason": str(error)}
        print(json.dumps(result, indent=2) if args.json else f"Git churn unavailable: {error}")
        return 0

    paths = sorted({line.strip() for line in completed.stdout.splitlines() if line.strip()})
    docs = [path for path in paths if path.startswith("docs/") and PurePosixPath(path).suffix.lower() in DOC_SUFFIXES]
    non_docs = [path for path in paths if path not in docs]
    result = {
        "repository": args.root,
        "since": args.since,
        "available": True,
        "documentation_paths_changed": docs,
        "non_documentation_paths_changed": non_docs,
        "non_documentation_buckets": Counter(bucket(path) for path in non_docs).most_common(),
        "note": "Churn is advisory evidence only; it does not establish documentation drift.",
    }
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Documentation paths changed: {len(docs)}")
        print(f"Non-documentation paths changed: {len(non_docs)}")
        print("Most changed non-documentation areas:")
        for name, count in result["non_documentation_buckets"][:12]:
            print(f"  {count:>3}  {name}")
        print(result["note"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
