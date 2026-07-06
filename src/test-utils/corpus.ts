/**
 * Corpus-gated `describe`.
 *
 * The real-novel fixtures in `reference/example_novels` (9 pirated txt books,
 * 0.7–15MB each) are **gitignored**, so they exist on the developer machine
 * but NOT in CI. Tests that read them are wrapped in `describeCorpus`, which
 * runs them locally (strict verification against the real books) and skips
 * them cleanly where the corpus is absent (CI). The synthetic / in-memory
 * tests always run and are what gate OTA publishing.
 *
 * Set `SKIP_CORPUS_TESTS=1` to force-skip locally (to mirror CI).
 */
import fs from 'fs';
import path from 'path';

export const NOVELS_DIR = path.resolve(__dirname, '../../reference/example_novels');

export const hasCorpus =
  process.env.SKIP_CORPUS_TESTS !== '1' && fs.existsSync(NOVELS_DIR);

/** `describe` locally when the corpus is present; `describe.skip` when absent. */
export const describeCorpus = hasCorpus ? describe : describe.skip;
