// Instant product search: by code (exact / prefix / partial) or by keywords.
import { productLabel, seriesLabel } from "./common.js";

const norm = (s) => String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const squash = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// common words people type -> words used in the price lists
const SYNONYMS = {
  wc: ["wc", "closet", "toilet", "ewc"], commode: ["wc", "closet", "ewc", "toilet"], toilet: ["toilet", "wc", "closet"],
  tap: ["tap", "cock"], mixer: ["mixer"], shower: ["shower"], basin: ["basin"], sink: ["sink"],
  gold: ["gold"], rosegold: ["rose gold"], black: ["black"], chrome: ["chrome", "cp"],
};

let index = [];

export function buildIndex(products) {
  index = products.map((p) => ({
    p,
    code: squash(p.code),
    alts: (p.alt_codes || []).map(squash),
    hay: " " + norm([p.code, ...(p.alt_codes || []), productLabel(p), seriesLabel(p), p.series, p.sub_category,
      p.category, p.collection, p.finish, p.colour, p.details].join(" ")) + " ",
    name: " " + norm(productLabel(p) + " " + p.series) + " ",
  }));
}

export function search(q, limit = 40) {
  const raw = q.trim();
  if (!raw) return [];
  const sq = squash(raw);
  const words = norm(raw).split(" ").filter(Boolean);
  const out = [];
  for (const e of index) {
    let score = 0;
    if (sq.length >= 2) {
      if (e.code === sq) score = 1000;
      else if (e.alts.includes(sq)) score = 900;
      else if (e.code.startsWith(sq)) score = 700 - (e.code.length - sq.length);
      else if (e.alts.some((a) => a.startsWith(sq))) score = 600;
      else if (sq.length >= 4 && /\d/.test(sq) && e.code.includes(sq)) score = 500;
    }
    if (!score && words.length) {
      let all = true, nameHits = 0;
      for (const w of words) {
        const alts = SYNONYMS[w] || [w];
        const hit = alts.some((a) => e.hay.includes(" " + a));
        if (!hit) { all = false; break; }
        if (alts.some((a) => e.name.includes(" " + a))) nameHits++;
      }
      if (all) score = 100 + nameHits * 10;
    }
    if (score) out.push({ e, score });
  }
  // a WC/basin sold as a set: the complete set first, then the bowl/basin alone, then loose parts
  const rank = (p) => ({ set: 0, single: 2, part: 3 }[p.kind] ?? 1);
  // loose parts (seat covers, cisterns, pedestals) come after the products themselves in word searches
  const isPart = (p) => (p.kind === "part" ? 1 : 0);
  out.sort((a, b) => b.score - a.score || isPart(a.e.p) - isPart(b.e.p) || a.e.p.code.localeCompare(b.e.p.code) ||
    rank(a.e.p) - rank(b.e.p) || a.e.p.mrp - b.e.p.mrp);
  // same code + option listed under several series -> show once
  const seen = new Set(), res = [];
  for (const { e } of out) {
    const k = e.p.code + "|" + e.p.variant + "|" + e.p.mrp;
    if (seen.has(k)) continue;
    seen.add(k);
    res.push(e.p);
    if (res.length >= limit) break;
  }
  return res;
}

export function highlight(text, q) {
  const words = norm(q).split(" ").filter((w) => w.length > 1);
  let html = String(text).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  for (const w of words) {
    html = html.replace(new RegExp("(" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig"), "<mark>$1</mark>");
  }
  return html;
}
