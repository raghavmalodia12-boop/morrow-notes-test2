import Image from "@tiptap/extension-image";
import { NodeSelection } from "@tiptap/pm/state";

// Image with Word-style resizing. Click an image, then drag:
//   - a side handle   -> moves that edge (width or height changes, the opposite edge stays put)
//   - a corner handle -> moves both edges freely (hold Shift to keep the proportions)
// Dragging the left/top handles inward shifts the image so the edge follows the cursor.
// Double-click an image to return it to its natural size and position.
// Saved with the note: width, height and the left/top offset.
const MIN = 40;

const num = v => {
  const n = parseInt(v || "", 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// width + aspect-ratio (instead of a fixed height) lets the image shrink on narrow screens without distorting further.
const styleFor = ({ width, height, ml, mt }) => {
  const parts = [];
  if (width && height) parts.push(`width:${width}px`, "height:auto", `aspect-ratio:${width} / ${height}`, "object-fit:fill");
  else if (width) parts.push(`width:${width}px`);
  if (ml) parts.push(`margin-left:${ml}px`);
  if (mt) parts.push(`margin-top:${mt}px`);
  return parts.join(";");
};

// ---- dragging the picture itself ----
// Sideways = slide it left/right (inside the note width). Up/down = move it between paragraphs.
const dropLine = () => {
  let l = document.querySelector(".img-drop-line");
  if (!l) { l = document.createElement("div"); l.className = "img-drop-line"; document.body.appendChild(l); }
  return l;
};
const hideDropLine = () => document.querySelector(".img-drop-line")?.remove();

// Finds the top-level block boundary (before/after a paragraph, table, image...) closest to the pointer.
function dropTarget(view, x, y) {
  const hit = view.posAtCoords({ left: x, top: y });
  if (!hit) return null;
  const doc = view.state.doc;
  let start, end;
  const $p = doc.resolve(hit.pos);
  if ($p.depth >= 1) { start = $p.before(1); end = $p.after(1); }
  else if (hit.inside >= 0 && doc.nodeAt(hit.inside)) { start = hit.inside; end = start + doc.nodeAt(start).nodeSize; }
  else return null;
  const dom = view.nodeDOM(start);
  if (!(dom instanceof HTMLElement)) return null;
  const r = dom.getBoundingClientRect();
  const before = y < r.top + r.height / 2;
  return { at: before ? start : end, y: before ? r.top : r.bottom, left: r.left, width: r.width };
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: el => num(el.getAttribute("width") || el.style.width),
        renderHTML: attrs => {
          const style = styleFor(attrs);
          return { ...(attrs.width ? { width: attrs.width } : {}), ...(style ? { style } : {}) };
        }
      },
      height: {
        default: null,
        parseHTML: el => num(el.getAttribute("height")),
        renderHTML: attrs => (attrs.height ? { height: attrs.height } : {})
      },
      ml: { default: 0, parseHTML: el => num(el.style.marginLeft) || 0, renderHTML: () => ({}) },
      mt: { default: 0, parseHTML: el => num(el.style.marginTop) || 0, renderHTML: () => ({}) }
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const wrap = document.createElement("span");
      wrap.className = "img-wrap";
      const img = document.createElement("img");
      wrap.appendChild(img);

      const place = (ml, mt) => {
        wrap.style.marginLeft = ml ? `${ml}px` : "";
        wrap.style.marginTop = mt ? `calc(.7em + ${mt}px)` : "";
      };
      const apply = n => {
        const { width, height, ml, mt } = n.attrs;
        img.src = n.attrs.src;
        img.alt = n.attrs.alt || "";
        if (n.attrs.title) img.title = n.attrs.title; else img.removeAttribute("title");
        img.style.width = width ? `${width}px` : "";
        img.style.height = width && height ? "auto" : "";
        img.style.aspectRatio = width && height ? `${width} / ${height}` : "";
        img.style.objectFit = width && height ? "fill" : "";
        place(ml, mt);
      };
      apply(node);

      ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach(dir => {
        const handle = document.createElement("span");
        handle.className = `img-handle ${dir}`;
        handle.setAttribute("aria-hidden", "true");
        handle.draggable = false;
        const block = e => { e.preventDefault(); e.stopPropagation(); };
        handle.addEventListener("mousedown", block);
        handle.addEventListener("dragstart", block);
        handle.addEventListener("touchstart", block, { passive: false });
        handle.addEventListener("pointerdown", e => {
          if (!editor.isEditable) return;
          e.preventDefault();
          e.stopPropagation();
          const pos = getPos();
          if (typeof pos !== "number") return;
          editor.chain().setNodeSelection(pos).run();
          const box = img.getBoundingClientRect();
          const start = { x: e.clientX, y: e.clientY, w: Math.round(box.width), h: Math.round(box.height), ml: current.attrs.ml || 0, mt: current.attrs.mt || 0 };
          const container = Math.max(MIN, wrap.parentElement?.clientWidth || 800);
          const sx = dir.includes("e") ? 1 : dir.includes("w") ? -1 : 0;
          const sy = dir.includes("s") ? 1 : dir.includes("n") ? -1 : 0;
          let size = { w: start.w, h: start.h, ml: start.ml, mt: start.mt };
          wrap.draggable = false;
          try { handle.setPointerCapture(e.pointerId); } catch {}

          const move = ev => {
            let dx = ev.clientX - start.x;
            let dy = ev.clientY - start.y;
            let { w, h } = start, ml = start.ml, mt = start.mt;
            if (sx > 0) w = Math.min(container - start.ml, Math.max(MIN, start.w + dx));
            if (sx < 0) { dx = Math.min(Math.max(dx, -start.ml), start.w - MIN); w = start.w - dx; ml = start.ml + dx; }
            if (sy > 0) h = Math.max(MIN, start.h + dy);
            if (sy < 0) { dy = Math.min(Math.max(dy, -start.mt), start.h - MIN); h = start.h - dy; mt = start.mt + dy; }
            if (ev.shiftKey && sx && sy) { // corner + Shift: keep proportions
              const kMax = Math.min(sx < 0 ? (start.w + start.ml) / start.w : (container - start.ml) / start.w, sy < 0 ? (start.h + start.mt) / start.h : Infinity);
              const kMin = Math.max(MIN / start.w, MIN / start.h);
              const k = Math.min(kMax, Math.max(kMin, Math.max(w / start.w, h / start.h)));
              w = start.w * k; h = start.h * k;
              ml = sx < 0 ? start.ml + (start.w - w) : start.ml;
              mt = sy < 0 ? start.mt + (start.h - h) : start.mt;
            }
            size = { w: Math.round(w), h: Math.round(h), ml: Math.round(ml), mt: Math.round(mt) };
            img.style.aspectRatio = "";
            img.style.objectFit = "fill";
            img.style.width = `${size.w}px`;
            img.style.height = `${size.h}px`;
            place(size.ml, size.mt);
          };
          const up = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("pointerup", up);
            handle.removeEventListener("pointercancel", up);
            wrap.draggable = true;
            const at = getPos();
            if (typeof at !== "number") return;
            if (size.w === start.w && size.h === start.h && size.ml === start.ml && size.mt === start.mt) return; // nothing changed
            editor.view.dispatch(editor.view.state.tr.setNodeMarkup(at, undefined, { ...current.attrs, width: size.w, height: size.h, ml: size.ml, mt: size.mt }));
          };
          handle.addEventListener("pointermove", move);
          handle.addEventListener("pointerup", up);
          handle.addEventListener("pointercancel", up);
        });
        wrap.appendChild(handle);
      });

      // Drag the picture: no native drag-and-drop (unreliable in Safari), so we do it with pointer events.
      img.addEventListener("pointerdown", e => {
        if (e.button !== 0 || !editor.isEditable) return;
        e.preventDefault();
        const pos = getPos();
        if (typeof pos !== "number") return;
        editor.chain().setNodeSelection(pos).run();
        const x0 = e.clientX, y0 = e.clientY;
        const ml0 = current.attrs.ml || 0;
        const mt0 = current.attrs.mt || 0;
        const room = Math.max(0, (wrap.parentElement?.clientWidth || 0) - img.getBoundingClientRect().width);
        let moved = false, ml = ml0, mt = mt0, drop = null;
        try { img.setPointerCapture(e.pointerId); } catch {}

        const move = ev => {
          const dx = ev.clientX - x0, dy = ev.clientY - y0;
          if (!moved && Math.hypot(dx, dy) < 5) return;
          moved = true;
          wrap.classList.add("moving");
          ml = Math.round(Math.min(room, Math.max(0, ml0 + dx)));
          mt = Math.round(mt0 + dy);
          place(ml, mt);
          drop = dropTarget(editor.view, ev.clientX, ev.clientY);
          const at = getPos();
          if (drop && typeof at === "number" && (drop.at === at || drop.at === at + current.nodeSize)) drop = null;
          if (drop) Object.assign(dropLine().style, { left: `${drop.left}px`, top: `${drop.y - 1}px`, width: `${drop.width}px` });
          else hideDropLine();
        };
        const up = () => {
          img.removeEventListener("pointermove", move);
          img.removeEventListener("pointerup", up);
          img.removeEventListener("pointercancel", up);
          hideDropLine();
          wrap.classList.remove("moving");
          if (!moved) return;
          const at = getPos();
          if (typeof at !== "number") return;
          const { state, dispatch } = editor.view;
          try {
            const n = state.doc.nodeAt(at);
            if (drop && state.doc.resolve(at).depth === 0) {
              const tr = state.tr.delete(at, at + n.nodeSize);
              const target = drop.at > at ? drop.at - n.nodeSize : drop.at;
              tr.insert(target, n.type.create({ ...n.attrs, ml }));
              tr.setSelection(NodeSelection.create(tr.doc, target));
              dispatch(tr.scrollIntoView());
            } else if (ml !== ml0 || mt !== mt0) {
              dispatch(state.tr.setNodeMarkup(at, undefined, { ...n.attrs, ml, mt }));
            } else place(ml0, mt0);
          } catch { apply(current); }
        };
        img.addEventListener("pointermove", move);
        img.addEventListener("pointerup", up);
        img.addEventListener("pointercancel", up);
      });

      img.addEventListener("dblclick", () => {
        const at = getPos();
        if (typeof at !== "number" || !editor.isEditable) return;
        editor.view.dispatch(editor.view.state.tr.setNodeMarkup(at, undefined, { ...current.attrs, width: null, height: null, ml: 0, mt: 0 }));
      });

      wrap.addEventListener("dragstart", e => { e.preventDefault(); e.stopPropagation(); }, true);

      return {
        dom: wrap,
        update: updated => {
          if (updated.type !== current.type) return false;
          current = updated;
          apply(updated);
          return true;
        },
        selectNode: () => wrap.classList.add("selected"),
        deselectNode: () => wrap.classList.remove("selected"),
        stopEvent: e => e.target instanceof HTMLElement && (e.target.classList.contains("img-handle") || (e.target === img && ["pointerdown", "mousedown", "touchstart", "dragstart"].includes(e.type))),
        ignoreMutation: () => true
      };
    };
  }
});
