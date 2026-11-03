export type SearchGroup = "pages" | "settings" | "features" | "activity" | "chat";
export type SearchTarget = { page: string; label?: string; filter?: string; itemId?: string };
export type SearchEntry = {
  id: string; group: SearchGroup; title: string; description: string;
  keywords?: string; target: SearchTarget;
};
export const searchGroups: SearchGroup[] = ["pages", "settings", "features", "activity", "chat"];
export function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function closeWord(a: string, b: string) {
  const limit = a.length >= 7 ? 2 : 1;
  if (a.length < 4 || a.length > 40 || Math.abs(a.length - b.length) > limit) return false;
  const rows = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) rows[i][0] = i;
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    rows[i][j] = Math.min(rows[i-1][j]+1, rows[i][j-1]+1, rows[i-1][j-1]+(a[i-1] === b[j-1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]) rows[i][j] = Math.min(rows[i][j], rows[i-2][j-2]+1);
  }
  return rows[a.length][b.length] <= limit;
}
const stopWords = new Set("the a an my for to change set show find search die der das den meine mein fur zu andern einstellen zeigen suchen le la les mon ma pour changer afficher chercher el los las mi para cambiar buscar o os as meu minha mudar alterar pesquisar".split(" "));
export function rankSearch(entries: SearchEntry[], query: string, scope: SearchGroup | "all" = "all") {
  const phrase = normalizeSearch(query);
  const allTokens = phrase.split(" ").filter(Boolean);
  const meaningful = allTokens.filter((token) => !stopWords.has(token));
  const tokens = meaningful.length ? meaningful : allTokens;
  return entries.flatMap((entry) => {
    if (scope !== "all" && entry.group !== scope) return [];
    if (!phrase) return entry.group === "pages" || scope !== "all" ? [{ ...entry, score: 0 }] : [];
    const title = normalizeSearch(entry.title);
    const extra = normalizeSearch(`${entry.description} ${entry.keywords ?? ""}`);
    const words = `${title} ${extra}`.split(" ");
    let score = title === phrase ? 200 : title.startsWith(phrase) ? 120 : title.includes(phrase) ? 90 : 0;
    if (entry.group === "pages" && title.startsWith(phrase)) score += 85;
    for (const token of tokens) {
      if (title.split(" ").some((word) => word === token)) score += 35;
      else if (title.includes(token)) score += 25;
      else if (extra.includes(token)) score += 12;
      else if (words.some((word) => closeWord(token, word))) score += 3;
      else return [];
    }
    return [{ ...entry, score }];
  }).sort((a, b) => b.score - a.score);
}
