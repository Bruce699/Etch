import { byId, db, note, members } from "./store.js";
import { noteCard, ownItems, esc } from "./view.js";

export function installGestures(api) {
  const {
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
    tell,
  } = api;
  let drag = null,
    external = null;
  const pointers = new Map();
  let pinch = null;
  const clearGuides = () => {
    document
      .querySelectorAll(".drop-line,.marquee,.link-drag,.drag-ghost")
      .forEach((el) => el.remove());
    document
      .querySelectorAll(".drop-target")
      .forEach((el) => el.classList.remove("drop-target"));
  };
  const point = (e) => ({ x: e.clientX, y: e.clientY });
  const itemAt = (el) => {
    let i = el?.closest("[data-item]");
    while (i && i.closest(".world")?.id !== "world")
      i = i.parentElement.closest("[data-item]");
    return i;
  };
  const getRect = (id) =>
    ownItems(document.querySelector("#world"))
      .find((e) => e.dataset.item === id)
      ?.getBoundingClientRect();
  function start(e) {
    if (e.button !== 0 && e.button !== 1) return;
    const stage = e.target.closest(".canvas");
    if (
      !stage ||
      e.target.closest(
        ".inline-editor,.wire-hit,.edge-label,a,button:not(.port)",
      )
    )
      return;
    document
      .querySelectorAll(".popover,.live-preview")
      .forEach((x) => x.remove());
    pointers.set(e.pointerId, point(e));
    if (pointers.size === 2) {
      clearGuides();
      const pts = [...pointers.values()];
      pinch = {
        distance: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
      };
      drag = null;
      return;
    }
    const el = itemAt(e.target),
      i = el ? byId(current().items, el.dataset.item) : null;
    const mode = e.target.closest(".port")
      ? "edge"
      : e.button === 1 || ui.tool === "hand"
        ? "pan"
        : i
          ? "item"
          : e.shiftKey
            ? "marquee"
            : "pan";
    drag = {
      id: e.pointerId,
      mode,
      start: point(e),
      last: point(e),
      item: i,
      el,
      shift: e.shiftKey,
      alt: e.altKey,
      moved: false,
      cam: { ...ui.cam },
    };
    if (mode === "edge") e.preventDefault();
  }
  function makeOverlay(cls) {
    const el = document.createElement("div");
    el.className = cls;
    document.body.append(el);
    return el;
  }
  function target(x, y, skip = []) {
    const elements = document.elementsFromPoint(x, y),
      dest = elements.map((el) => el.closest("[data-dest]")).find(Boolean);
    if (dest && dest.dataset.dest !== ui.id)
      return { dest: dest.dataset.dest, el: dest };
    const tile = elements
      .map(itemAt)
      .find(
        (el) => el?.dataset.kind === "board" && !skip.includes(el.dataset.item),
      );
    if (tile)
      return { dest: byId(current().items, tile.dataset.item).ref, el: tile };
    let group = elements
      .map((el) => el.closest(".group[data-item]"))
      .find(
        (el) =>
          el &&
          el.closest(".world")?.id === "world" &&
          !skip.includes(el.dataset.item),
      );
    if (!group) return { parent: null, col: 0 };
    const g = byId(current().items, group.dataset.item);
    let p = g;
    while (p) {
      if (skip.includes(p.id)) return { parent: null, col: 0 };
      p = byId(current().items, p.parent);
    }
    const cols = [...group.querySelector(":scope > .columns").children];
    let col =
      cols.find((el) => x <= el.getBoundingClientRect().right + 4) ||
      cols.at(-1);
    const children = [...col.children].filter(
      (el) => !skip.includes(el.dataset.item),
    );
    const before = children.find((el) => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    const cr = col.getBoundingClientRect(),
      last = children.at(-1)?.getBoundingClientRect();
    return {
      parent: g.id,
      col: Number(col.dataset.column),
      before: before?.dataset.item,
      el: group,
      line: {
        x: cr.left,
        y: before
          ? before.getBoundingClientRect().top - 3
          : last
            ? last.bottom + 3
            : cr.top,
        w: Math.max(28, cr.width),
      },
    };
  }
  function guide(t) {
    document.querySelectorAll(".drop-line").forEach((el) => el.remove());
    document
      .querySelectorAll(".drop-target")
      .forEach((el) => el.classList.remove("drop-target"));
    t.el?.classList.add("drop-target");
    if (t.line) {
      const l = makeOverlay("drop-line");
      Object.assign(l.style, {
        left: t.line.x + "px",
        top: t.line.y + "px",
        width: t.line.w + "px",
      });
    }
  }
  function move(e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, point(e));
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()],
        d = Math.hypot(b.x - a.x, b.y - a.y);
      if (pinch.distance > 0)
        zoom(d / pinch.distance, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinch.distance = d;
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag,
      dx = e.clientX - d.start.x,
      dy = e.clientY - d.start.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) {
      d.moved = true;
      document.querySelector(".context-bar")?.remove();
      if (d.mode === "item" && ui.tool !== "connector") {
        if (!ui.sel.includes(d.item.id)) ui.sel = [d.item.id];
        d.originals = ui.sel.map((id) => {
          const r = getRect(id);
          return { id, p: worldPoint(r.x, r.y) };
        });
        d.ghost = makeOverlay("drag-ghost");
        d.ghost.innerHTML =
          d.item.kind === "note"
            ? noteCard(note(d.item.ref))
            : '<div class="card note-copy">' +
              esc(d.item.name || d.item.kind) +
              "</div>";
      } else if (d.mode === "marquee") d.box = makeOverlay("marquee");
    }
    d.last = point(e);
    if (d.mode === "pan") {
      ui.cam.x = d.cam.x + dx;
      ui.cam.y = d.cam.y + dy;
      applyCamera();
    } else if (d.mode === "item" && d.ghost) {
      d.ghost.style.left = e.clientX + 8 + "px";
      d.ghost.style.top = e.clientY + 8 + "px";
      guide(target(e.clientX, e.clientY, ui.sel));
    } else if (d.mode === "marquee") {
      Object.assign(d.box.style, {
        left: Math.min(d.start.x, e.clientX) + "px",
        top: Math.min(d.start.y, e.clientY) + "px",
        width: Math.abs(dx) + "px",
        height: Math.abs(dy) + "px",
      });
    } else if (d.mode === "edge") {
      let svg = document.querySelector(".link-drag");
      if (!svg) {
        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("link-drag");
        document.body.append(svg);
      }
      svg.innerHTML =
        '<path d="M ' +
        d.start.x +
        " " +
        d.start.y +
        " C " +
        d.start.x +
        " " +
        (d.start.y + 65) +
        " " +
        e.clientX +
        " " +
        (e.clientY - 65) +
        " " +
        e.clientX +
        " " +
        e.clientY +
        '" fill="none" stroke="#5994ed" stroke-width="2"/>';
    }
  }
  function finish(e) {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const d = drag;
    drag = null;
    if (!current()) {
      clearGuides();
      return;
    }
    if (d.mode === "edge") {
      const z = itemAt(document.elementFromPoint(e.clientX, e.clientY));
      clearGuides();
      if (z && z.dataset.item !== d.item.id) connect(d.item.id, z.dataset.item);
      else {
        ui.link = d.item.id;
        ui.tool = "connector";
        render();
        tell("Choose the connected note.");
      }
      return;
    }
    if (!d.moved) {
      if (ui.tool === "connector" && d.item?.kind === "note") {
        if (ui.link) connect(ui.link, d.item.id);
        else {
          ui.link = d.item.id;
          select(d.item.id);
          tell("Choose the connected note.");
        }
      } else select(d.item?.id, d.shift);
      return;
    }
    if (d.mode === "marquee") {
      const r = d.box.getBoundingClientRect();
      ui.sel = ownItems(document.querySelector("#world"))
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return (
            el.dataset.kind === "note" &&
            b.right > r.left &&
            b.left < r.right &&
            b.bottom > r.top &&
            b.top < r.bottom
          );
        })
        .map((el) => el.dataset.item);
    }
    if (d.mode === "item" && d.originals) {
      const t = target(e.clientX, e.clientY, ui.sel),
        b = current();
      clearGuides();
      if (t.dest) {
        moveTo(t.dest, d.alt || e.altKey);
        return;
      }
      const canvas = document.querySelector(".canvas").getBoundingClientRect();
      if (
        e.clientX < canvas.left ||
        e.clientX > canvas.right ||
        e.clientY < canvas.top ||
        e.clientY > canvas.bottom
      ) {
        selection();
        return;
      }
      const dx = (e.clientX - d.start.x) / ui.cam.k,
        dy = (e.clientY - d.start.y) / ui.cam.k;
      for (const o of d.originals) {
        const i = byId(b.items, o.id);
        if (!i || ui.sel.includes(i.parent)) continue;
        i.parent = t.parent;
        i.col = t.col || 0;
        i.x = o.p.x + dx;
        i.y = o.p.y + dy;
        if (t.parent) {
          b.items.splice(b.items.indexOf(i), 1);
          const at = t.before
            ? b.items.findIndex((x) => x.id === t.before)
            : b.items.length;
          b.items.splice(at, 0, i);
        }
      }
      saveAndRender();
      return;
    }
    clearGuides();
    selection();
  }
  document.addEventListener("pointerdown", start);
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", finish);
  document.addEventListener("pointercancel", (e) => {
    pointers.delete(e.pointerId);
    drag = null;
    pinch = null;
    clearGuides();
    if (current()) selection();
  });
  document.addEventListener(
    "wheel",
    (e) => {
      if (!e.target.closest(".canvas")) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey)
        zoom(Math.exp(-e.deltaY * 0.012), e.clientX, e.clientY);
      else {
        ui.cam.x -= e.shiftKey ? e.deltaY : e.deltaX;
        ui.cam.y -= e.shiftKey ? 0 : e.deltaY;
        applyCamera();
        selection();
      }
    },
    { passive: false },
  );
  document.addEventListener("dragstart", (e) => {
    if (e.target.closest("[data-action=new-note]")) {
      external = "new";
      e.dataTransfer.setData("application/x-etch-new", "note");
      e.dataTransfer.effectAllowed = "copy";
      return;
    }
    const n = e.target.closest("[data-drawer-note]");
    if (!n) return;
    external = n.dataset.drawerNote;
    e.dataTransfer.setData("application/x-etch-note", external);
    e.dataTransfer.effectAllowed = "copy";
  });
  document.addEventListener("dragover", (e) => {
    if (!current() || !external || !e.target.closest(".canvas,[data-dest]"))
      return;
    e.preventDefault();
    guide(target(e.clientX, e.clientY));
  });
  document.addEventListener("drop", (e) => {
    if (!external || !current()) return;
    e.preventDefault();
    const t = target(e.clientX, e.clientY),
      ref = external;
    external = null;
    clearGuides();
    if (ref === "new") {
      if (!t.dest && e.target.closest(".canvas"))
        api.insertInline({
          ...worldPoint(e.clientX, e.clientY),
          parent: t.parent,
          col: t.col,
          before: t.before,
        });
      return;
    }
    if (t.dest) {
      const b = db.boards.find((b) => b.id === t.dest);
      if (!b.items.some((i) => i.ref === ref))
        b.items.push({
          id: crypto.randomUUID(),
          kind: "note",
          ref,
          x: 20,
          y: 20,
          parent: null,
          col: 0,
        });
      saveAndRender();
      return;
    }
    if (e.target.closest(".canvas"))
      insertDrawer(
        ref,
        worldPoint(e.clientX, e.clientY),
        t.parent,
        t.col,
        t.before,
      );
  });
  document.addEventListener("dragend", () => {
    external = null;
    clearGuides();
  });
}
