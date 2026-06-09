import type { FieldAnswer } from "./types.js";

// Sensitive categories the worker must never auto-answer unless the user
// explicitly provided and approved the value upstream. See initial_plan.md
// (Core Worker Responsibilities).
export const SENSITIVE_FIELD_PATTERNS: RegExp[] = [
  /salary|compensation|pay\s*expectation/i,
  /sponsor|visa|work\s*authorization|require.*sponsorship/i,
  /disab/i,
  /veteran|military/i,
  /gender|sex|race|ethnic|hispanic|latino/i,
  /sexual\s*orientation/i,
  /ssn|social\s*security|national\s*id/i,
  /date\s*of\s*birth|dob|age/i,
];

/** Returns true if a field label/name looks sensitive. */
export function isSensitiveField(field: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((re) => re.test(field));
}

/**
 * Splits answers into those safe to auto-fill and those that touch sensitive
 * categories. Sensitive answers are only allowed through when explicitly
 * present in the approved payload (the caller decides whether to pause).
 */
export function partitionBySensitivity(answers: FieldAnswer[]): {
  safe: FieldAnswer[];
  sensitive: FieldAnswer[];
} {
  const safe: FieldAnswer[] = [];
  const sensitive: FieldAnswer[] = [];
  for (const answer of answers) {
    (isSensitiveField(answer.field) ? sensitive : safe).push(answer);
  }
  return { safe, sensitive };
}
