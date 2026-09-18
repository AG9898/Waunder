/**
 * The outcome of one import, ported from `renderResult` in `web/components/manual_entry.go` (see
 * docs/GO_MIGRATION.md): Rails' sentence about what it did with the posting, and a link to the
 * posting it returned.
 *
 * The outcome is the top-level `import` key of `POST /api/job_posts`'s answer, a *sibling* of
 * `job_post` — Go decoded the two separately and copied `import` onto its result struct. It is
 * rendered, never inferred: whether a URL is already tracked or already submitted is Rails'
 * identity match (`JobPostUrlIdentity`), and the link goes to whichever posting Rails named — for
 * a match, the existing one, not a duplicate.
 *
 * Every outcome keeps the `.manual-entry-result` panel, so the four read apart by their sentence,
 * link label, and the Surface v2 tone attached to the modifier class from `importResultClass`.
 */
import { Link } from "react-router";

import type { ManualJobResult } from "../../api/schemas";
import {
  importLinkLabel,
  importMessage,
  importOutcome,
  importResultClass,
  importResultHref,
} from "../../lib/manual-entry";

export function ImportResult({ result }: { result: ManualJobResult }) {
  return (
    <div
      className={`manual-entry-result ${importResultClass(importOutcome(result))}`}
      role="status"
    >
      <p className="manual-entry-result-msg">{importMessage(result)}</p>
      <Link className="manual-entry-result-link" to={importResultHref(result)}>
        {importLinkLabel(result)}
      </Link>
    </div>
  );
}
