export let db;
let revision,
  timer,
  pending = false,
  running = false,
  conflict = false;
export const hasSaveConflict = () => conflict;
export const uid = () => crypto.randomUUID();
export const byId = (list, id) => list.find((object) => object.id === id);
export const board = (id) => byId(db.boards, id);
export const note = (id) => byId(db.notes, id);
export const doc = (id) => byId(db.documents, id);
export const ancestors = (id) => {
  const path = [];
  for (let b = board(id); b && !path.includes(b); b = board(b.parent))
    path.unshift(b);
  return path;
};
export const members = (b, id) =>
  b.items.filter((i) => (i.parent || null) === (id || null));
export function leaves(b, item) {
  if (item.kind === "note") return [item.ref];
  if (item.kind !== "section") return [];
  return members(b, item.id)
    .sort((a, c) => (item.layout === "stack" ? 0 : a.col - c.col))
    .flatMap((i) => leaves(b, i));
}
export function appearances(ref) {
  return db.boards.filter((b) =>
    b.items.some((i) => i.kind === "note" && i.ref === ref),
  );
}
export function createItem(b, kind, values = {}) {
  const i = { id: uid(), kind, x: 0, y: 0, parent: null, col: 0, ...values };
  b.items.push(i);
  return i;
}
export function addAppearance(b, ref, values) {
  const existing = b.items.find(
    (i) =>
      i.kind === "note" &&
      i.ref === ref &&
      i.parent === (values.parent || null),
  );
  return existing || createItem(b, "note", { ref, ...values });
}
export function newNote(values) {
  const n = { id: uid(), title: "", body: "", ...values };
  db.notes.unshift(n);
  return n;
}
export function createBoard(name, parent = null) {
  const b = { id: uid(), name, parent, items: [] };
  db.boards.push(b);
  return b;
}
export async function start() {
  const res = await fetch("/api/workspace");
  if (!res.ok) throw Error("Could not open the workspace.");
  const data = await res.json();
  db = data.state;
  revision = data.version;
}
export function save() {
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(flush, 90);
}
async function flush() {
  if (!pending || running || conflict) return;
  pending = false;
  running = true;
  try {
    const r = await fetch("/api/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: revision, state: db }),
    });
    if (r.status === 409) {
      conflict = true;
      throw Error(
        "Another window saved changes. Download this copy, then reload to use the latest workspace.",
      );
    }
    if (!r.ok)
      throw Error(
        "Could not save the workspace. Check the local server and try again.",
      );
    revision = (await r.json()).version;
  } catch (e) {
    pending = true;
    window.dispatchEvent(new CustomEvent("save-error", { detail: e.message }));
    running = false;
    return;
  }
  running = false;
  if (pending) flush();
}
window.addEventListener("beforeunload", (e) => {
  if (pending || running) {
    e.preventDefault();
    e.returnValue = "";
  }
});
export function words(s) {
  return new Set(
    (s.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(
      (w) =>
        ![
          "the",
          "and",
          "for",
          "how",
          "what",
          "that",
          "with",
          "have",
          "are",
          "this",
          "from",
          "they",
          "you",
        ].includes(w),
    ),
  );
}
export function relevance(n, b) {
  const context = words(
    [
      b.name,
      ...b.items
        .filter((i) => i.kind === "note")
        .map((i) => note(i.ref)?.title || ""),
    ].join(" "),
  );
  let score = 0;
  for (const w of words(n.title + " " + n.body)) if (context.has(w)) score++;
  const present = new Set(
    b.items.filter((i) => i.kind === "note").map((i) => i.ref),
  );
  return (
    score +
    4 *
      db.edges.filter(
        (e) =>
          (e.source === n.id && present.has(e.target)) ||
          (e.target === n.id && present.has(e.source)),
      ).length
  );
}
