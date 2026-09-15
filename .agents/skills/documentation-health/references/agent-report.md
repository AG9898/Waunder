# Documentation Review Report Contract

Use one report per assigned documentation domain. Return findings, not a prose summary of every document read.

## Scope Header

```text
DOMAIN: <assigned route or document group>
DOCUMENTS REVIEWED: <compact path list>
CODE CHECKED: <paths, or none>
OVERALL: healthy | needs-focused-cleanup | needs-major-overhaul
```

## Finding Format

```text
ID: <domain>-<number>
SEVERITY: critical | high | medium | low | advisory
DOC: <path>
EVIDENCE: <heading, line range, link target, or command result>
FINDING: <one factual sentence>
CODE CHECK: <path/result, planned-not-implemented, or not-needed>
CONFIDENCE: high | medium | low
MINIMUM REMEDIATION: <smallest safe change>
STRUCTURAL IMPACT: none | local | major-candidate
```

Use `major-candidate` only when the proposed change contributes to a navigation-model change or structural manipulation of an existing major document. Do not count a focused new supporting document by itself as major.

## Review Rules

- Follow routing links before treating a document as orphaned.
- Distinguish canonical sources, parent indexes, historical archives, generated material, and reference inputs.
- Check code only for a concrete claim such as a cited path, interface, command, or obsolete implementation statement.
- Report uncertainty rather than inferring semantic drift from Git dates or file absence.
- Recommend preservation when a long document is coherent, well-routed, and needed as a single reference.
- Do not edit files or propose broad rewrites without evidence.
