// NOTE: single cosine-similarity implementation for the API.
//
// Previously duplicated in `RetrievalService` and `semantic.chunking.ts`
// with subtly different zero-vector guards. Both call sites now import
// from here so ranking semantics cannot drift between retrieval and
// semantic chunking.

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b) return 0;
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) {
    throw new Error(
      `Embedding dimension mismatch: ${a.length} vs ${b.length}`,
    );
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = a.length;
  for (let i = 0; i < length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
