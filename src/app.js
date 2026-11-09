import {
  db,
  start,
  save,
  hasSaveConflict,
  uid,
  board,
  note,
  doc,
  byId,
  members,
  leaves,
  ancestors,
  appearances,
  createBoard,
  createItem,
  newNote,
  addAppearance,
  relevance,
} from "./store.js";
import {
  esc,
  icon,
  btn,
  colors,
  noteCard,
  preview,
  scene,
  paintPreviews,
  drawEdges,
  ownItems,
  worldBounds,
  safeImage,
  safeURL,
} from "./view.js";
import { installGestures } from "./gestures.js";

const $ = (s) => document.querySelector(s),
  app = $("#app"),
  overlay = $("#overlay");
const small = () => matchMedia("(max-width:680px)").matches;
const ui = {
  id: null,
  rail: !small(),
  panel: null,
  editor: null,
  full: false,
  sel: [],
  source: [],
  tool: "select",
  link: null,
  query: "",
  relevant: false,
  cam: { x: 40, y: 55, k: 1 },
  views: {},
  folded: new Set(),
  expanded: false,
  busy: null,
};
let engine = "Local extractive outline",
  draft = { title: "", body: "", image: "" },
  toastTimer,
  hoverTimer,
  popupAnchor,
  activeFormat = null;
const current = () => board(ui.id),
  chosen = () => current()?.items.filter((i) => ui.sel.includes(i.id)) || [];
const qitem = (id) =>
  ownItems($("#world")).find((el) => el.dataset.item === id);
const menuRow = (a, label, sym = "", data = "") =>
  btn(a, label, sym, esc(label), 'class="menu-row" ' + data);
const attr = (key, id) => "data-" + key + '="' + esc(id) + '"';
const findNoteIds = () => [
  ...new Set(chosen().flatMap((i) => leaves(current(), i))),
];
const makeNoteTitle = (n) => n.title || n.body.slice(0, 55) || "Image note";

function tell(text) {
  clearTimeout(toastTimer);
  $("#notice").innerHTML = '<div class="save-status">' + esc(text) + "</div>";
  toastTimer = setTimeout(() => $("#notice").replaceChildren(), 3500);
}
function closePopup() {
  document
    .querySelectorAll(".popover,.live-preview")
    .forEach((e) => e.remove());
  popupAnchor = null;
}
function closeDialog() {
  overlay.querySelector(".scrim")?.remove();
  if (popupAnchor?.isConnected) popupAnchor.focus?.();
}
function popup(anchor, html) {
  closePopup();
  const el = document.createElement("div");
  el.className = "popover";
  el.innerHTML = html;
  overlay.append(el);
  popupAnchor = anchor;
  const r = anchor?.getBoundingClientRect() || {
    left: innerWidth / 2,
    top: innerHeight / 2,
    bottom: innerHeight / 2,
  };
  function place() {
    if (!el.isConnected) return;
    el.style.left =
      Math.max(7, Math.min(r.left, innerWidth - el.offsetWidth - 7)) + "px";
    el.style.top =
      (r.bottom + 6 + el.offsetHeight < innerHeight
        ? r.bottom + 6
        : Math.max(6, r.top - el.offsetHeight - 6)) + "px";
  }
  place();
  requestAnimationFrame(place);
  return el;
}
function dialog(title, content, wide = false) {
  closePopup();
  closeDialog();
  const el = document.createElement("div");
  el.className = "scrim";
  el.innerHTML =
    '<section class="dialog ' +
    (wide ? "wide" : "") +
    '" role="dialog" aria-modal="true" aria-label="' +
    esc(title) +
    '"><div class="modal-head"><h2>' +
    esc(title) +
    "</h2>" +
    btn("dismiss", "Close", "x") +
    "</div>" +
    content +
    "</section>";
  overlay.append(el);
  requestAnimationFrame(() =>
    el
      .querySelector(
        "input:not([type=file]),textarea,select,.dialog-body button,.modal-head button",
      )
      ?.focus(),
  );
  return el;
}
function nameDialog(title, placeholder, initial, done) {
  const el = dialog(
    title,
    '<form><input aria-label="' +
      esc(placeholder) +
      '" placeholder="' +
      esc(placeholder) +
      '" required maxlength="120" value="' +
      esc(initial) +
      '"><div class="dialog-actions">' +
      btn("dismiss", "Cancel", "", "Cancel", 'class="action"') +
      '<button class="primary">Save</button></div></form>',
  );
  const input = el.querySelector("input");
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
  el.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    closeDialog();
    done(input.value.trim());
  };
}
function download(name, content, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function saveAndRender() {
  const oldWorld = $("#world");
  const positions = oldWorld
    ? new Map(
        ownItems(oldWorld).map((el) => [
          el.dataset.item,
          el.getBoundingClientRect(),
        ]),
      )
    : null;
  save();
  render();
  if (
    !positions ||
    !$("#world") ||
    matchMedia("(prefers-reduced-motion:reduce)").matches
  )
    return;
  for (const el of ownItems($("#world")).filter(
    (el) => el.dataset.kind !== "section",
  )) {
    const old = positions.get(el.dataset.item);
    if (!old) continue;
    const now = el.getBoundingClientRect(),
      x = (old.left - now.left) / ui.cam.k,
      y = (old.top - now.top) / ui.cam.k;
    if (Math.abs(x) + Math.abs(y) > 3 && Math.abs(x) + Math.abs(y) < 1600)
      el.animate(
        [
          { transform: "translate(" + x + "px," + y + "px)" },
          { transform: "translate(0,0)" },
        ],
        { duration: 210, easing: "cubic-bezier(.2,.75,.25,1)" },
      );
  }
}
function nav(id = null, focus = null) {
  if (
    $(".composer") &&
    (draft.title.trim() || draft.body.trim() || draft.image)
  )
    capture(false);
  if (ui.id) ui.views[ui.id] = { ...ui.cam };
  if (id && !board(id)) return;
  ui.id = id;
  ui.sel = focus ? [focus] : [];
  ui.panel = null;
  ui.editor = null;
  ui.full = false;
  ui.source = [];
  ui.tool = "select";
  ui.link = null;
  ui.query = "";
  ui.rail = id ? false : !small();
  ui.cam = ui.views[id] || { x: 34, y: 60, k: 1 };
  closeDialog();
  closePopup();
  if (id && db.recent[0] !== id) {
    db.recent = [id, ...db.recent.filter((x) => x !== id)];
    save();
  }
  const hash = id ? "#canvas/" + encodeURIComponent(id) : "#inbox";
  if (location.hash !== hash) history.pushState({}, "", hash);
  render();
  if (id && !ui.views[id]) fit();
  if (focus) focusItems([focus]);
}
function tree(parent = null, depth = 0) {
  return db.boards
    .filter((b) => b.parent === parent)
    .map((b) => {
      const kids = db.boards.some((c) => c.parent === b.id),
        fold = ui.folded.has(b.id);
      return (
        '<div class="tree-line ' +
        (b.id === ui.id ? "active" : "") +
        '" style="--depth:' +
        depth +
        '" data-dest="' +
        b.id +
        '">' +
        (kids
          ? btn(
              "fold",
              fold ? "Expand " + b.name : "Collapse " + b.name,
              fold ? "caret-right" : "caret-down",
              "",
              attr("id", b.id) + ' class="tree-toggle"',
            )
          : '<span class="tree-toggle">' +
            (depth === 0 ? icon("caret-right") : "") +
            "</span>") +
        btn(
          "go",
          b.name,
          "",
          esc(b.name),
          attr("id", b.id) + ' class="tree-name"',
        ) +
        "</div>" +
        (!fold ? tree(b.id, depth + 1) : "")
      );
    })
    .join("");
}
function sidebar() {
  return (
    '<aside class="rail"><div class="rail-top">' +
    btn("home", "Etch inbox", "", "Etch", 'class="brand"') +
    btn("rail", "Collapse sidebar", "sidebar-simple") +
    '</div><label class="searchbox">' +
    icon("magnifying-glass") +
    '<input id="global-search" aria-label="Search workspace" placeholder="Search" autocomplete="off"></label><div class="rail-label">Canvases' +
    btn("new-board", "New canvas", "plus") +
    '</div><nav class="tree" aria-label="Canvases">' +
    tree() +
    '</nav><div class="foot"><span>' +
    esc(db.profile) +
    "</span>" +
    btn("settings", "Workspace settings", "gear") +
    "</div></aside>"
  );
}
function top() {
  return (
    '<div class="top-actions">' +
    btn("inbox", "Note inbox", "tray") +
    btn("documents", "Documents", "file-text") +
    "</div>"
  );
}
function composer() {
  return (
    '<div class="card composer ' +
    (draft.title || draft.body || draft.image ? "has-draft" : "") +
    '"><input id="capture-title" placeholder="New Note" aria-label="New note title" value="' +
    esc(draft.title) +
    '"><textarea id="capture-body" rows="2" aria-label="New note body" placeholder="Start writing…">' +
    esc(draft.body) +
    "</textarea>" +
    (draft.image
      ? '<img class="attachment-preview" src="' +
        esc(draft.image) +
        '" alt="Attached image">'
      : "") +
    '<div class="compose-actions">' +
    btn("attach-capture", "Attach image", "image") +
    btn("commit", "Save note", "arrow-elbow-down-left", "Save") +
    "</div></div>"
  );
}
function home() {
  const recents = db.recent
    .map(board)
    .filter(Boolean)
    .map(
      (b) =>
        '<button class="recent-card" data-action="go" data-id="' +
        b.id +
        '" aria-label="Open ' +
        esc(b.name) +
        '">' +
        preview(b) +
        '<div class="board-caption">' +
        esc(b.parent ? board(b.parent).name + " / " : "") +
        esc(b.name) +
        "</div></button>",
    )
    .join("");
  const count = innerWidth < 430 ? 1 : innerWidth < 1050 ? 2 : 3,
    cols = Array.from({ length: count }, () => []);
  cols[0].push(composer());
  db.notes.forEach((n, i) =>
    cols[(i + 1) % count].push(
      noteCard(
        n,
        'tabindex="0" role="button" data-home-note="' +
          n.id +
          '" aria-label="Edit ' +
          esc(makeNoteTitle(n)) +
          '"',
      ),
    ),
  );
  return (
    '<main class="home"><section><h2>Recents</h2><div class="recents">' +
    recents +
    '</div></section><section class="notes-area"><h2>All Notes</h2><div class="masonry">' +
    cols
      .map((c) => '<div class="masonry-col">' + c.join("") + "</div>")
      .join("") +
    "</div></section></main>"
  );
}
function toolbar() {
  return (
    '<div class="toolbar" aria-label="Canvas tools">' +
    [
      ["select", "Select", "cursor"],
      ["hand", "Pan canvas", "hand"],
      ["new-note", "New note", "note-blank"],
      ["connector", "Connect notes", "path"],
      ["subcanvas", "Create subcanvas", "rectangle"],
      ["more", "More canvas actions", "plus"],
    ]
      .map(([a, l, s]) =>
        btn(
          a,
          l,
          s,
          "",
          (ui.tool === a ? 'class="on" ' : "") +
            (a === "new-note" ? 'draggable="true"' : ""),
        ),
      )
      .join("") +
    '</div><div class="zoom">' +
    btn("minus", "Zoom out", "minus") +
    btn(
      "fit",
      "Fit canvas",
      "",
      Math.round(ui.cam.k * 100) + "%",
      'class="zoom-level"',
    ) +
    btn("plus", "Zoom in", "plus") +
    "</div>"
  );
}
function canvas() {
  const b = current();
  return (
    '<div class="bar">' +
    btn("rail", "Toggle sidebar", "sidebar-simple") +
    '<nav class="path" aria-label="Canvas path">' +
    ancestors(b.id)
      .map(
        (x, i) =>
          (i ? "<span>/</span>" : "") +
          btn(
            "go",
            x.name,
            "",
            esc(x.name),
            attr("id", x.id) + " " + attr("dest", x.id),
          ),
      )
      .join("") +
    btn("board-menu", "Canvas options", "caret-down") +
    '</nav></div><main class="canvas ' +
    (ui.tool === "hand"
      ? "hand"
      : ui.tool === "connector"
        ? "connect-mode"
        : "") +
    '" aria-label="' +
    esc(b.name) +
    ' canvas" tabindex="0"><div id="world" class="world">' +
    scene(b) +
    (ui.busy === b.id && ui.pendingTile
      ? '<div class="item placed card doc-tile pending-doc" style="left:' +
        ui.pendingTile.x +
        "px;top:" +
        ui.pendingTile.y +
        'px"><div class="doc-label">' +
        icon("file-text") +
        esc(ui.pendingTile.prompt) +
        '</div><div class="doc-head">Writing outline…</div><div class="skeleton-page">' +
        Array.from(
          { length: 15 },
          (_, i) =>
            '<i style="width:' +
            (i % 5 === 0 ? 46 : 75 + (i % 3) * 8) +
            '%"></i>',
        ).join("") +
        "</div></div>"
      : "") +
    "</div></main>" +
    toolbar() +
    (ui.busy === b.id
      ? '<div class="loading-doc" role="status">Writing from your notes…<div class="skeleton"></div></div>'
      : "")
  );
}
function drawerNotes() {
  const b = current(),
    query = ui.query.trim().toLowerCase();
  let notes = db.notes.filter((n) =>
    (n.title + " " + n.body).toLowerCase().includes(query),
  );
  if (ui.relevant && b)
    notes = notes
      .map((n) => [n, relevance(n, b)])
      .filter((x) => x[1] > 0)
      .sort((a, c) => c[1] - a[1])
      .map((x) => x[0]);
  return (
    (ui.relevant ? '<span class="hint">Relevant Notes</span>' : "") +
    notes
      .map((n) =>
        noteCard(
          n,
          'draggable="true" tabindex="0" role="button" data-drawer-note="' +
            n.id +
            '" aria-label="Insert ' +
            esc(makeNoteTitle(n)) +
            '"',
        ),
      )
      .join("") +
    (notes.length ? "" : '<p class="empty">No matching notes.</p>')
  );
}
function drawer() {
  return (
    '<aside class="drawer"><div class="pane-title">' +
    btn("panel-close", "Close inbox", "x") +
    '<label class="searchbox">' +
    icon("magnifying-glass") +
    '<input id="drawer-search" aria-label="Search notes" placeholder="Search Notes" value="' +
    esc(ui.query) +
    '"></label>' +
    btn(
      "relevant",
      ui.relevant ? "Show all notes" : "Show relevant notes",
      "funnel-simple",
    ) +
    '</div><div class="drawer-scroll">' +
    drawerNotes() +
    "</div></aside>"
  );
}
function safeRich(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup || "";
  function clean(node) {
    if (node.nodeType === Node.TEXT_NODE) return esc(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.localName,
      children = [...node.childNodes].map(clean).join("");
    if (tag === "br") return "<br>";
    return ["b", "strong", "i", "em", "u"].includes(tag)
      ? "<" + tag + ">" + children + "</" + tag + ">"
      : children;
  }
  return [...template.content.childNodes].map(clean).join("");
}
function markdown(d) {
  return (
    "# " +
    d.title +
    "\n\n" +
    d.sections
      .map(
        (s) =>
          "## " + s.heading + "\n\n" + s.points.map((p) => "- " + p).join("\n"),
      )
      .join("\n\n")
  );
}
function editor() {
  const d = doc(ui.editor);
  if (!d) return "";
  return (
    '<aside class="editor ' +
    (ui.full ? "expanded" : "") +
    '"><div class="editor-top">' +
    btn("close-editor", "Close document", "x") +
    '<select id="block-style" aria-label="Passage format"><option value="normal">Paragraph</option><option value="heading">Heading</option></select>' +
    [
      ["bold", "Bold", "text-b"],
      ["italic", "Italic", "text-italic"],
      ["underline", "Underline", "text-underline"],
      ["list", "Toggle list", "list-bullets"],
    ]
      .map(([a, l, s]) => btn(a, l, s))
      .join("") +
    '<span class="spacer"></span>' +
    btn("copy-doc", "Copy document", "", "Copy") +
    btn("doc-menu", "Document actions", "caret-down") +
    btn("expand", "Toggle full document", "corners-out") +
    '</div><div class="editor-content"><h1 contenteditable="plaintext-only" data-doc-field="title">' +
    esc(d.title) +
    "</h1>" +
    d.sections
      .map(
        (s, i) =>
          '<section class="passage" data-passage="' +
          i +
          '">' +
          btn(
            "reference",
            "Show source notes",
            "note",
            "",
            attr("index", i) + ' class="ref"',
          ) +
          '<h3 data-doc-field="heading" data-i="' +
          i +
          '" contenteditable="plaintext-only">' +
          esc(s.heading) +
          "</h3><" +
          (s.list === false ? "div" : "ul") +
          ">" +
          s.points
            .map(
              (p, j) =>
                "<" +
                (s.list === false ? "p" : "li") +
                ' style="' +
                (s.bold ? "font-weight:700;" : "") +
                (s.italic ? "font-style:italic;" : "") +
                (s.underline ? "text-decoration:underline;" : "") +
                (s.large ? "font-size:1.1rem;" : "") +
                '" data-doc-field="point" data-i="' +
                i +
                '" data-j="' +
                j +
                '" contenteditable="true">' +
                (s.rich?.[j] ? safeRich(s.rich[j]) : esc(p)) +
                "</" +
                (s.list === false ? "p" : "li") +
                ">",
            )
            .join("") +
          "</" +
          (s.list === false ? "div" : "ul") +
          "></section>",
      )
      .join("") +
    '</div><div class="editor-foot"><span>' +
    esc(d.engine) +
    '</span><span class="spacer"></span>' +
    btn("branch", "Branch document", "git-branch", "Branch") +
    "</div></aside>"
  );
}
function render() {
  clearTimeout(hoverTimer);
  closePopup();
  document.querySelector(".context-bar")?.remove();
  const b = current(),
    oldScroll = $(".home")?.scrollTop || 0;
  app.innerHTML =
    (ui.rail ? sidebar() : "") +
    '<div class="stage ' +
    (ui.editor ? "has-editor" : "") +
    " " +
    (ui.panel === "inbox" ? "has-drawer" : "") +
    '">' +
    (b
      ? canvas()
      : (ui.rail
          ? ""
          : '<div class="bar">' +
            btn("rail", "Open sidebar", "sidebar-simple") +
            "</div>") + home()) +
    top() +
    (ui.panel === "inbox" ? drawer() : "") +
    editor() +
    "</div>";
  if (b) applyCamera();
  if (!b && $(".home")) $(".home").scrollTop = oldScroll;
  paintPreviews(app);
  if (b) {
    drawEdges(b, $("#world"), ui.cam.k);
    selection();
  }
  document.title = (b ? b.name + " · " : "") + "Etch";
  app.removeAttribute("aria-busy");
}
function applyCamera() {
  const w = $("#world");
  if (!w) return;
  const c = ui.cam;
  w.style.transform =
    "translate(" + c.x + "px," + c.y + "px) scale(" + c.k + ")";
  if ($(".zoom-level"))
    $(".zoom-level").textContent = Math.round(c.k * 100) + "%";
}
function fit() {
  const w = $("#world"),
    v = $(".canvas");
  if (!w) return;
  const box = worldBounds(w, ui.cam.k),
    k = Math.max(
      0.1,
      Math.min(
        1.05,
        (v.clientWidth - 70) / box.w,
        (v.clientHeight - 140) / box.h,
      ),
    );
  ui.cam = {
    k,
    x: (v.clientWidth - box.w * k) / 2 - box.x * k,
    y: Math.max(65, (v.clientHeight - box.h * k) / 2) - box.y * k,
  };
  applyCamera();
  selection();
}
function worldPoint(x, y) {
  const r = $(".canvas").getBoundingClientRect();
  return {
    x: (x - r.left - ui.cam.x) / ui.cam.k,
    y: (y - r.top - ui.cam.y) / ui.cam.k,
  };
}
function center() {
  const r = $(".canvas").getBoundingClientRect();
  return worldPoint(r.x + r.width / 2, r.y + r.height / 2);
}
function zoom(factor, x, y) {
  const r = $(".canvas").getBoundingClientRect();
  x ??= r.x + r.width / 2;
  y ??= r.y + r.height / 2;
  const p = worldPoint(x, y);
  ui.cam.k = Math.max(0.08, Math.min(2.75, ui.cam.k * factor));
  ui.cam.x = x - r.x - p.x * ui.cam.k;
  ui.cam.y = y - r.y - p.y * ui.cam.k;
  applyCamera();
  selection();
}
function focusItems(ids) {
  if (!$("#world")) return;
  const els = ids.map(qitem).filter(Boolean);
  if (!els.length) return;
  const r = $(".canvas").getBoundingClientRect(),
    rects = els.map((el) => el.getBoundingClientRect());
  const left = Math.min(...rects.map((x) => x.left)),
    right = Math.max(...rects.map((x) => x.right)),
    top = Math.min(...rects.map((x) => x.top)),
    bottom = Math.max(...rects.map((x) => x.bottom));
  const p = worldPoint((left + right) / 2, (top + bottom) / 2);
  ui.cam.k = Math.max(
    0.1,
    Math.min(
      1.25,
      (r.width - 60) / ((right - left) / ui.cam.k),
      (r.height - 150) / ((bottom - top) / ui.cam.k),
    ),
  );
  ui.cam.x = r.width / 2 - p.x * ui.cam.k;
  ui.cam.y = r.height / 2 - p.y * ui.cam.k;
  applyCamera();
  selection();
}
function selection() {
  document.querySelector(".context-bar")?.remove();
  const w = $("#world");
  if (!w) return;
  for (const el of ownItems(w)) {
    el.classList.toggle("selected", ui.sel.includes(el.dataset.item));
    el.classList.toggle("source-focus", ui.source.includes(el.dataset.item));
  }
  const list = chosen();
  if (!list.length || ui.full) return;
  const el = qitem(list[0].id),
    r = el?.getBoundingClientRect(),
    v = $(".canvas").getBoundingClientRect();
  if (
    !r ||
    r.right < v.left ||
    r.left > v.right ||
    r.bottom < v.top ||
    r.top > v.bottom
  )
    return;
  const bar = document.createElement("div");
  bar.className = "context-bar";
  const i = list[0],
    multi = list.length > 1;
  let html = "";
  if (multi)
    html +=
      '<span class="count"> ' +
      list.length +
      " </span>" +
      btn("group", "Group in a section", "bounding-box") +
      btn("subcanvas", "Create subcanvas", "rectangle");
  if (!multi && i.kind === "note")
    html +=
      btn("color", "Note color", "paint-bucket") +
      btn(
        "threads",
        "Show connections",
        "path",
        String(
          db.edges.filter((e) => e.source === i.ref || e.target === i.ref)
            .length,
        ),
      ) +
      btn(
        "appearances",
        "Show appearances",
        "",
        appearances(i.ref).length + " Appearances ↗",
      ) +
      btn("edit-note", "Edit note", "pencil-simple");
  if (!multi && i.kind === "section")
    html +=
      btn("rename-section", "Rename section", "pencil-simple") +
      btn("duplicate", "Duplicate section", "copy") +
      btn("layout", "Change section layout", "columns");
  if (!multi && i.kind === "board")
    html += btn("open-child", "Open subcanvas", "arrow-square-out");
  if (!multi && i.kind === "doc")
    html +=
      btn("open-doc", "Open document", "file-text") +
      btn("branch", "Branch document", "git-branch");
  if (findNoteIds().length)
    html += btn("prompt", "Create outline", "file-text");
  html += btn("selection-more", "Selection actions", "dots-three");
  bar.innerHTML = html;
  document.body.append(bar);
  bar.style.left =
    Math.max(
      6,
      Math.min(
        innerWidth - bar.offsetWidth - 6,
        r.left + r.width / 2 - bar.offsetWidth / 2,
      ),
    ) + "px";
  const above = r.top - bar.offsetHeight - 8;
  bar.style.top =
    (above >= v.top + 4
      ? above
      : Math.min(v.bottom - bar.offsetHeight - 56, r.bottom + 8)) + "px";
}
function select(id, extend = false) {
  ui.source = [];
  ui.sel = extend
    ? ui.sel.includes(id)
      ? ui.sel.filter((v) => v !== id)
      : [...ui.sel, id]
    : id
      ? [id]
      : [];
  closePopup();
  selection();
}
function showBoardForm(sub = false) {
  const src = current(),
    ids = [...findNoteIds()];
  nameDialog(
    sub ? "Create subcanvas" : "Create canvas",
    "Canvas name",
    "",
    (name) => {
      const b = createBoard(name, sub ? src?.id : null);
      if (sub && src) {
        const selected = chosen();
        const keep = new Set(selected.map((i) => i.id));
        for (const i of src.items) {
          let p = i.parent;
          while (p) {
            if (keep.has(p)) {
              keep.add(i.id);
              break;
            }
            p = byId(src.items, p)?.parent;
          }
        }
        const originals = src.items.filter(
          (i) => keep.has(i.id) && ["note", "section"].includes(i.kind),
        );
        const points = originals.map((i) => {
          const r = qitem(i.id).getBoundingClientRect();
          return worldPoint(r.left, r.top);
        });
        const minX = Math.min(...points.map((p) => p.x)),
          minY = Math.min(...points.map((p) => p.y));
        const mapping = new Map(originals.map((i) => [i.id, uid()]));
        originals.forEach((i, j) =>
          b.items.push({
            ...i,
            id: mapping.get(i.id),
            parent: mapping.get(i.parent) || null,
            x: points[j].x - minX,
            y: points[j].y - minY,
          }),
        );
        const at = center();
        const tile = createItem(src, "board", {
          ref: b.id,
          x: at.x + 100,
          y: at.y + 90,
        });
        ui.sel = [tile.id];
        db.recent.push(b.id);
        saveAndRender();
        tell("Subcanvas created. Double-click its preview to enter.");
        return;
      }
      save();
      nav(b.id);
    },
  );
}
function groupSelected() {
  const b = current(),
    list = chosen().filter((i) => i.kind === "note" || i.kind === "section");
  if (!list.length) {
    tell("Select notes to group. Shift-click adds to your selection.");
    return;
  }
  const roots = rootsOf(b, list);
  const positions = roots.map((i) => {
    const r = qitem(i.id).getBoundingClientRect();
    return worldPoint(r.x, r.y);
  });
  const group = createItem(b, "section", {
    name: "Untitled section",
    columns: Math.min(3, roots.length),
    x: Math.min(...positions.map((p) => p.x)),
    y: Math.min(...positions.map((p) => p.y)),
  });
  roots.forEach((i, j) => {
    i.parent = group.id;
    i.col = j % group.columns;
  });
  ui.sel = [group.id];
  saveAndRender();
  nameDialog("Name section", "Section name", group.name, (name) => {
    group.name = name;
    saveAndRender();
  });
}
function copySelected() {
  const b = current(),
    list = chosen(),
    mapping = new Map(),
    added = [],
    originals = [...b.items];
  function clone(i, parent = null) {
    const r = qitem(i.id).getBoundingClientRect(),
      p = worldPoint(r.x, r.y);
    const copy = createItem(b, i.kind, {
      ...i,
      id: uid(),
      parent,
      x: p.x + (parent ? 0 : 0),
      y: p.y + (parent ? 0 : r.height / ui.cam.k + 95),
    });
    mapping.set(i.id, copy.id);
    if (!parent) added.push(copy.id);
    originals
      .filter((n) => n.parent === i.id)
      .forEach((n) => clone(n, copy.id));
  }
  rootsOf(b, list).forEach((i) => clone(i));
  ui.sel = added;
  saveAndRender();
  focusItems(added);
}
function removeSelected() {
  const b = current(),
    remove = new Set(ui.sel);
  let again = true;
  while (again) {
    again = false;
    for (const i of b.items)
      if (remove.has(i.parent) && !remove.has(i.id)) {
        remove.add(i.id);
        again = true;
      }
  }
  b.items = b.items.filter((i) => !remove.has(i.id));
  ui.sel = [];
  saveAndRender();
  tell("Removed from this canvas. Your notes are in the inbox.");
}
function rootsOf(b, items) {
  const ids = new Set(items.map((i) => i.id));
  return items.filter((i) => {
    for (let p = byId(b.items, i.parent); p; p = byId(b.items, p.parent))
      if (ids.has(p.id)) return false;
    return true;
  });
}
function moveTo(dest, copy = false, ids = ui.sel) {
  const b = current(),
    target = board(dest);
  if (!target || !b || target === b) return;
  const roots = rootsOf(
    b,
    b.items.filter(
      (i) => ids.includes(i.id) && ["note", "section"].includes(i.kind),
    ),
  );
  if (!roots.length) return;
  const inside = new Set(roots.map((i) => i.id));
  const originals = [...b.items];
  function collect(id) {
    for (const child of members(b, id)) {
      inside.add(child.id);
      collect(child.id);
    }
  }
  roots.forEach((i) => collect(i.id));
  if (
    originals.some(
      (i) => inside.has(i.id) && !["note", "section"].includes(i.kind),
    )
  ) {
    tell(
      "Select the notes to transfer. This section also contains a canvas or document.",
    );
    return;
  }
  const placed = members(target, null),
    left = placed.length ? Math.max(...placed.map((i) => i.x)) + 360 : 0;
  const positions = roots.map((i) => {
    const r = qitem(i.id).getBoundingClientRect();
    return worldPoint(r.x, r.y);
  });
  const minX = Math.min(...positions.map((p) => p.x)),
    minY = Math.min(...positions.map((p) => p.y));
  function transfer(i, parent, x, y) {
    const values = { ...i, id: uid(), parent, x, y };
    const placed =
      i.kind === "note"
        ? addAppearance(target, i.ref, values)
        : createItem(target, "section", values);
    for (const child of originals.filter((k) => k.parent === i.id))
      transfer(child, placed.id, child.x, child.y);
  }
  roots.forEach((i, j) =>
    transfer(i, null, left + positions[j].x - minX, positions[j].y - minY),
  );
  if (!copy) b.items = b.items.filter((i) => !inside.has(i.id));
  ui.sel = [];
  saveAndRender();
  tell((copy ? "Copied to " : "Moved to ") + target.name);
}
function insertDrawer(
  ref,
  at = center(),
  parent = null,
  col = 0,
  before = null,
) {
  const b = current();
  if (!b) return;
  const i = addAppearance(b, ref, { ...at, parent, col });
  if (before && i.id !== before) {
    b.items.splice(b.items.indexOf(i), 1);
    b.items.splice(
      b.items.findIndex((v) => v.id === before),
      0,
      i,
    );
  }
  ui.sel = [i.id];
  saveAndRender();
  return i;
}
function connect(a, z) {
  const b = current(),
    from = byId(b.items, a),
    to = byId(b.items, z);
  if (from?.kind !== "note" || to?.kind !== "note" || from.ref === to.ref) {
    tell("Choose two different notes.");
    return;
  }
  ui.tool = "select";
  ui.link = null;
  const existing = db.edges.find(
    (e) => e.source === from.ref && e.target === to.ref,
  );
  edgeDialog(
    existing || { id: uid(), source: from.ref, target: to.ref, label: "" },
    !existing,
  );
}
function edgeDialog(edge, fresh = false) {
  const a = note(edge.source),
    z = note(edge.target);
  const aItem = current().items.find((i) => i.ref === a.id),
    zItem = current().items.find((i) => i.ref === z.id);
  const ra = aItem && qitem(aItem.id)?.getBoundingClientRect(),
    rz = zItem && qitem(zItem.id)?.getBoundingClientRect();
  const left =
    ra && rz
      ? (ra.left + ra.width / 2 + rz.left + rz.width / 2) / 2
      : innerWidth / 2;
  const top =
    ra && rz
      ? (ra.top + ra.height / 2 + rz.top + rz.height / 2) / 2
      : innerHeight / 2;
  const anchor = {
    getBoundingClientRect: () => ({
      left: Math.max(6, left - 90),
      top,
      bottom: top,
    }),
  };
  const el = popup(
    anchor,
    '<form class="edge-form"><input id="edge-label" aria-label="Relationship" list="previous-labels" placeholder="Add description…" value="' +
      esc(edge.label) +
      '"><datalist id="previous-labels">' +
      [...new Set(db.edges.map((e) => e.label).filter(Boolean))]
        .map((t) => '<option value="' + esc(t) + '">')
        .join("") +
      "</datalist>" +
      (!fresh
        ? btn(
            "delete-edge",
            "Delete connection",
            "trash",
            "",
            attr("id", edge.id),
          )
        : "") +
      '<button aria-label="Save connection" title="Save connection">' +
      icon("check") +
      "</button></form>",
  );
  el.classList.add("edge-popover");
  el.querySelector("input").focus();
  el.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    edge.label = el.querySelector("input").value.trim();
    if (fresh) db.edges.push(edge);
    ui.sel = [];
    closeDialog();
    saveAndRender();
  };
}
function threadMenu(anchor) {
  const b = current(),
    i = chosen()[0],
    edges = db.edges.filter((e) => e.source === i.ref || e.target === i.ref);
  const html = edges
    .map((e) => {
      const other = e.source === i.ref ? e.target : e.source,
        n = note(other),
        present = b.items.find((i) => i.kind === "note" && i.ref === other);
      return (
        '<div class="thread"><div><span>↳ ' +
        esc(e.label || "Connected note") +
        "</span>" +
        btn(
          present ? "locate" : "insert-thread",
          present ? "Locate note" : "Insert connected note",
          "",
          present ? "Locate ↗" : "Insert ↗",
          attr("id", present ? present.id : n.id),
        ) +
        "</div>" +
        noteCard(n) +
        "</div>"
      );
    })
    .join("");
  popup(
    anchor,
    '<div class="menu-title">' +
      edges.length +
      " Connections</div>" +
      (html || '<p class="empty">Drag a note’s connector to another note.</p>'),
  );
}
function openEditor(id) {
  const d = doc(id);
  if (!d) return;
  if (ui.id !== d.board) nav(d.board);
  ui.panel = null;
  ui.editor = id;
  ui.full = false;
  ui.sel = [];
  ui.source = [];
  activeFormat = null;
  render();
  const tile = current().items.find((i) => i.kind === "doc" && i.ref === id);
  if (tile) focusItems([tile.id]);
}
function promptOutline(parent = null) {
  const d = doc(parent),
    b = current(),
    refs = d ? d.notes.map((n) => n.id) : findNoteIds();
  if (ui.busy) {
    tell("An outline is still being written.");
    return;
  }
  if (!b || !refs.length) {
    tell("Select a note or section to create an outline.");
    return;
  }
  const anchor = d
    ? $(".editor-foot [data-action=branch]") || $(".context-bar")
    : $(".context-bar [data-action=prompt]");
  const el = popup(
    anchor,
    '<form class="write-prompt"><input required id="writing-prompt" aria-label="Describe your writing needs" maxlength="1500" placeholder="' +
      (d ? "Try a different framing…" : "Describe your writing needs…") +
      '"><button type="submit" title="' +
      (d ? "Create branch" : "Create outline") +
      '" aria-label="' +
      (d ? "Create branch" : "Create outline") +
      '">' +
      icon("arrow-right") +
      '</button></form><div class="engine-caption">' +
      refs.length +
      " source note" +
      (refs.length === 1 ? "" : "s") +
      " · " +
      esc(engine) +
      "</div>",
  );
  el.classList.add("writing-popover");
  el.querySelector("input").focus();
  const origin = d
    ? b.items.find((i) => i.ref === d.id && i.kind === "doc")?.id
    : chosen()[0]?.id;
  el.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const prompt = el.querySelector("#writing-prompt").value.trim();
    if (!prompt) return;
    function sourceAppearance(id) {
      const candidates = b.items.filter(
        (i) => i.kind === "note" && i.ref === id,
      );
      return (
        candidates.find((i) => {
          for (let a = i; a; a = byId(b.items, a.parent))
            if (ui.sel.includes(a.id)) return true;
          return false;
        }) || candidates[0]
      )?.id;
    }
    const source = d
      ? structuredClone(d.notes)
      : refs.map((id) => ({
          ...structuredClone(note(id)),
          appearance: sourceAppearance(id),
        }));
    const edges = d
      ? structuredClone(d.edges)
      : db.edges
          .filter((e) => refs.includes(e.source) && refs.includes(e.target))
          .map((e) => ({ ...e }));
    const anchorEl = origin && qitem(origin),
      r = anchorEl?.getBoundingClientRect(),
      pos = r ? worldPoint(r.right, r.top) : center();
    // Keep sibling branches and earlier versions independently addressable.
    const siblings = b.items.filter(
      (i) => i.kind === "doc" && doc(i.ref)?.origin === origin,
    );
    const y = pos.y + siblings.length * 570;
    const bid = b.id;
    closeDialog();
    ui.busy = bid;
    ui.pendingTile = { x: pos.x + 124, y, prompt };
    ui.editor = null;
    ui.full = false;
    ui.sel = [];
    render();
    const pending = $(".pending-doc");
    if (pending) {
      const v = $(".canvas").getBoundingClientRect(),
        point = ui.pendingTile;
      ui.cam.x = v.width * 0.58 - point.x * ui.cam.k;
      ui.cam.y = v.height * 0.25 - point.y * ui.cam.k;
      applyCamera();
    }
    try {
      const res = await fetch("/api/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          notes: source.map(({ id, title, body, url, image }) => ({
            id,
            title,
            body,
            url,
            hasImage: Boolean(image),
          })),
          edges,
          previous: d ? markdown(d) : "",
          history: db.writingHistory.slice(-2),
          patterns: db.documents.slice(0, 3).map((previous) => ({
            sections: previous.sections.length,
            pointsPerSection: previous.sections.map((s) => s.points.length),
            isBranch: !!previous.parent,
          })),
        }),
      });
      const result = await res.json();
      if (!res.ok)
        throw Error(result.error || "Could not generate an outline.");
      const next = {
        id: uid(),
        board: bid,
        parent: parent || null,
        origin,
        prompt,
        notes: source,
        edges,
        created: new Date().toISOString(),
        ...result,
      };
      db.documents.unshift(next);
      const tile = createItem(b, "doc", { ref: next.id, x: pos.x + 124, y });
      db.writingHistory.push(prompt);
      save();
      if (ui.id === bid) {
        ui.editor = null;
        ui.full = false;
        ui.sel = [tile.id];
        ui.source = [];
      }
      ui.busy = null;
      render();
      if (ui.id === bid) focusItems([origin, tile.id].filter(Boolean));
      tell(
        result.notice || "Outline ready. Double-click the document to open it.",
      );
    } catch (err) {
      ui.busy = null;
      render();
      tell(err.message);
    }
  };
}
function revealSource(index) {
  const d = doc(ui.editor),
    s = d.sections[index],
    b = current();
  activeFormat = index;
  if (ui.full) {
    ui.full = false;
    render();
  }
  const ids = s.sources;
  ui.sel = [];
  ui.source = ids
    .map((ref) => {
      const saved = d.notes.find((n) => n.id === ref)?.appearance;
      return (
        b.items.find((i) => i.id === saved && i.ref === ref) ||
        b.items.find((i) => i.kind === "note" && i.ref === ref)
      );
    })
    .filter(Boolean)
    .map((i) => i.id);
  document
    .querySelectorAll(".passage")
    .forEach((el, i) => el.classList.toggle("active", i === index));
  if (ui.source.length) {
    focusItems(ui.source);
    const w = $("#world");
    w.querySelectorAll(".wire.active").forEach((el) =>
      el.classList.remove("active"),
    );
    for (const e of db.edges)
      if (ids.includes(e.source) && ids.includes(e.target))
        w.querySelector('[data-edge="' + e.id + '"]')?.classList.add("active");
  }
  const changed = ids.some((id) => {
    const snapshot = d.notes.find((n) => n.id === id),
      now = note(id);
    return !now || snapshot?.body !== now.body || snapshot?.title !== now.title;
  });
  if (changed || !ui.source.length) sourceSnapshot(d, ids);
}
function sourceSnapshot(d, ids) {
  dialog(
    "Sources at generation",
    '<div class="dialog-body">' +
      d.notes
        .filter((n) => ids.includes(n.id))
        .map((n) => noteCard(n))
        .join("") +
      "</div>",
    true,
  );
}
function documents() {
  const rows = db.documents
    .map((d) =>
      btn(
        "doc-from-list",
        d.title,
        "file-text",
        "<span><strong>" +
          esc(d.title) +
          "</strong><small>" +
          esc(board(d.board)?.name) +
          (d.parent ? " · Branch" : "") +
          "</small></span>",
        'class="result" ' + attr("id", d.id),
      ),
    )
    .join("");
  dialog(
    "Documents",
    '<div class="library-list">' +
      (rows ||
        '<p class="empty">Select a note or section on a canvas and choose Create outline.</p>') +
      "</div>",
  );
}
async function readImage(file) {
  if (
    !file ||
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)
  )
    throw Error("Choose a PNG, JPEG, WebP or GIF image.");
  if (file.size > 8 * 1024 * 1024)
    throw Error("Choose an image smaller than 8 MB.");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}
function pickImage(done) {
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/png,image/jpeg,image/webp,image/gif";
  file.onchange = async () => {
    try {
      if (file.files.length) done(await readImage(file.files[0]));
    } catch (e) {
      tell(e.message);
    }
  };
  file.click();
}
function editNote(n = null, placement = null) {
  let image = n?.image || "";
  const el = dialog(
    n ? "Edit note" : "New note",
    '<form><label>Title<input id="note-title" placeholder="New Note" value="' +
      esc(n?.title) +
      '"></label><label>Note<textarea id="note-body" aria-label="Note" placeholder="Start writing…">' +
      esc(n?.body) +
      '</textarea></label><label>Link<input type="url" id="note-url" placeholder="https://" value="' +
      esc(n?.url) +
      '"></label><div class="attachment-row"></div><div class="dialog-actions">' +
      btn("dismiss", "Cancel", "", "Cancel", 'class="action"') +
      '<button class="primary">Save note</button></div></form>',
  );
  const row = el.querySelector(".attachment-row");
  function paint() {
    row.innerHTML =
      (image ? '<img src="' + esc(image) + '" alt="Attached image">' : "") +
      '<button type="button" class="action">' +
      (image ? "Remove image" : "Attach image") +
      "</button>";
    row.querySelector("button").onclick = () => {
      if (image) {
        image = "";
        paint();
      } else
        pickImage((value) => {
          image = value;
          paint();
        });
    };
  }
  paint();
  el.onpaste = async (e) => {
    const file = [...e.clipboardData.items]
      .find((i) => i.kind === "file")
      ?.getAsFile();
    if (file) {
      e.preventDefault();
      try {
        image = await readImage(file);
        paint();
      } catch (err) {
        tell(err.message);
      }
    }
  };
  el.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const title = $("#note-title").value.trim(),
      body = $("#note-body").value.trim(),
      raw = $("#note-url").value.trim(),
      url = safeURL(raw || (/^https?:\/\/\S+$/.test(body) ? body : ""));
    if (raw && !url) {
      tell("Use an http or https link.");
      return;
    }
    if (!title && !body && !image && !url) {
      tell("Add some text, a link or an image.");
      return;
    }
    const values = { title, body, image, url };
    if (n) {
      if (n.url !== url) delete n.logo;
      Object.assign(n, values);
    } else {
      const added = newNote(values);
      if (current() && placement) {
        let i = createItem(current(), "note", { ref: added.id, ...placement });
        if (placement.before) {
          const items = current().items;
          items.pop();
          items.splice(
            items.findIndex((x) => x.id === placement.before),
            0,
            i,
          );
          delete i.before;
        }
        ui.sel = [i.id];
      }
    }
    closeDialog();
    saveAndRender();
  };
}
function capture(renderAfter = true) {
  if (!draft.title.trim() && !draft.body.trim() && !draft.image) return false;
  newNote({
    ...draft,
    title: draft.title.trim(),
    body: draft.body.trim(),
    url: safeURL(draft.body.trim()),
  });
  draft = { title: "", body: "", image: "" };
  sessionStorage.removeItem("etch-capture");
  save();
  if (renderAfter) render();
  return true;
}
function rememberDraft() {
  try {
    sessionStorage.setItem("etch-capture", JSON.stringify(draft));
  } catch {
    tell("This image will be saved when you save the note.");
  }
}
function showSettings() {
  const el = dialog(
    "Workspace settings",
    '<form><label>Workspace owner<input maxlength="80" required value="' +
      esc(db.profile) +
      '"></label><p class="caption">Writing engine · ' +
      esc(engine) +
      '</p><div class="dialog-actions">' +
      btn(
        "backup",
        "Download workspace",
        "download-simple",
        "Download workspace",
        'class="action"',
      ) +
      '<button class="primary">Save</button></div></form>',
  );
  el.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    const name = el.querySelector("input").value.trim();
    if (!name) return;
    db.profile = name;
    closeDialog();
    saveAndRender();
  };
}
function searchResults(input) {
  const q = input.value.trim().toLowerCase();
  if (!q) {
    closePopup();
    return;
  }
  const matches = [
    ...db.boards
      .filter((b) => b.name.toLowerCase().includes(q))
      .map((b) => menuRow("go", b.name, "rectangle", attr("id", b.id))),
    ...db.notes
      .filter((n) => (n.title + " " + n.body).toLowerCase().includes(q))
      .map((n) =>
        menuRow("edit-found", makeNoteTitle(n), "note", attr("id", n.id)),
      ),
    ...db.documents
      .filter((d) => d.title.toLowerCase().includes(q))
      .map((d) =>
        menuRow("doc-from-list", d.title, "file-text", attr("id", d.id)),
      ),
  ];
  popup(input, matches.join("") || '<p class="empty">No results.</p>');
}
function insertInline(placement) {
  if (!current() || $(".inline-editor")) return;
  const b = current(),
    world = $("#world"),
    group = placement.parent && qitem(placement.parent);
  const column = group?.querySelectorAll(":scope > .columns > .group-column")[
    placement.col || 0
  ];
  const el = document.createElement("form");
  el.className =
    "item card note-card inline-editor " + (column ? "nested" : "placed");
  el.innerHTML =
    '<div class="note-copy"><input name="title" placeholder="New Note" aria-label="Inserted note title"><textarea name="body" rows="3" placeholder="Start writing…" aria-label="Inserted note body"></textarea><div><button type="button" data-cancel>Cancel</button><button type="submit">Save</button></div></div>';
  if (column)
    column.insertBefore(el, placement.before ? qitem(placement.before) : null);
  else {
    el.style.left = placement.x + "px";
    el.style.top = placement.y + "px";
    world.append(el);
  }
  el.querySelector("input").focus();
  el.querySelector("[data-cancel]").onclick = () => el.remove();
  function commit() {
    const title = el.elements.title.value.trim(),
      body = el.elements.body.value.trim();
    if (!title && !body) return false;
    const n = newNote({ title, body, url: safeURL(body) });
    insertDrawer(
      n.id,
      placement,
      placement.parent,
      placement.col,
      placement.before,
    );
    return true;
  }
  el.onsubmit = (e) => {
    e.preventDefault();
    if (!commit()) tell("Add a thought to save this note.");
  };
  el.onkeydown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      commit();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      el.remove();
    }
  };
  el.onfocusout = (e) => {
    if (e.relatedTarget && !el.contains(e.relatedTarget))
      setTimeout(() => {
        if (el.isConnected && !el.contains(document.activeElement)) {
          if (!commit()) el.remove();
        }
      }, 80);
  };
}
function addAtSelection() {
  const b = current(),
    sel = chosen()[0],
    p = center();
  let parent = null,
    col = 0,
    before = null;
  if (sel?.kind === "section") parent = sel.id;
  else if (sel?.parent) {
    parent = sel.parent;
    col = sel.col;
    before = sel.id;
  }
  editNote(null, { x: p.x - 130, y: p.y - 55, parent, col, before });
}
function more(anchor) {
  popup(
    anchor,
    menuRow("new-note", "New note", "note-blank") +
      menuRow("section", "New section", "bounding-box") +
      menuRow("subcanvas", "New subcanvas", "rectangle") +
      menuRow("fit", "Fit canvas", "corners-out") +
      menuRow("shortcuts", "Keyboard shortcuts", "keyboard"),
  );
}
function destinationMenu(anchor, copy) {
  popup(
    anchor,
    '<div class="menu-title">' +
      (copy ? "Copy to canvas" : "Move to canvas") +
      "</div>" +
      db.boards
        .filter((b) => b.id !== ui.id)
        .map((b) =>
          menuRow(
            copy ? "copy-to" : "move-to",
            ancestors(b.id)
              .map((c) => c.name)
              .join(" / "),
            "rectangle",
            attr("id", b.id),
          ),
        )
        .join(""),
  );
}
function formatSelection(key) {
  const range = window.getSelection(),
    point = range?.anchorNode?.parentElement?.closest("[data-doc-field=point]");
  if (
    point &&
    range.rangeCount &&
    !range.isCollapsed &&
    point.contains(range.focusNode)
  ) {
    document.execCommand(key, false, null);
    point.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  format(key);
}
function format(key, value) {
  const d = doc(ui.editor);
  if (!d) return;
  const index = activeFormat ?? 0,
    s = d.sections[index];
  if (!s) return;
  s[key] = value ?? !s[key];
  saveAndRender();
  $('.passage[data-passage="' + index + '"]')?.scrollIntoView({
    block: "nearest",
  });
}
const actions = {
  home: () => nav(),
  go: (el) => nav(el.dataset.id),
  rail: () => {
    ui.rail = !ui.rail;
    render();
  },
  fold: (el) => {
    const id = el.dataset.id;
    ui.folded.has(id) ? ui.folded.delete(id) : ui.folded.add(id);
    render();
  },
  "new-board": () => showBoardForm(),
  settings: showSettings,
  documents,
  backup: () =>
    download(
      "Etch-workspace.json",
      JSON.stringify(db, null, 2),
      "application/json",
    ),
  inbox: () => {
    if (!current()) {
      document
        .querySelector(".notes-area")
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
      $("#capture-title")?.focus({ preventScroll: true });
      return;
    }
    ui.panel = ui.panel === "inbox" ? null : "inbox";
    ui.editor = null;
    ui.query = "";
    render();
  },
  "panel-close": () => {
    ui.panel = null;
    render();
  },
  relevant: () => {
    ui.relevant = !ui.relevant;
    render();
  },
  commit: capture,
  "attach-capture": () =>
    pickImage((image) => {
      draft.image = image;
      rememberDraft();
      render();
      $("#capture-body")?.focus();
    }),
  select: () => {
    ui.tool = "select";
    ui.link = null;
    render();
  },
  hand: () => {
    ui.tool = "hand";
    render();
  },
  connector: () => {
    ui.tool = "connector";
    ui.link = chosen()[0]?.kind === "note" ? chosen()[0].id : null;
    render();
    tell(
      ui.link
        ? "Choose the connected note."
        : "Choose the first note, then the connected note.",
    );
  },
  "new-note": addAtSelection,
  more,
  fit,
  minus: () => zoom(1 / 1.2),
  plus: () => zoom(1.2),
  subcanvas: () => showBoardForm(true),
  "board-menu": (el) =>
    popup(
      el,
      menuRow("home", "Note inbox", "house") +
        menuRow("rename-board", "Rename canvas", "pencil-simple") +
        menuRow("subcanvas", "Create subcanvas", "rectangle") +
        menuRow("fit", "Fit canvas", "corners-out"),
    ),
  "rename-board": () => {
    const b = current();
    nameDialog("Rename canvas", "Canvas name", b.name, (name) => {
      b.name = name;
      saveAndRender();
    });
  },
  section: () => {
    if (chosen().length) {
      groupSelected();
      return;
    }
    nameDialog("Create section", "Section name", "", (name) => {
      const p = center(),
        i = createItem(current(), "section", {
          name,
          columns: 1,
          x: p.x - 130,
          y: p.y - 55,
        });
      ui.sel = [i.id];
      saveAndRender();
    });
  },
  group: groupSelected,
  duplicate: copySelected,
  "rename-section": () => {
    const i = chosen()[0];
    nameDialog("Rename section", "Section name", i.name, (name) => {
      i.name = name;
      saveAndRender();
    });
  },
  layout: (el) =>
    popup(
      el,
      menuRow("grid", "Grid", "squares-four") +
        menuRow("stack", "Vertical stack", "rows"),
    ),
  grid: () => {
    const i = chosen()[0];
    i.layout = "grid";
    i.columns = Math.max(2, i.columns || 2);
    const kids = members(current(), i.id);
    if (kids.every((c) => !c.col)) kids.forEach((c, j) => (c.col = j % 2));
    saveAndRender();
  },
  stack: () => {
    const i = chosen()[0];
    i.layout = "stack";
    saveAndRender();
  },
  "selection-more": (el) =>
    popup(
      el,
      menuRow("duplicate", "Duplicate", "copy") +
        (chosen().length > 1
          ? menuRow("group", "Group into section", "bounding-box")
          : "") +
        (chosen().some((i) => ["note", "section"].includes(i.kind))
          ? menuRow("choose-move", "Move to canvas", "arrow-right") +
            menuRow("choose-copy", "Copy to canvas", "copy")
          : "") +
        menuRow("remove", "Remove from canvas", "minus-circle"),
    ),
  "choose-move": (el) => destinationMenu(el, false),
  "choose-copy": (el) => destinationMenu(el, true),
  "copy-to": (el) => moveTo(el.dataset.id, true),
  "move-to": (el) => moveTo(el.dataset.id),
  remove: removeSelected,
  "open-child": () => nav(chosen()[0].ref),
  "open-doc": () => openEditor(chosen()[0].ref),
  "edit-note": () => editNote(note(chosen()[0].ref)),
  "edit-found": (el) => editNote(note(el.dataset.id)),
  color: (el) =>
    popup(
      el,
      '<div class="palette">' +
        Object.entries(colors)
          .map(([name, c]) =>
            btn(
              "swatch",
              name,
              "",
              "",
              'class="swatch" style="background:' +
                c +
                '" ' +
                attr("color", name),
            ),
          )
          .join("") +
        "</div>",
    ),
  swatch: (el) => {
    for (const i of chosen())
      if (i.kind === "note") note(i.ref).color = el.dataset.color;
    saveAndRender();
  },
  threads: threadMenu,
  appearances: (el) => {
    const n = chosen()[0].ref;
    popup(
      el,
      appearances(n)
        .map((b) =>
          menuRow(
            "appearance",
            b.name,
            "rectangle",
            attr("id", b.id) + " " + attr("ref", n),
          ),
        )
        .join(""),
    );
  },
  appearance: (el) => {
    const b = board(el.dataset.id),
      i = b.items.find((i) => i.ref === el.dataset.ref);
    nav(b.id, i.id);
  },
  locate: (el) => {
    const id = el.dataset.id;
    select(id);
    focusItems([id]);
  },
  "insert-thread": (el) => {
    const i = chosen()[0],
      b = current(),
      r = qitem(i.id).getBoundingClientRect(),
      p = worldPoint(r.left, r.bottom);
    insertDrawer(el.dataset.id, { x: p.x, y: p.y + 24 }, i.parent, i.col);
  },
  "delete-edge": (el) => {
    db.edges = db.edges.filter((e) => e.id !== el.dataset.id);
    closeDialog();
    saveAndRender();
  },
  prompt: () => promptOutline(),
  branch: () => promptOutline(ui.editor || chosen()[0].ref),
  "doc-from-list": (el) => {
    closeDialog();
    openEditor(el.dataset.id);
  },
  "close-editor": () => {
    ui.editor = null;
    ui.full = false;
    ui.source = [];
    render();
  },
  expand: () => {
    ui.full = !ui.full;
    render();
  },
  "copy-doc": async () => {
    const d = doc(ui.editor);
    try {
      await navigator.clipboard.writeText(markdown(d));
      tell("Document copied.");
    } catch {
      download(d.title + ".md", markdown(d));
    }
  },
  "doc-menu": (el) =>
    popup(
      el,
      menuRow("export-doc", "Export Markdown", "download-simple") +
        menuRow("branch", "Branch document", "git-branch") +
        menuRow("snapshots", "Original source notes", "note"),
    ),
  "export-doc": () => {
    const d = doc(ui.editor);
    download(d.title + ".md", markdown(d));
    closePopup();
  },
  snapshots: () => {
    const d = doc(ui.editor);
    sourceSnapshot(
      d,
      d.notes.map((n) => n.id),
    );
  },
  reference: (el) => revealSource(Number(el.dataset.index)),
  bold: () => formatSelection("bold"),
  italic: () => formatSelection("italic"),
  underline: () => formatSelection("underline"),
  list: () => {
    const d = doc(ui.editor);
    format("list", d.sections[activeFormat ?? 0].list === false);
  },
  dismiss: closeDialog,
  shortcuts: () =>
    dialog(
      "Canvas shortcuts",
      '<div class="dialog-body"><p>Drag empty space to pan. Shift-drag to select an area. Shift-click adds notes to a selection. Drag the round handle to connect a note.</p><p>V Select · H Pan · N New note · C Connect · F Fit canvas · ⌘/Ctrl G Group · ⌘/Ctrl D Duplicate · Delete Remove appearance · Escape Close</p></div>',
    ),
};
document.addEventListener(
  "pointerdown",
  (e) => {
    if (!e.target.closest(".popover,.searchbox,.context-bar")) closePopup();
  },
  true,
);
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (el) {
    if (!el.closest(".popover,.context-bar,.live-preview")) closePopup();
    actions[el.dataset.action]?.(el);
    return;
  }
  if (e.target.classList.contains("scrim")) {
    closeDialog();
    return;
  }

  if (e.target.closest("a")) return;
  const homeNote = e.target.closest("[data-home-note]");
  if (homeNote) editNote(note(homeNote.dataset.homeNote));
  const drawerNote = e.target.closest("[data-drawer-note]");
  if (drawerNote) insertDrawer(drawerNote.dataset.drawerNote);
  const wire = e.target.closest(".wire[data-edge]");
  if (wire?.dataset.edge && wire.closest(".world")?.id === "world")
    edgeDialog(byId(db.edges, wire.dataset.edge));
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "capture-title" || t.id === "capture-body") {
    draft[t.id === "capture-title" ? "title" : "body"] = t.value;
    rememberDraft();
    t.closest(".composer").classList.toggle(
      "has-draft",
      !!(draft.title || draft.body),
    );
    if (t.tagName === "TEXTAREA") {
      t.style.height = "auto";
      t.style.height = t.scrollHeight + "px";
    }
  }
  if (t.id === "global-search") searchResults(t);
  if (t.id === "drawer-search") {
    ui.query = t.value;
    $(".drawer-scroll").innerHTML = drawerNotes();
  }
  const field = t.dataset.docField;
  if (field) {
    const d = doc(ui.editor),
      value = t.innerText;
    if (field === "title") d.title = value;
    else if (field === "heading") d.sections[t.dataset.i].heading = value;
    else {
      const section = d.sections[t.dataset.i];
      section.points[t.dataset.j] = value;
      section.rich ??= {};
      section.rich[t.dataset.j] = safeRich(t.innerHTML);
    }
    save();
  }
});
document.addEventListener("mousedown", (e) => {
  if (
    e.target.closest(
      ".editor-top [data-action=bold],.editor-top [data-action=italic],.editor-top [data-action=underline]",
    )
  )
    e.preventDefault();
});
document.addEventListener("paste", (e) => {
  if (e.target.closest("[data-doc-field=point]")) {
    e.preventDefault();
    document.execCommand(
      "insertText",
      false,
      e.clipboardData.getData("text/plain"),
    );
  }
});
document.addEventListener("focusin", (e) => {
  const p = e.target.closest("[data-passage]");
  if (p) {
    activeFormat = Number(p.dataset.passage);
    document
      .querySelectorAll(".passage")
      .forEach((el) => el.classList.toggle("active", p === el));
  }
});
document.addEventListener("focusout", (e) => {
  if (e.target.closest(".composer") && !e.relatedTarget?.closest(".composer"))
    setTimeout(() => {
      if (
        document.querySelector(".composer") &&
        !document.activeElement?.closest(".composer") &&
        (draft.title.trim() || draft.body.trim() || draft.image)
      )
        capture();
    }, 110);
});
document.addEventListener("change", (e) => {
  if (e.target.id === "block-style")
    format("large", e.target.value === "heading");
});
document.addEventListener("paste", async (e) => {
  if (!e.target.closest(".composer")) return;
  const file = [...e.clipboardData.items]
    .find((i) => i.kind === "file")
    ?.getAsFile();
  if (file) {
    e.preventDefault();
    try {
      draft.image = await readImage(file);
      rememberDraft();
      render();
      $("#capture-body").focus();
    } catch (err) {
      tell(err.message);
    }
  }
});
function openItem(id) {
  const i = byId(current().items, id);
  if (!i) return;
  if (i.kind === "board") nav(i.ref);
  else if (i.kind === "doc") openEditor(i.ref);
  else if (i.kind === "note") editNote(note(i.ref));
  else actions["rename-section"]();
}
document.addEventListener("dblclick", (e) => {
  if (!e.target.closest(".canvas") || e.target.closest(".port,a,.wire")) return;
  const i = e.target.closest("[data-item]");
  if (i) openItem(i.dataset.item);
  else editNote(null, worldPoint(e.clientX, e.clientY));
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($(".scrim")) {
      closeDialog();
      return;
    }
    if ($(".popover")) {
      closePopup();
      return;
    }
    ui.panel = null;
    ui.editor = null;
    ui.full = false;
    ui.sel = [];
    ui.source = [];
    ui.link = null;
    ui.tool = "select";
    render();
    return;
  }
  if ($(".scrim") && e.key === "Tab") {
    const focus = [
        ...$(".scrim").querySelectorAll(
          'button:not(:disabled),input,textarea,select,[tabindex="0"]',
        ),
      ],
      first = focus[0],
      last = focus.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
    return;
  }
  if (
    e.target.closest(".composer") &&
    (e.ctrlKey || e.metaKey) &&
    e.key === "Enter"
  ) {
    e.preventDefault();
    capture();
    return;
  }
  if (
    e.target.closest("textarea,input,[contenteditable],select,.dialog,.popover")
  )
    return;
  if (e.key === "Enter") {
    const el = e.target.closest(
      "[data-item],[data-home-note],[data-drawer-note]",
    );
    if (el) {
      e.preventDefault();
      if (el.dataset.item) {
        select(el.dataset.item);
        openItem(el.dataset.item);
      } else el.click();
    }
    return;
  }
  if (!current() || ui.editor) return;
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && ["g", "d"].includes(k)) {
    e.preventDefault();
    if (chosen().length) (k === "g" ? groupSelected : copySelected)();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (k === "delete" || k === "backspace") {
    if (chosen().length) {
      e.preventDefault();
      removeSelected();
    }
  } else if (k === "v") actions.select();
  else if (k === "h") actions.hand();
  else if (k === "n") addAtSelection();
  else if (k === "c") actions.connector();
  else if (k === "f") fit();
});
const previewTimers = new WeakMap();
document.addEventListener("pointermove", (e) => {
  const pv = e.target.closest(".recent-card .preview-window");
  if (!pv || !pv.dataset.fit) return;
  const { scale, box } = JSON.parse(pv.dataset.fit),
    r = pv.getBoundingClientRect(),
    nx = (e.clientX - r.x) / r.width,
    ny = (e.clientY - r.y) / r.height,
    k = Math.min(1, scale * 2.6);
  clearTimeout(previewTimers.get(pv));
  previewTimers.set(
    pv,
    setTimeout(() => {
      const w = pv.firstElementChild;
      w.style.transition = "transform .16s ease-out";
      w.style.transform =
        "translate(" +
        (pv.clientWidth / 2 - (box.x + box.w * nx) * k) +
        "px," +
        (pv.clientHeight / 2 - (box.y + box.h * ny) * k) +
        "px) scale(" +
        k +
        ")";
    }, 85),
  );
});
document.addEventListener("pointerout", (e) => {
  const pv = e.target.closest(".recent-card .preview-window");
  if (pv && !pv.contains(e.relatedTarget) && pv.dataset.fit) {
    clearTimeout(previewTimers.get(pv));
    const f = JSON.parse(pv.dataset.fit);
    pv.firstElementChild.style.transform =
      "translate(" + f.x + "px," + f.y + "px) scale(" + f.scale + ")";
  }
  const dest = e.target.closest("[data-dest]");
  if (
    dest &&
    !dest.contains(e.relatedTarget) &&
    !e.relatedTarget?.closest?.(".live-preview")
  ) {
    clearTimeout(hoverTimer);
    $(".live-preview")?.remove();
  }
});
document.addEventListener("pointerover", (e) => {
  const target = e.target.closest("[data-dest]");
  if (
    !target ||
    target.classList.contains("live-preview") ||
    target.contains(e.relatedTarget) ||
    !current()
  )
    return;
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => {
    if (!target.isConnected) return;
    $(".live-preview")?.remove();
    const v = document.createElement("div");
    v.className = "live-preview";
    v.dataset.dest = target.dataset.dest;
    v.innerHTML = preview(board(target.dataset.dest));
    const r = target.getBoundingClientRect();
    v.style.left = Math.min(innerWidth - 247, r.left + 18) + "px";
    v.style.top = Math.min(innerHeight - 155, r.bottom + 5) + "px";
    document.body.append(v);
    paintPreviews(v);
  }, 380);
});
window.addEventListener("save-error", (e) => {
  dialog(
    "Workspace save needs attention",
    '<div class="dialog-body"><p>' +
      esc(e.detail) +
      "</p>" +
      btn(
        "backup",
        "Download this workspace",
        "download-simple",
        "Download workspace",
      ) +
      (hasSaveConflict()
        ? btn(
            "reload-workspace",
            "Reload saved workspace",
            "arrow-clockwise",
            "Reload saved workspace",
          )
        : btn("retry", "Retry save", "arrow-clockwise", "Retry save")) +
      "</div>",
  );
});
actions["reload-workspace"] = () => location.reload();
actions.retry = () => {
  closeDialog();
  save();
};
window.addEventListener("popstate", () => route());
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (
      !$(".scrim") &&
      !document.activeElement?.matches("input,textarea,[contenteditable]")
    )
      render();
  }, 120);
});
function route() {
  const id = decodeURIComponent(location.hash.replace(/^#canvas\//, ""));
  nav(board(id) ? id : null);
}
try {
  await start();
  try {
    draft = JSON.parse(sessionStorage.getItem("etch-capture")) || draft;
  } catch {}
  route();
  installGestures({
    ui,
    current,
    select,
    selection,
    worldPoint,
    applyCamera,
    zoom,
    render,
    saveAndRender,
    connect,
    moveTo,
    insertDrawer,
    openItem,
    tell,
    editNote,
    insertInline,
    center,
  });
  fetch("/api/engine")
    .then((r) => r.json())
    .then((d) => (engine = d.engine))
    .catch(() => {});
  document.fonts.ready.then(() => {
    paintPreviews(app);
    if (current()) drawEdges(current(), $("#world"), ui.cam.k);
  });
} catch (e) {
  app.textContent = "Etch could not open this workspace. " + e.message;
}
