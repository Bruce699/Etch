import { board, db, doc, members, note } from "./store.js";
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const icon = (name) =>
  '<i class="icon" aria-hidden="true" style="--icon:url(../assets/icons/' +
  esc(name) +
  '.svg)"></i>';
export function btn(action, label, symbol = "", content = "", data = "") {
  return (
    '<button type="button" data-action="' +
    action +
    '" aria-label="' +
    esc(label) +
    '" title="' +
    esc(label) +
    '" ' +
    data +
    ">" +
    iconIf(symbol) +
    content +
    "</button>"
  );
}
const iconIf = (name) => (name ? icon(name) : "");
export const colors = {
  white: "#fbfdff",
  pink: "#fce9f2",
  green: "#e1f6df",
  peach: "#fbe8da",
  lilac: "#ece8fb",
  butter: "#fff3cc",
  blue: "#e3effc",
};
export const safeURL = (value) => {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) ? u.href : "";
  } catch {
    return "";
  }
};
const dataImage = /^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i;
export const safeImage = (s) =>
  s && (dataImage.test(s) || /^assets\/[\w.-]+\.(png|jpg|webp)$/.test(s))
    ? s
    : "";
export function noteContent(n) {
  if (!n) return "";
  const href = safeURL(n.url),
    image = safeImage(n.image),
    logo = safeImage(n.logo);
  return (
    (image
      ? '<img class="note-art" alt="" draggable="false" src="' +
        esc(image) +
        '">'
      : "") +
    '<div class="note-copy">' +
    (n.title ? '<div class="note-title">' + esc(n.title) + "</div>" : "") +
    (n.body ? '<div class="note-body">' + esc(n.body) + "</div>" : "") +
    (href
      ? '<a class="source-link" target="_blank" rel="noreferrer" href="' +
        esc(href) +
        '">' +
        (logo ? '<img alt="" src="' + esc(logo) + '">' : icon("link-simple")) +
        esc(new URL(href).hostname.replace(/^www\./, "")) +
        "</a>"
      : "") +
    "</div>"
  );
}
export function noteCard(n, attrs = "") {
  return (
    '<article class="card note-card" style="--paper:' +
    colors[n.color || "white"] +
    '" ' +
    attrs +
    ">" +
    noteContent(n) +
    "</article>"
  );
}
export function preview(b, shallow = false) {
  if (!b) return "";
  return (
    '<div class="preview-window" data-preview="' +
    esc(b.id) +
    '"><div class="preview-world world">' +
    scene(b, true, shallow ? 0 : 1) +
    "</div></div>"
  );
}
function card(b, i, mini, depth) {
  const pos = !i.parent
    ? "left:" + Number(i.x) + "px;top:" + Number(i.y) + "px;"
    : "";
  const attrs =
    'data-item="' +
    esc(i.id) +
    '" data-kind="' +
    esc(i.kind) +
    '"' +
    (mini ? "" : ' tabindex="0" role="group"');
  const head = (inner, classes, style = "") =>
    '<div class="item ' +
    (i.parent ? "nested " : "placed ") +
    classes +
    '" ' +
    attrs +
    ' style="' +
    pos +
    style +
    '">' +
    inner +
    "</div>";
  if (i.kind === "section") {
    const kids = members(b, i.id),
      columns =
        i.layout === "stack" ? 1 : Math.max(1, Math.min(8, i.columns || 2));
    const col = (k) =>
      '<div class="group-column" data-column="' +
      k +
      '">' +
      kids
        .filter(
          (n) => (columns === 1 ? 0 : Math.min(n.col || 0, columns - 1)) === k,
        )
        .map((n) => card(b, n, mini, depth))
        .join("") +
      "</div>";
    return head(
      '<div class="section-name">' +
        esc(i.name) +
        " " +
        icon("dots-six-vertical") +
        '</div><div class="columns">' +
        Array.from({ length: columns }, (_, k) => col(k)).join("") +
        "</div>",
      "group" + (kids.length ? "" : " empty-group"),
    );
  }
  if (i.kind === "note") {
    const n = note(i.ref);
    if (!n) return "";
    return head(
      noteContent(n) +
        (mini
          ? ""
          : '<button class="port" data-port="' +
            esc(i.id) +
            '" title="Drag a connection" aria-label="Drag a connection"></button>'),
      "card note-card",
      "--paper:" + (colors[n.color] || colors.white) + ";",
    );
  }
  if (i.kind === "board") {
    const child = board(i.ref);
    if (!child) return "";
    return head(
      (depth > 0
        ? preview(child, true)
        : '<div class="mini-placeholder">' + icon("rectangle") + "</div>") +
        '<div class="board-caption">' +
        esc(child.name) +
        "</div>",
      "card board-tile",
    );
  }
  const d = doc(i.ref);
  if (!d) return "";
  const body = d.sections
    .map(
      (s) =>
        "<b>" +
        esc(s.heading) +
        "</b><ul>" +
        s.points.map((p) => "<li>" + esc(p) + "</li>").join("") +
        "</ul>",
    )
    .join("");
  return head(
    '<div class="doc-label">' +
      icon("file-text") +
      esc(d.prompt) +
      '</div><div class="doc-head">' +
      esc(d.title) +
      icon("corners-out") +
      '</div><div class="doc-mini">' +
      body +
      "</div>",
    "card doc-tile",
  );
}
export function scene(b, mini = false, depth = 1) {
  return (
    '<svg class="wires" aria-hidden="true"></svg>' +
    members(b, null)
      .map((i) => card(b, i, mini, depth))
      .join("")
  );
}
export function ownItems(world) {
  return [...world.querySelectorAll("[data-item]")].filter(
    (el) => el.closest(".world") === world,
  );
}
export function worldBounds(world, scale = 1) {
  const origin = world.getBoundingClientRect();
  const rects = ownItems(world)
    .filter((el) => el.classList.contains("placed"))
    .map((el) => el.getBoundingClientRect());
  if (!rects.length) return { x: 0, y: 0, w: 480, h: 220 };
  const x = (Math.min(...rects.map((r) => r.left)) - origin.left) / scale;
  const y = (Math.min(...rects.map((r) => r.top)) - origin.top) / scale;
  return {
    x,
    y,
    w: (Math.max(...rects.map((r) => r.right)) - origin.left) / scale - x,
    h: (Math.max(...rects.map((r) => r.bottom)) - origin.top) / scale - y,
  };
}
export function paintPreviews(root = document) {
  for (const el of [...root.querySelectorAll("[data-preview]")].reverse()) {
    const world = el.firstElementChild;
    const outerScale = el.offsetWidth
      ? el.getBoundingClientRect().width / el.offsetWidth
      : 1;
    if (!outerScale || !el.clientHeight) continue;
    const old = Number(world.dataset.scale || 1),
      box = worldBounds(world, old * outerScale);
    const scale = Math.min(
      (el.clientWidth - 22) / Math.max(1, box.w),
      (el.clientHeight - 20) / Math.max(1, box.h),
      0.6,
    );
    if (scale <= 0) continue;
    const x = (el.clientWidth - box.w * scale) / 2 - box.x * scale,
      y = (el.clientHeight - box.h * scale) / 2 - box.y * scale;
    world.dataset.scale = scale;
    world.style.transform =
      "translate(" + x + "px," + y + "px) scale(" + scale + ")";
    el.dataset.fit = JSON.stringify({ x, y, scale, box });
    drawEdges(board(el.dataset.preview), world, scale * outerScale);
  }
}
export function drawEdges(b, world, scale = 1) {
  if (!b || !scale) return;
  const svg = world.querySelector(":scope > .wires"),
    origin = world.getBoundingClientRect(),
    els = ownItems(world);
  const rects = new Map(
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return [
        el.dataset.item,
        {
          x: (r.x - origin.x) / scale,
          y: (r.y - origin.y) / scale,
          w: r.width / scale,
          h: r.height / scale,
        },
      ];
    }),
  );
  let content = "";
  function line(a, z, id, label, dashed = false) {
    if (!a || !z) return;
    const dx = z.x + z.w / 2 - a.x - a.w / 2,
      dy = z.y + z.h / 2 - a.y - a.h / 2,
      vertical = Math.abs(dy) > Math.abs(dx) * 0.7;
    const dir = Math.sign(vertical ? dy : dx) || 1;
    let x = a.x + a.w / 2,
      y = a.y + a.h / 2,
      x2 = z.x + z.w / 2,
      y2 = z.y + z.h / 2;
    if (vertical) {
      y += (dir * a.h) / 2;
      y2 -= (dir * z.h) / 2;
    } else {
      x += (dir * a.w) / 2;
      x2 -= (dir * z.w) / 2;
    }
    const bend =
      Math.max(55, Math.abs(vertical ? y2 - y : x2 - x) * 0.45) * dir;
    const bx = vertical ? 0 : bend,
      by = vertical ? bend : 0;
    const path =
      "M " +
      x +
      " " +
      y +
      " C " +
      (x + bx) +
      " " +
      (y + by) +
      " " +
      (x2 - bx) +
      " " +
      (y2 - by) +
      " " +
      x2 +
      " " +
      y2;
    const midx = (x + x2) / 2,
      midy = (y + y2) / 2,
      w = Math.min(370, Math.max(96, label.length * 6.4 + 18));
    content +=
      '<g class="wire' +
      (dashed ? " document-wire" : "") +
      '" data-edge="' +
      esc(id) +
      '"><path class="wire-hit" d="' +
      path +
      '"/><path class="wire-line" d="' +
      path +
      '"/><circle cx="' +
      x +
      '" cy="' +
      y +
      '" r="2.3"/><path class="arrow" d="M -5 -3 L 0 0 L -5 3" transform="translate(' +
      x2 +
      " " +
      y2 +
      ") rotate(" +
      (vertical ? dir * 90 : dir > 0 ? 0 : 180) +
      ')"/>';
    if (label)
      content +=
        '<g class="edge-label" transform="translate(' +
        midx +
        " " +
        midy +
        ')"><rect x="' +
        -w / 2 +
        '" y="-10" width="' +
        w +
        '" height="20" rx="4"/><text text-anchor="middle" y="3.5">' +
        esc(label.slice(0, 55)) +
        "</text></g>";
    content += "</g>";
  }
  for (const e of db.edges) {
    const starts = b.items.filter(
        (i) => i.kind === "note" && i.ref === e.source,
      ),
      ends = b.items.filter((i) => i.kind === "note" && i.ref === e.target);
    for (const a of starts) {
      const z = ends.find((i) => i.parent === a.parent) || ends[0];
      if (z) line(rects.get(a.id), rects.get(z.id), e.id, e.label);
    }
  }
  for (const i of b.items.filter((i) => i.kind === "doc")) {
    const d = doc(i.ref);
    if (d) line(rects.get(d.origin), rects.get(i.id), "", "", true);
  }
  svg.innerHTML = content;
}
