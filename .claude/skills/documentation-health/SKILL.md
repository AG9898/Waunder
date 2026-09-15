---
name: documentation-health
description: Audit and conservatively clean a repository's documentation when it has grown, drifted, or become difficult for agents to navigate.
version: 1.0.1
---

# Documentation Health

Use this skill for a full documentation sweep, documentation-health audit, or a request to reorganize documentation for agent navigation. Do not use it for an ordinary one-file documentation edit.

The outcome is a navigable, accurately scoped documentation system: agents can find the right source of truth without loading unrelated history or duplicated guidance.

Invoke as `/documentation-health` for a full sweep, optionally specifying whether the run is audit-only or includes cleanup.

## Scope and Modes

Read `CLAUDE.md` first. It defines the repository's local documentation routes and maintenance rules.

- **Audit only:** report evidence, health assessment, and a proposed cleanup plan; do not edit.
- **Audit and clean up:** run the full workflow and make conservative documentation edits after planning.

Start with `docs/`, then include root instructions and section `README.md` files when they route agents into documentation. Treat `reference/`, generated files, historical archives, and synced skills as separate categories unless the repository identifies them as canonical documentation.

## Workflow

### 1. Establish the map before reading prose

1. Check the worktree and identify pre-existing changes that must be preserved.
2. Discover the routing topology from `CLAUDE.md`, primary index candidates (`docs/INDEX.md` and `docs/README.md`), and nested section indexes or READMEs.
3. Run the evidence helpers from the target repository root, invoking each script by its path inside this skill directory (`<skill-dir>` below). Prefer their JSON output and targeted queries over loading documents wholesale:

   ```bash
   python3 <skill-dir>/scripts/docs-inventory.py . --json
   python3 <skill-dir>/scripts/check-doc-links.py . --json
   python3 <skill-dir>/scripts/check-doc-code-refs.py . --json
   python3 <skill-dir>/scripts/docs-churn.py . --json
   ```

4. Treat metrics as triage only. Length, age, missing inbound links, and code churn identify candidates; none independently proves that a document is wrong or should be split.

### 2. Delegate bounded reviews

When delegation is available and the documentation has independent domains, spawn reviewers after the inventory—not before it. Partition by routing topology and ownership, never arbitrary file counts. Suitable assignments include:

- navigation, indexes, root instructions, and link integrity;
- product, architecture, and decisions;
- engineering documents such as API, schema, security, testing, and conventions;
- one reviewer per independent product domain or nested documentation section.

Give each reviewer only its assigned inventory slice, routed documents, and targeted code roots. Each reviewer must inspect source only to verify a concrete claim; it must not read an entire codebase or edit files. Read [the report contract](references/agent-report.md) before delegating.

For a small or flat documentation set, keep the review local instead of manufacturing parallel work. The main agent owns synthesis and normally owns every edit. It may delegate isolated edit groups only after the plan is settled, with exclusive file ownership; the main agent retains every primary index and routing file.

### 3. Reconcile and plan

Deduplicate reviewer findings and personally verify the evidence behind high-impact claims. For possible code drift, inspect the cited source path or a focused change history. A missing literal path or stale code churn is a candidate, not proof: planned or historical designs may intentionally have no implementation.

Classify each proposed change as one of:

- **Text edit:** clarification, deletion of duplicated prose, correction, or a link update.
- **Local structure:** a focused new document or split, with a clear single owner and preserved routes.
- **Major overhaul:** changes to the navigation model, canonical ownership, or four or more existing major documents through splitting, merging, moving, renaming, deleting, or otherwise restructuring them.

An existing major document is a core/platform document listed by the primary routing map or directly routed from `CLAUDE.md`. Count each existing major document affected by a structural operation once; do not evade the threshold by fragmenting the plan. A new focused document alone does not make the work major.

For an audit-only request, stop after presenting the compact plan. For cleanup, proceed without approval through text edits and local structure. Before a major overhaul, present the evidence, affected major documents, expected navigation changes, and rollback-safe plan; wait for explicit user approval.

Keep transient state compact: inventory digest, assignments, finding IDs, chosen actions, and validation results. Keep it in the active context or a temporary path unless the user asks for a durable audit report. Do not create a new documentation archive merely to store agent notes.

### 4. Clean up conservatively

Apply the minimum changes that improve retrieval and truthfulness:

- make each canonical document own a distinct question;
- replace repeated policy with a brief canonical statement and a precise link;
- split a document only when the new reading path is clearly narrower than the old one;
- preserve stable entry points, parent indexes, index membership, and inbound links;
- update the instruction dispatcher and nearest parent indexes whenever their routes change.

Do not normalize filenames, rewrite style, or split documents merely to satisfy a size target. Do not modify application code as part of this skill.

### 5. Verify and report

After edits, rerun inventory and link checks. Run code-reference and churn checks when they informed the plan. Review the diff to confirm that unrelated documents and pre-existing user changes were preserved.

Report:

- the documentation map and overall health conclusion;
- completed changes and preserved navigation routes;
- before/after context metrics where meaningful;
- checks run and remaining advisory findings;
- any deferred major-overhaul proposal or unresolved code/doc question.

## Evidence Helpers

- `scripts/docs-inventory.py` inventories Markdown documents, routing candidates, sizes, headings, local-link graph, and unlinked candidates.
- `scripts/check-doc-links.py` validates local Markdown targets and heading anchors.
- `scripts/check-doc-code-refs.py` checks literal backticked repository paths and separates patterns from missing paths.
- `scripts/docs-churn.py` compares recent documentation and non-document changes as advisory evidence.

All helpers are read-only and use only the Python standard library plus Git when available. Run them from the target repository, passing its root as the first argument.

## Guardrails

- Never load every document by default; inventory first and read only routed, assigned, or evidenced documents.
- Never treat length, churn, missing inbound links, or a missing code path alone as justification to alter documentation.
- Never change the navigation model or structurally manipulate four or more existing major documents without explicit user approval.
- Preserve canonical indexes, parent indexes, root instruction routing, and valid inbound links in the same cleanup.
- Do not overwrite, revert, stage, or discard pre-existing user changes.
- Keep sub-agent reports concise and evidence-based; do not persist raw reports in the documentation tree by default.
- Do not edit application code, generated files, archives, or intentionally out-of-scope reference material unless the user expands the request.
