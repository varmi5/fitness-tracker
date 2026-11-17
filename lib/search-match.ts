const aliases: Record<string, string> = { yoghurt: "yogurt", dal: "dhal" };

function words(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean).map((word) => aliases[word] ?? word);
}

// One mistyped, missing, or transposed letter is enough for short food names.
function near(a: string, b: string) {
  if (a.length < 3 || b.length < 3 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const different = [...a].map((char, i) => char === b[i] ? -1 : i).filter((i) => i !== -1);
    return different.length <= 1 || (different.length === 2 && different[1] === different[0] + 1 &&
      a[different[0]] === b[different[1]] && a[different[1]] === b[different[0]]);
  }
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  return short.slice(i) === long.slice(i + 1);
}

export function foodMatchScore(name: string, query: string): number {
  const terms = words(query);
  if (!terms.length) return 0;
  const candidates = words(name);
  let score = 0;
  for (const term of terms) {
    const scores = candidates.map((word) => word === term ? 0 : word.startsWith(term) ? 1 :
      word.includes(term) ? 2 : near(term, word) ? 3 : Infinity);
    const best = Math.min(...scores);
    if (!Number.isFinite(best)) return Infinity;
    score += best;
  }
  return score;
}
