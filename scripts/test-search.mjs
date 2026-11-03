import assert from "node:assert/strict";
import { normalizeSearch, rankSearch } from "../src/lib/search.ts";
const entries = [
  { id: "accent", group: "settings", title: "Akzentfarbe", description: "Einstellungen · Darstellung", keywords: "Accent color violet orange", target: { page: "settings" } },
  { id: "notifications", group: "settings", title: "Benachrichtigungen", description: "Meldungen", target: { page: "settings" } },
  { id: "audio", group: "features", title: "Mikrofon", description: "OBS", keywords: "microphone volume lautstärke", target: { page: "obs" } },
  { id: "settings", group: "pages", title: "Einstellungen", description: "System", target: { page: "settings" } },
  { id: "chat", group: "chat", title: "Zoé", description: "Hello world", target: { page: "chat" } },
];
assert.equal(normalizeSearch("Grüße, ÉTÉ!"), "grusse ete");
assert.equal(rankSearch(entries, "akzentfrabe")[0]?.id, "accent", "transposed letters");
assert.equal(rankSearch(entries, "change accent color")[0]?.id, "accent", "natural phrasing and English aliases");
assert.equal(rankSearch(entries, "lautstarke obs")[0]?.id, "audio", "accent-insensitive multi-term search");
assert.equal(rankSearch(entries, "zoe")[0]?.id, "chat", "accent-insensitive usernames");
assert.equal(rankSearch(entries, "hello", "settings").length, 0, "category boundary");
assert.deepEqual(rankSearch(entries, "").map((entry) => entry.id), ["settings"], "empty search shows navigation");
assert.equal(rankSearch(entries, "zzzzzzzzzz").length, 0, "unrelated words have no matches");
assert.equal(rankSearch([], "test").length, 0, "empty index");
assert.equal(rankSearch(entries, "   ").length, 1, "whitespace query");
assert.equal(rankSearch([
  { id: "service", group: "features", title: "OBS", description: "Connection", target: { page: "connections" } },
  { id: "page", group: "pages", title: "OBS Control", description: "Scenes and audio", target: { page: "obs" } },
], "obs")[0]?.id, "page", "navigation outranks a similarly named service");
console.log("Search behavior: 11 assertions passed");
