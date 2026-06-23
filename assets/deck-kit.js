/* ============================================================
   COMPOUND DECK KIT — engine JS (full-page deck + author/presenter layer)
   Pair with deck-kit.css. Include once, after your slides:
       <script defer src="assets/deck-kit.js"></script>

   Gives any deck of <section class="slide"> elements:
     • scroll-snap nav (arrows / space / PgUp-Dn / Home-End), nav dots, progress bar
     • IntersectionObserver reveal (.reveal -> .visible) + staggered .d1..d8
     • count-up numbers: <span data-count="16500" data-prefix="$"> (opt data-decimals, data-suffix)
     • tap-to-reveal gate: wrap content in [data-gate] with a .reveal-gate button (Enter also fires)
     • presentation cursor: auto-contrast circle, grows over interactive targets (pointer devices)
     • Edit mode (E): contenteditable text, persisted to localStorage, survives reload
     • Mark mode (M): pin a note to any element, or drag a box anywhere to annotate a region
     • Speaker notes from <script id="speaker-notes"> JSON [{title,note},…] aligned to slide order:
         - inline panel (N) — EDITABLE while Edit mode is on
         - presenter window (P): current note, next-slide preview, timer; share only the deck window
     • Export edited HTML (notes + text baked in), Export PDF (print -> Save as PDF)
   Controls live top-center and only appear when the mouse is near the top edge.

   Customize the editable set with:  window.DECK_KIT_EDIT_SEL = "h1,h2,.my-class";
   Persisted keys are namespaced per deck (meta[name=deck-id] content, else pathname).
   To force-clear stale browser edits after baking, bump <meta name="deck-id"> value.
   by Compound Systems · usecompound.ai
============================================================ */
(() => {
  "use strict";
  const slides = Array.from(document.querySelectorAll(".slide"));
  if (!slides.length) return;

  const DECK_ID = (document.querySelector('meta[name="deck-id"]') || {}).content || location.pathname;
  const CHANNEL_NAME = "deckkit:" + DECK_ID;
  const LS_EDITS = "deckkit.edits:" + DECK_ID;
  const LS_ANNOT = "deckkit.annot:" + DECK_ID;
  const LS_REGIONS = "deckkit.regions:" + DECK_ID;
  const LS_NOTES = "deckkit.notes:" + DECK_ID;

  const DEFAULT_EDIT_SEL = "h1,h2,h3,h4,h5,h6,p,li,blockquote,.overline,.lead,.title-lead," +
    ".stat-number,.stat-label,.stat-sub,.real-tag,.real-hours,.real-unit,.real-foot," +
    ".phase-title,.phase-desc,.coach-t,.coach-d,.price-line,.glabel,.fn-t,.fn-n,.chip,.pill,.card-t,.card-d," +
    ".meta,.pg,.eq,.out-line,.price-item .k,.price-item .v,[data-edit]";
  const EDIT_SEL = window.DECK_KIT_EDIT_SEL || DEFAULT_EDIT_SEL;

  let NOTES = [];
  const notesTag = document.getElementById("speaker-notes");
  if (notesTag) { try { NOTES = JSON.parse(notesTag.textContent || "[]"); } catch (e) {} }

  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { return {}; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const isDark = (el) => {
    const m = getComputedStyle(el).backgroundColor.match(/\d+/g);
    if (!m) return false;
    return (0.299 * m[0] + 0.587 * m[1] + 0.114 * m[2]) < 128;
  };

  // speaker-note overrides (editable notes): { "<slideIndex>": "<html>" }
  let NOTE_OVERRIDES = lsGet(LS_NOTES);
  const noteFor = (i) => {
    const base = NOTES[i] || { title: "", note: "" };
    const ov = NOTE_OVERRIDES[i];
    return (typeof ov === "string") ? { title: base.title, note: ov } : base;
  };

  // theme-driven presenter accents
  const cs = getComputedStyle(document.documentElement);
  const ACC = (cs.getPropertyValue("--dk-accent") || "#1f6b63").trim() || "#1f6b63";
  const ACC2 = (cs.getPropertyValue("--dk-accent-2") || "#c9ae3c").trim() || "#c9ae3c";

  /* ---- inject chrome that isn't already present ---- */
  let progress = document.querySelector(".deck-progress");
  if (!progress) { progress = document.createElement("div"); progress.className = "deck-progress"; document.body.appendChild(progress); }
  let dotsNav = document.querySelector(".nav-dots");
  if (!dotsNav) { dotsNav = document.createElement("nav"); dotsNav.className = "nav-dots"; document.body.appendChild(dotsNav); }

  /* ---- count-up ---- */
  function countUp(el) {
    if (el.dataset.counted) return; el.dataset.counted = "1";
    const target = parseFloat(el.dataset.count), dec = parseInt(el.dataset.decimals || "0", 10);
    const pre = el.dataset.prefix || "", suf = el.dataset.suffix || "";
    const fmt = (n) => pre + n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf;
    const dur = 1100, t0 = performance.now(), ease = (t) => 1 - Math.pow(1 - t, 3);
    (function step(now) {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(target * ease(p));
      if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(target);
    })(performance.now());
  }

  /* ---- reveal + active tracking ---- */
  let curIndex = 0;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting && e.intersectionRatio >= 0.55) {
        e.target.classList.add("visible");
        e.target.querySelectorAll("[data-count]").forEach(countUp);
        curIndex = slides.indexOf(e.target); onSlideChange();
      }
    });
  }, { threshold: [0.55] });
  slides.forEach((s) => io.observe(s));

  function onSlideChange() {
    const dark = isDark(slides[curIndex]);
    dotsNav.querySelectorAll("button").forEach((b, i) => {
      b.classList.toggle("on", i === curIndex);
      b.classList.toggle("light", dark);
    });
    progress.style.width = ((curIndex + 1) / slides.length * 100) + "%";
    if (notesOpen) renderNotesPanel(curIndex);
    pushState(curIndex);
  }
  function goTo(i) {
    const n = Math.max(0, Math.min(i, slides.length - 1));
    slides[n].scrollIntoView({ behavior: "smooth", block: "start" });
  }

  slides.forEach((s, i) => {
    const b = document.createElement("button");
    b.setAttribute("aria-label", "Go to slide " + (i + 1));
    b.addEventListener("click", () => goTo(i));
    dotsNav.appendChild(b);
  });

  window.addEventListener("keydown", (e) => {
    const inEditable = e.target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
    if (inEditable) { if (e.key === "Escape") e.target.blur(); return; }
    if (e.key === "Enter") {
      const box = slides[curIndex] && slides[curIndex].querySelector("[data-gate]:not(.revealed)");
      if (box) { e.preventDefault(); box.classList.add("revealed"); return; }
    }
    if (["ArrowDown", "ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); goTo(curIndex + 1); }
    else if (["ArrowUp", "ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); goTo(curIndex - 1); }
    else if (e.key === "Home") { e.preventDefault(); goTo(0); }
    else if (e.key === "End") { e.preventDefault(); goTo(slides.length - 1); }
    else if (e.key === "e" || e.key === "E") setEditing(!editing);
    else if (e.key === "m" || e.key === "M") setAnnotating(!annotating);
    else if (e.key === "n" || e.key === "N") toggleNotes();
    else if (e.key === "p" || e.key === "P") openPresenter();
    else if (e.key === "Escape") { closePopover(); if (editing) setEditing(false); if (annotating) setAnnotating(false); }
  });

  /* ---- tap-to-reveal gates ---- */
  function initGates() {
    document.querySelectorAll(".reveal-gate").forEach((g) => {
      g.addEventListener("click", (e) => { e.preventDefault(); const box = g.closest("[data-gate]"); if (box) box.classList.add("revealed"); });
    });
  }

  /* ---- presentation cursor ---- */
  let deckCursor = null, cursorX = 0, cursorY = 0, cursorRaf = null;
  function initCursor() {
    if (!window.matchMedia || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    deckCursor = document.createElement("div");
    deckCursor.className = "deck-cursor hidden";
    document.body.appendChild(deckCursor);
    document.body.classList.add("deck-cursor-on");
    window.addEventListener("mousemove", (e) => {
      cursorX = e.clientX; cursorY = e.clientY;
      deckCursor.classList.remove("hidden");
      if (!cursorRaf) cursorRaf = requestAnimationFrame(() => {
        cursorRaf = null;
        deckCursor.style.transform = "translate(" + cursorX + "px," + cursorY + "px) translate(-50%,-50%)";
      });
      const hot = e.target.closest && e.target.closest("a,button,.nav-dots button,.reveal-gate,[data-act],[contenteditable='true']");
      deckCursor.classList.toggle("hot", !!hot);
    }, { passive: true });
    document.addEventListener("mouseleave", () => deckCursor && deckCursor.classList.add("hidden"));
  }
  function updateCursorMode() {
    if (!deckCursor) return;
    const native = editing || annotating;   // hand the caret back while editing/annotating
    document.body.classList.toggle("deck-cursor-on", !native);
    deckCursor.classList.toggle("hidden", native);
  }

  /* ===================== AUTHOR LAYER ===================== */
  function assignIds() {
    slides.forEach((slide, si) => {
      let n = 0;
      slide.querySelectorAll(EDIT_SEL).forEach((el) => { if (!el.dataset.eaId) el.dataset.eaId = "s" + si + "-e" + n; n++; });
    });
  }

  let editing = false, saveTimer = null;
  function rehydrateEdits() {
    const saved = lsGet(LS_EDITS);
    slides.forEach((slide) => slide.querySelectorAll("[data-ea-id]").forEach((el) => {
      const v = saved[el.dataset.eaId]; if (typeof v === "string") el.innerHTML = v;
    }));
  }
  function persistEdits() {
    const saved = lsGet(LS_EDITS);
    slides.forEach((slide) => slide.querySelectorAll("[data-ea-id]").forEach((el) => { saved[el.dataset.eaId] = el.innerHTML; }));
    lsSet(LS_EDITS, saved); flash("Edits saved");
  }
  function setEditing(on) {
    editing = on; document.body.classList.toggle("ea-editing", on);
    slides.forEach((slide) => slide.querySelectorAll("[data-ea-id]").forEach((el) => {
      if (on) { el.setAttribute("contenteditable", "true"); el.setAttribute("spellcheck", "false"); }
      else el.removeAttribute("contenteditable");
    }));
    if (!on) persistEdits();
    if (notesOpen) renderNotesPanel(curIndex);   // toggle note editability
    syncButtons(); updateCursorMode();
  }
  document.addEventListener("input", (e) => {
    if (editing && e.target.closest("[data-ea-id]")) { clearTimeout(saveTimer); saveTimer = setTimeout(persistEdits, 400); }
  });
  function resetEdits() {
    if (!confirm("Clear all saved text edits, notes and marks, then reload the original?")) return;
    try { [LS_EDITS, LS_ANNOT, LS_REGIONS, LS_NOTES].forEach((k) => localStorage.removeItem(k)); } catch (e) {}
    location.reload();
  }

  /* ---- annotations ---- */
  let annotating = false;
  function setAnnotating(on) { annotating = on; document.body.classList.toggle("ea-annotating", on); syncButtons(); updateCursorMode(); }
  function annId(el) {
    if (el.dataset.eaAid) return el.dataset.eaAid;
    let aid; do { aid = "a" + Math.random().toString(36).slice(2, 7); } while (document.querySelector('[data-ea-aid="' + aid + '"]'));
    el.dataset.eaAid = aid; return aid;
  }
  function addMarker(el, text) {
    el.querySelectorAll(":scope > .ea-marker").forEach((m) => m.remove());
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    const m = document.createElement("span");
    m.className = "ea-marker"; m.textContent = "✎"; m.title = text;
    m.addEventListener("click", (ev) => { ev.stopPropagation(); openPopover(el, text); });
    el.appendChild(m);
  }
  function rehydrateAnnotations() {
    const saved = lsGet(LS_ANNOT);
    Object.entries(saved).forEach(([aid, rec]) => {
      const el = rec.editId ? document.querySelector('[data-ea-id="' + rec.editId + '"]') : null;
      if (el) { el.dataset.eaAid = aid; addMarker(el, rec.text); }
    });
  }
  function saveAnnotation(el, text) {
    const aid = annId(el), saved = lsGet(LS_ANNOT);
    if (text.trim()) { saved[aid] = { editId: el.dataset.eaId || null, text }; addMarker(el, text); }
    else { delete saved[aid]; el.querySelectorAll(":scope > .ea-marker").forEach((m) => m.remove()); }
    lsSet(LS_ANNOT, saved);
  }
  let popoverEl = null, pendingRegion = null;
  function _openPopover(rect, existing, onSave, onDelete) {
    closePopover();
    const pop = document.createElement("div"); pop.className = "ea-popover";
    pop.innerHTML = '<textarea placeholder="Note to self…">' + (existing || "") + '</textarea><div class="ea-pop-row"><button class="ea-pop-del">Delete</button><button class="ea-pop-save">Save</button></div>';
    document.body.appendChild(pop);
    pop.style.left = Math.min(rect.left, window.innerWidth - 320) + "px";
    pop.style.top = Math.min(rect.bottom + 8, window.innerHeight - 170) + "px";
    const ta = pop.querySelector("textarea"); ta.focus();
    pop.querySelector(".ea-pop-save").onclick = () => { onSave(ta.value); pendingRegion = null; closePopover(); };
    pop.querySelector(".ea-pop-del").onclick = () => { onDelete(); pendingRegion = null; closePopover(); };
    popoverEl = pop;
  }
  function openPopover(el, existing) {
    _openPopover(el.getBoundingClientRect(), existing, (v) => saveAnnotation(el, v), () => saveAnnotation(el, ""));
  }
  function closePopover() {
    if (popoverEl) { popoverEl.remove(); popoverEl = null; }
    if (pendingRegion) {
      const { slide, rid } = pendingRegion; pendingRegion = null;
      if (!lsGet(LS_REGIONS)[rid]) { const b = slide.querySelector('[data-ea-rid="' + rid + '"]'); if (b) b.remove(); }
    }
  }

  /* ---- free-form region annotations: drag a box anywhere, pin a note to it ---- */
  function regId() { let id; do { id = "r" + Math.random().toString(36).slice(2, 7); } while (document.querySelector('[data-ea-rid="' + id + '"]')); return id; }
  function addRegion(slide, rid, rec) {
    if (getComputedStyle(slide).position === "static") slide.style.position = "relative";
    let box = slide.querySelector('[data-ea-rid="' + rid + '"]');
    if (!box) {
      box = document.createElement("div"); box.className = "ea-region"; box.dataset.eaRid = rid;
      const m = document.createElement("span"); m.className = "ea-marker"; m.textContent = "✎"; box.appendChild(m);
      box.addEventListener("click", (ev) => { ev.stopPropagation(); ev.preventDefault(); openRegionPopover(slide, rid); });
      slide.appendChild(box);
    }
    box.style.left = rec.x + "%"; box.style.top = rec.y + "%"; box.style.width = rec.w + "%"; box.style.height = rec.h + "%";
    box.querySelector(".ea-marker").title = rec.text || "";
  }
  function saveRegion(slide, rid, rec, text) {
    const saved = lsGet(LS_REGIONS);
    if (text.trim()) { rec.text = text; saved[rid] = rec; addRegion(slide, rid, rec); }
    else { delete saved[rid]; const b = slide.querySelector('[data-ea-rid="' + rid + '"]'); if (b) b.remove(); }
    lsSet(LS_REGIONS, saved);
  }
  function openRegionPopover(slide, rid) {
    const rec = lsGet(LS_REGIONS)[rid]; if (!rec) return;
    const box = slide.querySelector('[data-ea-rid="' + rid + '"]');
    _openPopover(box.getBoundingClientRect(), rec.text || "", (v) => saveRegion(slide, rid, rec, v), () => saveRegion(slide, rid, rec, ""));
  }
  function rehydrateRegions() {
    Object.entries(lsGet(LS_REGIONS)).forEach(([rid, rec]) => { const s = slides[rec.slide]; if (s) addRegion(s, rid, rec); });
  }
  let drawStart = null, rubber = null, didDraw = false, suppressNextClick = false;
  document.addEventListener("mousedown", (e) => {
    if (!annotating || e.button !== 0) return;
    if (e.target.closest(".ea-controls, .ea-popover, .ea-marker, .ea-region")) return;
    const slide = e.target.closest(".slide"); if (!slide) return;
    drawStart = { slide, x: e.clientX, y: e.clientY }; didDraw = false;
  }, true);
  document.addEventListener("mousemove", (e) => {
    if (!drawStart) return;
    const dx = e.clientX - drawStart.x, dy = e.clientY - drawStart.y;
    if (!didDraw && Math.abs(dx) + Math.abs(dy) < 6) return;
    didDraw = true;
    if (!rubber) { rubber = document.createElement("div"); rubber.className = "ea-region-draw"; document.body.appendChild(rubber); }
    rubber.style.left = Math.min(e.clientX, drawStart.x) + "px"; rubber.style.top = Math.min(e.clientY, drawStart.y) + "px";
    rubber.style.width = Math.abs(dx) + "px"; rubber.style.height = Math.abs(dy) + "px";
  }, true);
  document.addEventListener("mouseup", (e) => {
    if (!drawStart) return;
    const start = drawStart; drawStart = null;
    if (rubber) { rubber.remove(); rubber = null; }
    if (!didDraw) return;
    e.preventDefault(); e.stopPropagation(); suppressNextClick = true;
    const slide = start.slide, sr = slide.getBoundingClientRect();
    const x1 = Math.min(e.clientX, start.x), y1 = Math.min(e.clientY, start.y);
    const x2 = Math.max(e.clientX, start.x), y2 = Math.max(e.clientY, start.y);
    const rec = { slide: slides.indexOf(slide), x: (x1 - sr.left) / sr.width * 100, y: (y1 - sr.top) / sr.height * 100,
      w: (x2 - x1) / sr.width * 100, h: (y2 - y1) / sr.height * 100, text: "" };
    const rid = regId(); addRegion(slide, rid, rec); pendingRegion = { slide, rid };
    _openPopover(slide.querySelector('[data-ea-rid="' + rid + '"]').getBoundingClientRect(), "",
      (v) => saveRegion(slide, rid, rec, v), () => saveRegion(slide, rid, rec, ""));
  }, true);
  document.addEventListener("click", (e) => {
    if (suppressNextClick) { suppressNextClick = false; e.preventDefault(); e.stopPropagation(); return; }
    if (annotating) {
      const slide = e.target.closest(".slide");
      if (slide && !e.target.closest(".ea-marker") && !e.target.closest(".ea-region") && !e.target.closest(".ea-controls")) {
        const el = e.target.closest("[data-ea-id]");
        if (el) { e.preventDefault(); e.stopPropagation(); const saved = lsGet(LS_ANNOT); openPopover(el, saved[el.dataset.eaAid] ? saved[el.dataset.eaAid].text : ""); return; }
      }
    }
    if (popoverEl && !e.target.closest(".ea-popover") && !e.target.closest(".ea-marker") && !e.target.closest(".ea-region")) closePopover();
  }, true);

  /* ---- speaker notes: inline panel (editable in Edit mode) ---- */
  let notesPanel = null, notesOpen = false, noteSaveT = null;
  function buildNotesPanel() {
    const p = document.createElement("div"); p.className = "ea-notes-panel";
    p.innerHTML = '<div class="ea-np-head"><span class="ea-np-label"></span><button class="ea-np-close" aria-label="Close notes">×</button></div><div class="ea-np-body"></div>';
    p.querySelector(".ea-np-close").onclick = () => toggleNotes(false);
    const body = p.querySelector(".ea-np-body");
    body.addEventListener("input", () => {
      if (!editing) return;
      NOTE_OVERRIDES[curIndex] = body.innerHTML;
      lsSet(LS_NOTES, NOTE_OVERRIDES);
      clearTimeout(noteSaveT); noteSaveT = setTimeout(() => { pushState(curIndex); flash("Note saved"); }, 350);
    });
    document.body.appendChild(p); notesPanel = p;
  }
  function renderNotesPanel(i) {
    if (!notesPanel) return; const n = noteFor(i);
    notesPanel.querySelector(".ea-np-label").innerHTML = "Slide " + (i + 1) + " · " + (n.title || "")
      + (editing ? '<span class="ea-np-hint">editable</span>' : '');
    const body = notesPanel.querySelector(".ea-np-body");
    body.innerHTML = n.note || (editing ? "" : "<em style='opacity:.5'>No note.</em>");
    body.setAttribute("contenteditable", editing ? "true" : "false");
    body.setAttribute("spellcheck", "false");
    notesPanel.classList.toggle("editing", editing);
  }
  function toggleNotes(force) {
    notesOpen = typeof force === "boolean" ? force : !notesOpen;
    if (notesOpen && !notesPanel) buildNotesPanel();
    if (notesPanel) notesPanel.classList.toggle("open", notesOpen);
    if (notesOpen) renderNotesPanel(curIndex); syncButtons();
  }

  /* ---- speaker notes: presenter window ---- */
  const bc = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;
  function presenterState(i) {
    const cur = noteFor(i), nxt = noteFor(i + 1);
    return { type: "state", index: i, total: slides.length, label: cur.title || "", note: cur.note || "",
      nextLabel: i + 1 < slides.length ? (nxt.title || "") : "— end —", nextNote: i + 1 < slides.length ? (nxt.note || "") : "" };
  }
  function pushState(i) { if (bc) bc.postMessage(presenterState(i)); }
  if (bc) bc.onmessage = (e) => { const d = e.data || {}; if (d.type === "hello") pushState(curIndex); else if (d.type === "nav") goTo(curIndex + d.dir); else if (d.type === "goto") goTo(d.index); };
  function openPresenter() {
    const w = window.open("", "deckkit-presenter", "width=760,height=820");
    if (!w) { flash("Allow pop-ups to open presenter view"); return; }
    w.document.write(PRESENTER_HTML); w.document.close();
    setTimeout(() => pushState(curIndex), 200);
  }
  const PRESENTER_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Presenter</title>'
    + '<style>:root{--acc:' + ACC + ';--acc2:' + ACC2 + '}*{box-sizing:border-box;margin:0}body{background:#0c1c1c;color:#f4f2ed;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:26px 30px;height:100vh;display:flex;flex-direction:column;gap:18px}.bar{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.12);padding-bottom:14px}.timer{font-variant-numeric:tabular-nums;font-size:34px;font-weight:700}.pos{font-family:ui-monospace,Menlo,monospace;font-size:15px;color:rgba(244,242,237,.6)}.tbtns button,.nav button{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);color:#f4f2ed;border-radius:7px;padding:7px 13px;font-size:13px;cursor:pointer;margin-left:6px}.label{font-size:13px;text-transform:uppercase;letter-spacing:.14em;color:var(--acc);font-weight:700}.cur-title{font-size:25px;font-weight:600;margin-top:4px}.note{flex:1;overflow-y:auto;font-size:24px;line-height:1.55;padding:6px 2px}.note strong{color:var(--acc2)}.note em{color:rgba(244,242,237,.4)}.next{border-top:1px solid rgba(255,255,255,.12);padding-top:14px}.next .label{color:var(--acc2)}.next-title{font-size:18px;color:rgba(244,242,237,.85);margin-top:3px}.next-note{font-size:14px;color:rgba(244,242,237,.5);margin-top:5px;line-height:1.45;max-height:3em;overflow:hidden}.nav{display:flex;justify-content:space-between}</style></head><body>'
    + '<div class="bar"><div class="timer" id="timer">00:00</div><div class="tbtns"><button id="tStart">Start</button><button id="tReset">Reset</button></div><div class="pos" id="pos">— / —</div></div>'
    + '<div><div class="label">Current slide</div><div class="cur-title" id="curTitle"></div></div><div class="note" id="note"></div>'
    + '<div class="next"><div class="label">Up next</div><div class="next-title" id="nextTitle"></div><div class="next-note" id="nextNote"></div></div>'
    + '<div class="nav"><button id="prev">← Prev</button><button id="next">Next →</button></div>'
    + '<scr' + 'ipt>var bc=new BroadcastChannel(' + JSON.stringify(CHANNEL_NAME) + ');bc.postMessage({type:"hello"});'
    + 'bc.onmessage=function(e){var d=e.data||{};if(d.type!=="state")return;document.getElementById("pos").textContent=(d.index+1)+" / "+d.total;document.getElementById("curTitle").textContent=d.label||"";document.getElementById("note").innerHTML=d.note||"<em>No note.</em>";document.getElementById("nextTitle").textContent=d.nextLabel||"";document.getElementById("nextNote").innerHTML=d.nextNote||"";};'
    + 'document.getElementById("prev").onclick=function(){bc.postMessage({type:"nav",dir:-1});};document.getElementById("next").onclick=function(){bc.postMessage({type:"nav",dir:1});};'
    + 'document.addEventListener("keydown",function(e){if(e.key==="ArrowRight"||e.key===" "||e.key==="PageDown")bc.postMessage({type:"nav",dir:1});if(e.key==="ArrowLeft"||e.key==="PageUp")bc.postMessage({type:"nav",dir:-1});});'
    + 'var t0=null,acc=0,iv=null;function fmt(s){return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");}function tick(){var s=Math.floor((acc+(t0?Date.now()-t0:0))/1000);document.getElementById("timer").textContent=fmt(s);}'
    + 'document.getElementById("tStart").onclick=function(){if(t0){acc+=Date.now()-t0;t0=null;clearInterval(iv);this.textContent="Start";}else{t0=Date.now();iv=setInterval(tick,250);this.textContent="Pause";}};'
    + 'document.getElementById("tReset").onclick=function(){t0=null;acc=0;clearInterval(iv);document.getElementById("tStart").textContent="Start";tick();};'
    + '</scr' + 'ipt></body></html>';

  /* ---- export ---- */
  // Read a stylesheet's CSS as text — fetch the href (works over http), fall
  // back to walking cssRules (works when same-origin rules are accessible).
  async function cssTextFor(sheet) {
    if (sheet.href) {
      try { const r = await fetch(sheet.href); if (r.ok) return await r.text(); } catch (e) {}
    }
    try { return Array.from(sheet.cssRules).map((r) => r.cssText).join("\n"); } catch (e) { return ""; }
  }
  async function exportHTML() {
    if (editing) persistEdits();
    flash("Bundling…");
    const clones = slides.map((s) => {
      const c = s.cloneNode(true);
      c.querySelectorAll("[data-ea-id]").forEach((el) => { el.removeAttribute("contenteditable"); el.removeAttribute("spellcheck"); el.removeAttribute("data-ea-id"); el.removeAttribute("data-ea-aid"); });
      c.querySelectorAll(".ea-marker, .ea-region").forEach((m) => m.remove());
      c.classList.remove("visible");
      return c.outerHTML;
    }).join("\n");
    // bake current notes (incl. edited overrides) back into the JSON tag
    const bakedNotes = NOTES.length
      ? '<script type="application/json" id="speaker-notes">' + JSON.stringify(slides.map((s, i) => { const n = noteFor(i); return { title: n.title || "", note: n.note || "" }; })) + '<\/script>'
      : "";
    // Inline every stylesheet (engine + theme) so the saved file is self-contained.
    // Relative <link href> would break once the file moves to ~/Downloads.
    const sheetTexts = await Promise.all(Array.from(document.styleSheets).map(cssTextFor));
    const bakedStyles = sheetTexts.filter(Boolean).map((t) => "<style>\n" + t + "\n</style>").join("\n");
    const inlineStyles = Array.from(document.querySelectorAll('head style')).map((s) => s.outerHTML).join("\n");
    const metas = Array.from(document.querySelectorAll('head meta')).map((m) => m.outerHTML).join("\n");
    // Inline the engine JS so nav/reveals/edit/notes work from the saved file.
    // External <script src> (modular decks): fetch the source (works over http).
    const extTexts = await Promise.all(Array.from(document.querySelectorAll('script[src]')).map(async (s) => {
      try { const r = await fetch(s.src); if (r.ok) return await r.text(); } catch (e) {} return "";
    }));
    // Inline <script> blocks (self-contained decks): re-emit verbatim, but skip
    // the speaker-notes JSON (re-emitted above as bakedNotes) to avoid duplicates.
    const inlineScripts = Array.from(document.querySelectorAll('script:not([src])'))
      .filter((s) => (s.type || "").toLowerCase() !== "application/json" && s.id !== "speaker-notes")
      .map((s) => s.textContent).filter(Boolean);
    const bakedScripts = extTexts.filter(Boolean).concat(inlineScripts).map((t) => "<script>\n" + t + "\n<\/script>").join("\n");
    const titleTag = '<title>' + (document.title || "deck") + '</title>';
    const htmlAttrs = document.documentElement.getAttribute("data-theme") ? ' data-theme="' + document.documentElement.getAttribute("data-theme") + '"' : "";
    const html = "<!DOCTYPE html><html lang=\"en\"" + htmlAttrs + "><head>\n" + metas + "\n" + titleTag + "\n" + bakedStyles + "\n" + inlineStyles + "\n</head><body>\n" + clones + "\n" + bakedNotes + "\n" + bakedScripts + "\n</body></html>";
    const blob = new Blob([html], { type: "text/html" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = (document.title || "deck") + " — edited.html"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000); flash("HTML exported (self-contained)");
  }
  function exportPDF() {
    flash("Print dialog → choose 'Save as PDF'");
    // Leave edit/annotate modes so contenteditable focus boxes + dashed
    // outlines never bleed into the printed page.
    if (editing) setEditing(false);
    if (annotating) setAnnotating(false);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    slides.forEach((s) => s.classList.add("visible"));
    document.querySelectorAll("[data-gate]").forEach((g) => g.classList.add("revealed"));
    setTimeout(() => window.print(), 350);
  }

  /* ---- controls + hover-reveal ---- */
  let controls = null;
  function buildControls() {
    const c = document.createElement("div"); c.className = "ea-controls";
    c.innerHTML = '<button data-act="edit" title="Edit text + notes (E)">✎ Edit</button>'
      + '<button data-act="annotate" title="Mark / draw a note (M)">⚑ Mark</button>'
      + '<button data-act="notes" title="Speaker notes (N)">▤ Notes</button>'
      + '<button data-act="present" title="Presenter window (P)">⧉ Present</button>'
      + '<button data-act="exporthtml" title="Export edited HTML">↓ HTML</button>'
      + '<button data-act="exportpdf" title="Export PDF">↓ PDF</button>'
      + '<button data-act="reset" class="ea-mini" title="Clear saved edits / notes / marks">⟲</button>';
    c.addEventListener("click", (e) => {
      const a = e.target.closest("button"); if (!a) return;
      ({ edit: () => setEditing(!editing), annotate: () => setAnnotating(!annotating), notes: () => toggleNotes(),
         present: openPresenter, exporthtml: exportHTML, exportpdf: exportPDF, reset: resetEdits }[a.dataset.act] || (() => {}))();
    });
    document.body.appendChild(c); controls = c;
  }
  function syncButtons() {
    if (!controls) return;
    controls.querySelector('[data-act="edit"]').classList.toggle("on", editing);
    controls.querySelector('[data-act="annotate"]').classList.toggle("on", annotating);
    controls.querySelector('[data-act="notes"]').classList.toggle("on", notesOpen);
  }
  window.addEventListener("mousemove", (e) => {
    if (!controls) return;
    if (e.clientY < 90) controls.classList.add("near-top");
    else if (e.clientY > 170 && !controls.matches(":hover")) controls.classList.remove("near-top");
  }, { passive: true });

  let toast = null, toastT = null;
  function flash(msg) {
    if (!toast) { toast = document.createElement("div"); toast.className = "ea-toast"; document.body.appendChild(toast); }
    toast.textContent = msg; toast.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove("show"), 1500);
  }

  /* ---- init ---- */
  assignIds();
  rehydrateEdits();
  rehydrateAnnotations();
  rehydrateRegions();
  buildControls();
  initGates();
  initCursor();
  slides[0].classList.add("visible");
  slides[0].querySelectorAll("[data-count]").forEach(countUp);
  onSlideChange();

  // expose a tiny hook for theme switchers / external buttons
  window.DeckKit = { goTo: goTo, present: openPresenter, edit: () => setEditing(!editing) };
})();
