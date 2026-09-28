/**
 * What a model answers is not yet a commit message. The preamble it was told
 * not to write, the fences it was told not to use and the trailing period
 * are removed here, and an answer with nothing left gets a plain fallback
 * rather than an empty commit.
 */

export const SUBJECT_MAX = 72;
export const COMMIT_FALLBACK = "Update project files";
export const PULL_REQUEST_FALLBACK = "Update project";

/** A line the model narrates with rather than answers with. */
const NARRATION = /^\s*(generating|thinking|here(?:'s| is)|sure|certainly|okay|ok)\b[^\n]*$/i;

/** Fences gone, narration gone, whitespace trimmed. */
export function cleanupText(raw: string): string {
  let text = raw.replaceAll("\r\n", "\n").trim();
  // A whole answer wrapped in one fence, with or without a language.
  const wrapped = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(text);
  if (wrapped?.[1] !== undefined) text = wrapped[1];
  // Fences left inside it are lines of their own and carry nothing.
  const lines = text.split("\n").filter((line) => !/^\s*```/.test(line));
  while (lines.length > 0 && (NARRATION.test(lines[0] ?? "") || (lines[0] ?? "").trim() === "")) {
    lines.shift();
  }
  return lines.join("\n").trim();
}

/** A subject line: at most 72 characters cut at a word, no trailing period. */
export function cleanupSubject(line: string, fallback: string): string {
  let subject = line
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(subject|title|commit message|commit)\s*:\s*/i, "")
    .trim();
  if (subject.length > SUBJECT_MAX) {
    const cut = subject.slice(0, SUBJECT_MAX);
    const space = cut.lastIndexOf(" ");
    subject = (space > SUBJECT_MAX / 2 ? cut.slice(0, space) : cut).trim();
  }
  subject = subject.replace(/[.\s]+$/, "");
  return subject === "" ? fallback : subject;
}

export function cleanupCommitMessage(raw: string): string {
  const text = cleanupText(raw);
  const [first = "", ...rest] = text.split("\n");
  const subject = cleanupSubject(first, COMMIT_FALLBACK);
  const body = rest.join("\n").trim();
  return body === "" ? subject : `${subject}\n\n${body}`;
}

export function cleanupPullRequest(raw: string): { title: string; body: string } {
  const text = cleanupText(raw);
  const [first = "", ...rest] = text.split("\n");
  return {
    title: cleanupSubject(first.replace(/^#+\s*/, ""), PULL_REQUEST_FALLBACK),
    body: rest.join("\n").trim(),
  };
}
