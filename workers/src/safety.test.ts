import { test } from "node:test";
import assert from "node:assert/strict";
import { isSensitiveField, partitionBySensitivity } from "./safety.js";

test("flags sensitive fields", () => {
  for (const field of [
    "Salary expectation",
    "Do you require visa sponsorship?",
    "Disability status",
    "Gender",
    "Social Security Number",
  ]) {
    assert.equal(isSensitiveField(field), true, `expected sensitive: ${field}`);
  }
});

test("allows ordinary fields", () => {
  for (const field of ["First name", "Email", "LinkedIn URL", "Years of experience"]) {
    assert.equal(isSensitiveField(field), false, `expected safe: ${field}`);
  }
});

test("partitions answers by sensitivity", () => {
  const { safe, sensitive } = partitionBySensitivity([
    { field: "First name", value: "Aden" },
    { field: "Salary expectation", value: "100000" },
  ]);
  assert.equal(safe.length, 1);
  assert.equal(sensitive.length, 1);
  assert.equal(sensitive[0].field, "Salary expectation");
});
