import React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search, Plus, Zap, Trash2, X, Sun, Moon, UserRound, Camera, ChevronLeft, LogOut,
  ListChecks, Table as TableIcon, Paperclip, Share, Ellipsis, Bold, Italic, Underline as UnderlineIcon,
  Strikethrough, List, ListOrdered, Pin, PinOff, Copy, CopyPlus, Download, Printer
} from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import { ResizableImage } from "./ResizableImage.js";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { auth, firebaseConfigured, googleProvider } from "./firebase.js";
import { apiRequest } from "./api.js";

const API = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? "/api" : "http://localhost:5002/api");
const API_ORIGIN = API.replace(/\/api\/?$/, "");
const COLORS = ["yellow", "blue", "pink", "green", "purple"];
const COLOR_NAMES = { yellow: "Sun", blue: "Sky", pink: "Bloom", green: "Moss", purple: "Dusk" };
const UNTITLED = "Untitled note";
const MAX_AVATAR = 10 * 1024 * 1024;
const MAX_ATTACHMENT = 20 * 1024 * 1024;
const NO_SERVER = "Can't reach the server. Start the backend and check the MongoDB connection.";

/* ---------- helpers ---------- */
const avatarSrc = p => (p?.avatarUrl && !p.avatarUrl.startsWith("http") ? `${API_ORIGIN}${p.avatarUrl}` : null);
// Uploaded photo if there is one, otherwise a coloured circle with the first letters of the name (like Google).
const AVATAR_COLORS = ["#d93025", "#e8710a", "#b06000", "#188038", "#0b8a8a", "#1a73e8", "#5b4bdb", "#a142f4", "#d01884", "#7a5c3e"];
function initialsOf(name) {
  const words = String(name || "").replace(/@.*$/, "").split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return "?";
  const first = [...words[0]][0], last = words.length > 1 ? [...words[words.length - 1]][0] : "";
  return (first + last).toUpperCase();
}
function Avatar({ src, name, size }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  if (src && !bad) return <img src={src} alt="Profile photo" onError={() => setBad(true)} />;
  const text = String(name || "?");
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return <span className="initials" style={{ background: AVATAR_COLORS[hash % AVATAR_COLORS.length], fontSize: size * 0.42 }} aria-label={text}>{initialsOf(text)}</span>;
}
const stampFmt = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("en", { weekday: "long" });
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysAgo = date => Math.round((startOfDay(new Date()) - startOfDay(new Date(date))) / 86400000);

function listDate(date) {
  const n = daysAgo(date);
  if (n <= 0) return timeFmt.format(new Date(date));
  if (n === 1) return "Yesterday";
  if (n < 7) return dayFmt.format(new Date(date));
  return new Date(date).toLocaleDateString("en-US");
}

const escapeHtml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const HTML_RE = /^\s*<(p|h[1-6]|ul|ol|table|div|blockquote|img|pre|hr)\b/i;
const prettySize = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Notes saved before the rich editor are plain text; show them as paragraphs.
function toEditorHtml(content) {
  if (!content) return "";
  const html = HTML_RE.test(content) ? content : content.split("\n").map(l => `<p>${escapeHtml(l)}</p>`).join("");
  return html.replace(/(src|href)="\/uploads\//g, `$1="${API_ORIGIN}/uploads/`);
}
// Attachments are stored with relative paths so the app still works if the server address changes.
const stripOrigin = html => html.split(`${API_ORIGIN}/uploads/`).join("/uploads/");

const textCache = new Map();
function textOf(content) {
  if (!content) return "";
  if (!HTML_RE.test(content)) return content;
  const hit = textCache.get(content);
  if (hit !== undefined) return hit;
  const doc = new DOMParser().parseFromString(content, "text/html");
  doc.querySelectorAll("li,p,h1,h2,h3,h4,tr,blockquote,pre,div").forEach(el => el.append("\n"));
  doc.querySelectorAll("td,th").forEach(el => el.append(" "));
  const text = (doc.body.textContent || "").replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
  if (textCache.size > 500) textCache.clear();
  textCache.set(content, text);
  return text;
}

const linesOf = content => textOf(content).split("\n").map(l => l.trim()).filter(Boolean);
const firstLine = content => linesOf(content)[0] || "";
const hasTitle = n => n.title && n.title !== UNTITLED;
const displayTitle = n => (hasTitle(n) ? n.title : firstLine(n.content) || UNTITLED);
const previewOf = n => (hasTitle(n) ? linesOf(n.content) : linesOf(n.content).slice(1)).join(" ").slice(0, 160) || "No additional text";
const byPinnedThenDate = (a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || new Date(b.updatedAt) - new Date(a.updatedAt);

async function shrinkImage(file, max = 768) {
  if (file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob ? new File([blob], "avatar.jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}

// Optional "shrink photos" setting: resize big photos (max 1600px) and re-encode before upload.
async function compressPhoto(file, max = 1600) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file; // GIFs stay as they are (animation)
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d");
    const jpeg = file.type === "image/jpeg";
    if (jpeg) { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const type = jpeg ? "image/jpeg" : "image/webp"; // PNG/WEBP -> WEBP keeps transparency
    const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.82));
    if (!blob || blob.type !== type || blob.size >= file.size) return file; // never make it bigger
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.${jpeg ? "jpg" : "webp"}`, { type });
  } catch { return file; }
}

function SunMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs><linearGradient id="dawn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ff8f6b" /><stop offset="1" stopColor="#ffd36e" /></linearGradient></defs>
      <rect width="32" height="32" rx="9" fill="#2a2766" />
      <path d="M7 21a9 9 0 0118 0z" fill="url(#dawn)" />
      <rect x="5" y="22.4" width="22" height="2.4" rx="1.2" fill="#fff" opacity=".92" />
    </svg>
  );
}

function newSession(note) {
  return {
    id: note?._id || null,
    title: note ? (note.title === UNTITLED ? "" : note.title) : "",
    content: note?.content || "",
    color: note?.color || "yellow",
    pinned: Boolean(note?.pinned),
    dirty: false, saving: false, dead: false, timer: null
  };
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState("");
  const [profile, setProfile] = useState(null);
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem("mn-theme") || "light"; } catch { return "light"; } });
  const [shrinkUploads, setShrinkUploads] = useState(() => { try { return localStorage.getItem("mn-shrink") !== "off"; } catch { return true; } });
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(null);

  const [notes, setNotes] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState({ title: "", content: "", color: "yellow", pinned: false });
  const [docKey, setDocKey] = useState(0);
  const [view, setView] = useState("list");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menu, setMenu] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [quick, setQuick] = useState("");
  const [fresh, setFresh] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const userRef = useRef(null);
  const session = useRef(newSession());
  const titleRef = useRef(null);
  const fileRef = useRef(null);
  const opened = useRef(false);
  const updateRef = useRef(() => {});
  const uploadRef = useRef(() => {});
  const keyRef = useRef({});
  userRef.current = user;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } }),
      ResizableImage,
      Placeholder.configure({ placeholder: "Start writing" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow, TableHeader, TableCell
    ],
    content: "",
    editorProps: {
      attributes: { class: "prose", "aria-label": "Note" },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files || [])];
        if (!files.length) return false;
        uploadRef.current(files);
        return true;
      },
      handleDrop: (_view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files || [])];
        if (moved || !files.length) return false;
        event.preventDefault();
        uploadRef.current(files);
        return true;
      }
    },
    onUpdate: ({ editor: ed }) => updateRef.current(ed)
  });

  useEffect(() => onAuthStateChanged(auth, async current => {
    setUser(current);
    setAuthLoading(false);
    if (current) {
      try {
        const p = await apiRequest("/users/me", { user: current });
        setProfile(p);
        setProfileName(p.displayName || current.displayName || "");
        if (p.theme) setTheme(p.theme);
      } catch (e) { setAuthError(e.message); }
    } else {
      setProfile(null);
      setProfileName("");
      setNotes([]);
      opened.current = false;
    }
  }), []);

  // Cmd+Delete (Mac) / Ctrl+Delete: delete the selected note. Press once to confirm, again to delete.
  // Ignored while typing in the editor or a field, where it keeps its normal "delete line/word" meaning.
  useEffect(() => {
    const onKey = e => {
      const k = keyRef.current;
      if (e.key === "Escape" && k.confirmDelete) { setConfirmDelete(false); return; }
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.repeat) return;
      const t = e.target;
      const typing = t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (typing || !k.selectedId || k.profileOpen) return;
      e.preventDefault();
      if (k.confirmDelete) k.removeNote(); else setConfirmDelete(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("mn-theme", theme); } catch {}
  }, [theme]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 1800);
    return () => clearTimeout(t);
  }, [notice]);

  /* ---------- notes: load, save ---------- */
  const upsert = useCallback(saved => {
    setNotes(cur => [saved, ...cur.filter(n => n._id !== saved._id)].sort(byPinnedThenDate));
  }, []);

  const persist = useCallback(async s => {
    if (s.dead) return;
    if (s.saving) { s.dirty = true; return; }
    s.saving = true;
    setSaving(true);
    try {
      do {
        s.dirty = false;
        const body = { title: s.title, content: s.content, color: s.color, pinned: s.pinned };
        if (!s.id && !body.title.trim() && !body.content.trim()) break;
        const saved = await apiRequest(s.id ? `/notes/${s.id}` : "/notes", {
          user: userRef.current,
          method: s.id ? "PUT" : "POST",
          body: JSON.stringify(body)
        });
        if (s.dead) break;
        s.id = saved._id;
        upsert(saved);
        if (session.current === s) setSelectedId(saved._id);
      } while (s.dirty && !s.dead);
      setError("");
    } catch (e) {
      s.dirty = true;
      setError(e instanceof TypeError ? NO_SERVER : e.message || "Couldn't save your changes.");
    } finally {
      s.saving = false;
      setSaving(false);
    }
  }, [upsert]);

  const flush = useCallback(() => {
    const s = session.current;
    clearTimeout(s.timer);
    if (s.dirty && !s.dead) persist(s);
  }, [persist]);

  const openNote = useCallback((note, { mobile = true } = {}) => {
    flush();
    const s = newSession(note);
    session.current = s;
    setDraft({ title: s.title, content: s.content, color: s.color, pinned: s.pinned });
    setSelectedId(note?._id || null);
    setConfirmDelete(false);
    setMenu(null);
    setDocKey(k => k + 1);
    if (mobile) setView("editor");
  }, [flush]);

  const createNote = useCallback(() => {
    const s = session.current;
    if (!s.id && !s.title && !s.content) { setView("editor"); titleRef.current?.focus(); return; }
    openNote(null);
    setSearch("");
    titleRef.current?.focus();
    setTimeout(() => titleRef.current?.focus(), 40);
  }, [openNote]);

  async function loadNotes() {
    try {
      const list = await apiRequest("/notes", { user });
      setNotes([...list].sort(byPinnedThenDate));
      setError("");
      if (!opened.current) {
        opened.current = true;
        if (list.length) openNote([...list].sort(byPinnedThenDate)[0], { mobile: false });
      }
    } catch (e) {
      setError(e instanceof TypeError ? NO_SERVER : e.message);
    }
  }
  useEffect(() => { if (user) loadNotes(); }, [user]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush(); };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flush]);

  function edit(field, value) {
    const s = session.current;
    s[field] = value;
    s.dirty = true;
    setDraft(d => ({ ...d, [field]: value }));
    clearTimeout(s.timer);
    s.timer = setTimeout(() => persist(s), 650);
  }
  updateRef.current = ed => edit("content", ed.isEmpty ? "" : stripOrigin(ed.getHTML()));

  // Load the opened note into the editor.
  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(toEditorHtml(session.current.content), false);
  }, [docKey, editor]);

  async function removeNote() {
    const s = session.current;
    setConfirmDelete(false);
    clearTimeout(s.timer);
    s.dead = true;
    const gone = s.id;
    try {
      if (gone) await apiRequest(`/notes/${gone}`, { user, method: "DELETE" });
    } catch (e) {
      s.dead = false;
      setError(e.message || "Couldn't delete this note.");
      return;
    }
    const rest = notes.filter(n => n._id !== gone);
    const idx = notes.findIndex(n => n._id === gone);
    setNotes(rest);
    session.current = newSession();
    const next = rest[Math.min(idx < 0 ? 0 : idx, rest.length - 1)];
    if (next) openNote(next, { mobile: false });
    else { setDraft({ title: "", content: "", color: "yellow", pinned: false }); setSelectedId(null); setDocKey(k => k + 1); }
    setView("list");
  }

  async function addQuick(event) {
    event.preventDefault();
    const text = quick.trim();
    if (!text) return;
    setQuick("");
    try {
      const saved = await apiRequest("/notes", { user, method: "POST", body: JSON.stringify({ title: "", content: `<p>${escapeHtml(text)}</p>`, color: "yellow" }) });
      upsert(saved);
      setFresh(saved._id);
      setTimeout(() => setFresh(null), 1600);
      setError("");
    } catch (e) {
      setQuick(text);
      setError(e instanceof TypeError ? NO_SERVER : e.message || "Couldn't save your quick note.");
    }
  }

  /* ---------- attachments ---------- */
  const uploadFiles = useCallback(async files => {
    if (!editor || !files.length) return;
    setUploading(true);
    try {
      for (const picked of files) {
        let file = picked;
        const isPhoto = /^image\/(jpeg|png|webp)$/.test(picked.type);
        if (shrinkUploads && isPhoto && picked.size <= MAX_ATTACHMENT * 3) {
          file = await compressPhoto(picked);
          if (file !== picked) setNotice(`Photo shrunk from ${prettySize(picked.size)} to ${prettySize(file.size)}`);
        }
        if (file.size > MAX_ATTACHMENT) { setError(`${picked.name} is over 20 MB.`); continue; }
        const body = new FormData();
        body.append("file", file);
        const res = await apiRequest("/attachments", { user: userRef.current, method: "POST", body });
        const abs = `${API_ORIGIN}${res.url}`;
        if (res.kind === "image") editor.chain().focus().insertContent([{ type: "image", attrs: { src: abs, alt: res.name } }, { type: "paragraph" }]).run();
        else editor.chain().focus().insertContent({
          type: "paragraph",
          content: [{ type: "text", text: `📎 ${res.name} (${prettySize(res.size)})`, marks: [{ type: "link", attrs: { href: abs, class: "file-link", target: "_blank" } }] }]
        }).run();
      }
    } catch (e) {
      setError(e instanceof TypeError ? NO_SERVER : e.message || "Couldn't attach that file.");
    } finally { setUploading(false); }
  }, [editor, shrinkUploads]);
  uploadRef.current = uploadFiles;

  /* ---------- share / more ---------- */
  const plainText = () => {
    const t = draft.title.trim();
    const b = textOf(draft.content);
    return t ? `${t}\n\n${b}` : b;
  };
  const words = useMemo(() => textOf(draft.content).trim().split(/\s+/).filter(Boolean).length, [draft.content]);

  async function copyText() {
    setMenu(null);
    try { await navigator.clipboard.writeText(plainText()); setNotice("Copied to clipboard"); }
    catch { setError("Couldn't copy. Your browser blocked clipboard access."); }
  }
  function downloadText() {
    setMenu(null);
    const name = (draft.title || firstLine(draft.content) || "note").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "note";
    const url = URL.createObjectURL(new Blob([plainText()], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${name}.txt` });
    a.click();
    URL.revokeObjectURL(url);
  }
  async function shareNative() {
    setMenu(null);
    try { await navigator.share({ title: draft.title || "Note", text: plainText() }); } catch { /* cancelled */ }
  }
  function printNote() { setMenu(null); setTimeout(() => window.print(), 50); }
  async function duplicateNote() {
    setMenu(null);
    flush();
    const s = session.current;
    try {
      const saved = await apiRequest("/notes", { user, method: "POST", body: JSON.stringify({ title: `${s.title || displayTitle({ title: s.title, content: s.content })} copy`, content: s.content, color: s.color }) });
      upsert(saved);
      openNote(saved);
      setNotice("Duplicated");
    } catch (e) { setError(e instanceof TypeError ? NO_SERVER : e.message || "Couldn't duplicate this note."); }
  }

  /* ---------- profile ---------- */
  async function saveProfile(event) {
    event.preventDefault();
    setProfileSaving(true);
    try {
      const next = await apiRequest("/users/me", { user, method: "PATCH", body: JSON.stringify({ displayName: profileName }) });
      setProfile(next);
      setProfileName(next.displayName || "");
      setProfileOpen(false);
    } catch (e) { setError(e instanceof TypeError ? NO_SERVER : e.message); }
    finally { setProfileSaving(false); }
  }

  async function uploadAvatar(event) {
    const original = event.target.files?.[0];
    event.target.value = "";
    if (!original) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(original.type)) { setError("Choose a JPG, PNG, WEBP, or GIF image."); return; }
    if (original.size > MAX_AVATAR * 3) { setError("That photo is too large. Choose one under 30 MB."); return; }
    setAvatarSaving(true);
    const file = await shrinkImage(original);
    if (file.size > MAX_AVATAR) { setAvatarSaving(false); setError("That photo is over 10 MB. Choose a smaller one."); return; }
    setAvatarPreview(URL.createObjectURL(file));
    try {
      await apiRequest("/users/me/avatar", { user, method: "POST", body: (() => { const b = new FormData(); b.append("avatar", file); return b; })() });
      setProfile(await apiRequest("/users/me", { user }));
    } catch (e) { setError(e instanceof TypeError ? NO_SERVER : e.message); }
    finally { setAvatarSaving(false); setAvatarPreview(null); }
  }

  async function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    try { await apiRequest("/users/me", { user, method: "PATCH", body: JSON.stringify({ theme: next }) }); } catch { /* applies locally either way */ }
  }

  /* ---------- derived ---------- */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? notes.filter(n => `${n.title}\n${textOf(n.content)}`.toLowerCase().includes(q)) : notes;
  }, [notes, search]);

  keyRef.current = { selectedId, confirmDelete, profileOpen, removeNote };
  const hasDraftRow = !selectedId && (draft.title || draft.content || view === "editor");
  const stamp = stampFmt.format(selectedId ? new Date(notes.find(n => n._id === selectedId)?.updatedAt || Date.now()) : new Date());
  const avatar = avatarPreview || avatarSrc(profile);
  const shownName = profile?.displayName || user?.displayName || user?.email || "";
  const run = fn => () => fn(editor.chain().focus()).run();
  // Inside a table the person chooses: a new table below it, or a table inside the selected cell (e.g. a calendar of month tables).
  function addTable(where = "below") {
    if (!editor) return;
    setMenu(null);
    const table = { rows: 3, cols: 3, withHeaderRow: true };
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === "table") {
        if (where === "inside") { editor.chain().focus().insertTable(table).run(); return; }
        const end = $from.after(d);
        editor.chain().focus().insertContentAt(end, [{ type: "paragraph" }, { type: "paragraph" }]).setTextSelection(end + 1).insertTable(table).run();
        return;
      }
    }
    editor.chain().focus().insertTable(table).run();
  }
  const on = (name, attrs) => Boolean(editor?.isActive(name, attrs));

  /* ---------- screens ---------- */
  if (authLoading) return <div className="auth"><div className="auth-card"><SunMark size={72} /></div></div>;

  if (!user) return (
    <div className="auth">
      <div className="auth-card">
        <SunMark size={84} />
        <h1>Morrow Notes</h1>
        {!firebaseConfigured && <div className="banner">Firebase isn't configured. Add your web app values to <code>client/.env</code> and restart.</div>}
        {authError && <div className="banner">{authError}</div>}
        <button className="google" disabled={!firebaseConfigured} onClick={async () => { setAuthError(""); try { await signInWithPopup(auth, googleProvider); } catch (e) { setAuthError(e.message || "Google sign-in failed."); } }}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 010-9.4l-7.9-6.1a24 24 0 000 21.6l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.9 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
          Continue with Google
        </button>
      </div>
    </div>
  );

  const item = (Icon, label, fn, active) => (
    <button className={`menu-item${active ? " on" : ""}`} onClick={fn} role="menuitem"><Icon size={17} /> {label}</button>
  );

  return (
    <div className="app" data-view={view}>
      <aside className="rail">
        <header className="brand"><SunMark size={32} /><h1>Morrow Notes</h1></header>
        <button className="new" onClick={createNote}><Plus size={18} strokeWidth={2.4} /> New note</button>
        <form className="quick" onSubmit={addQuick}>
          <Zap size={15} />
          <input value={quick} maxLength={2000} onChange={e => setQuick(e.target.value)} placeholder="Quick note, press Enter" aria-label="Quick note" />
        </form>
        <label className="search">
          <Search size={15} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search" aria-label="Search notes" />
          {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><X size={14} /></button>}
        </label>

        <div className="cards">
          {hasDraftRow && !search && (
            <button className="card selected" style={{ "--c": `var(--c-${draft.color})`, "--cb": `var(--c-${draft.color}-bg)` }} onClick={() => setView("editor")}>
              <span className="card-title">{draft.title || firstLine(draft.content) || "New note"}</span>
              <span className="card-text">{draft.content ? previewOf({ title: draft.title, content: draft.content }) : ""}</span>
              <time>{timeFmt.format(new Date())}</time>
            </button>
          )}
          {visible.map(n => (
            <button key={n._id} className={`card${n._id === selectedId ? " selected" : ""}${n._id === fresh ? " fresh" : ""}`} style={{ "--c": `var(--c-${n.color})`, "--cb": `var(--c-${n.color}-bg)` }} onClick={() => openNote(n)}>
              <span className="card-title">{displayTitle(n)}</span>
              <span className="card-text">{previewOf(n)}</span>
              <time>{n.pinned && <Pin size={11} className="pinned" aria-label="Pinned" />}{listDate(n.updatedAt)}</time>
            </button>
          ))}
          {search && !visible.length && <p className="none">No results for “{search}”</p>}
        </div>
      </aside>

      <main className="stage">
        <div className="bar-wrap">
          <div className="bar">
            <button className="icon back" onClick={() => { flush(); setView("list"); }} aria-label="Back to notes"><ChevronLeft size={22} /></button>
            <span className={`pulse${saving || uploading ? " on" : ""}`} role="status" aria-label={saving || uploading ? "Saving" : ""} />
            <div className="swatches" role="group" aria-label="Note color">
              {COLORS.map(c => <button key={c} className={`swatch${draft.color === c ? " on" : ""}`} style={{ "--s": `var(--c-${c})` }} onClick={() => edit("color", c)} aria-label={COLOR_NAMES[c]} title={COLOR_NAMES[c]} aria-pressed={draft.color === c} />)}
            </div>
            <div className="pop-wrap">
              <button className="icon" onClick={() => setConfirmDelete(v => !v)} aria-label="Delete note" title="Delete note"><Trash2 size={18} /></button>
              {confirmDelete && (
                <div className="popover" role="alertdialog" aria-label="Delete this note?">
                  <p>Delete this note?<small> Press ⌘⌫ again to confirm</small></p>
                  <div><button onClick={() => setConfirmDelete(false)}>Cancel</button><button className="danger" onClick={removeNote}>Delete</button></div>
                </div>
              )}
            </div>
            <button className="icon" onClick={toggleTheme} aria-label={theme === "light" ? "Dark theme" : "Light theme"} title={theme === "light" ? "Dark theme" : "Light theme"}>{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}</button>
            <button className="me" onClick={() => { setProfileName(profile?.displayName || user.displayName || ""); setProfileOpen(true); }} aria-label="Profile">
              <Avatar src={avatar} name={shownName} size={30} />
            </button>
          </div>
        </div>

        <div className="stage-scroll">
          <article className="page" onClick={e => { const a = e.target.closest?.("a"); if (a?.href) { e.preventDefault(); window.open(a.href, "_blank", "noopener"); } }}>
            <div className="stamp">{stamp}</div>
            <input ref={titleRef} className="title-input" value={draft.title} maxLength={120} onChange={e => edit("title", e.target.value)} placeholder="Title" aria-label="Title"
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); editor?.commands.focus("start"); } }} />
            <EditorContent editor={editor} className="editor" />
          </article>
        </div>

        {editor && on("table") && (
          <div className="table-tools" role="toolbar" aria-label="Table">
            <button onClick={run(c => c.addRowAfter())}>Add row</button>
            <button onClick={run(c => c.addColumnAfter())}>Add column</button>
            <button onClick={run(c => c.deleteRow())}>Delete row</button>
            <button onClick={run(c => c.deleteColumn())}>Delete column</button>
            <button className="danger" onClick={run(c => c.deleteTable())}>Delete table</button>
          </div>
        )}

        {menu && <div className="menu-scrim" onMouseDown={() => setMenu(null)} />}
        <div className="dock">
          <div className="pill" role="toolbar" aria-label="Format">
            <div className="pop-wrap">
              <button className={`dock-btn aa${menu === "format" ? " open" : ""}`} onClick={() => setMenu(menu === "format" ? null : "format")} aria-label="Text style" title="Text style" aria-expanded={menu === "format"}>Aa</button>
              {menu === "format" && editor && (
                <div className="menu format" role="menu">
                  <button className={`menu-item s-title${on("heading", { level: 1 }) ? " on" : ""}`} onClick={run(c => c.toggleHeading({ level: 1 }))} role="menuitem">Title</button>
                  <button className={`menu-item s-head${on("heading", { level: 2 }) ? " on" : ""}`} onClick={run(c => c.toggleHeading({ level: 2 }))} role="menuitem">Heading</button>
                  <button className={`menu-item s-sub${on("heading", { level: 3 }) ? " on" : ""}`} onClick={run(c => c.toggleHeading({ level: 3 }))} role="menuitem">Subheading</button>
                  <button className={`menu-item${!on("heading") ? " on" : ""}`} onClick={run(c => c.setParagraph())} role="menuitem">Body</button>
                  <div className="menu-row" role="group" aria-label="Emphasis">
                    <button className={on("bold") ? "on" : ""} onClick={run(c => c.toggleBold())} aria-label="Bold" title="Bold"><Bold size={17} /></button>
                    <button className={on("italic") ? "on" : ""} onClick={run(c => c.toggleItalic())} aria-label="Italic" title="Italic"><Italic size={17} /></button>
                    <button className={on("underline") ? "on" : ""} onClick={run(c => c.toggleUnderline())} aria-label="Underline" title="Underline"><UnderlineIcon size={17} /></button>
                    <button className={on("strike") ? "on" : ""} onClick={run(c => c.toggleStrike())} aria-label="Strikethrough" title="Strikethrough"><Strikethrough size={17} /></button>
                  </div>
                  <div className="menu-row" role="group" aria-label="Lists">
                    <button className={on("bulletList") ? "on" : ""} onClick={run(c => c.toggleBulletList())} aria-label="Bulleted list" title="Bulleted list"><List size={18} /></button>
                    <button className={on("orderedList") ? "on" : ""} onClick={run(c => c.toggleOrderedList())} aria-label="Numbered list" title="Numbered list"><ListOrdered size={18} /></button>
                  </div>
                </div>
              )}
            </div>
            <button className={`dock-btn${on("taskList") ? " active" : ""}`} onClick={run(c => c.toggleTaskList())} aria-label="Checklist" title="Checklist"><ListChecks size={20} /></button>
            <div className="pop-wrap">
              <button className={`dock-btn${on("table") ? " active" : ""}`} onClick={() => (on("table") ? setMenu(menu === "table" ? null : "table") : addTable())} aria-label="Table" title="Table" aria-expanded={menu === "table"}><TableIcon size={20} /></button>
              {menu === "table" && editor && (
                <div className="menu" role="menu">
                  {item(TableIcon, "New table below", () => addTable("below"))}
                  {item(TableIcon, "Table inside this cell", () => addTable("inside"))}
                </div>
              )}
            </div>
            <button className="dock-btn" onClick={() => fileRef.current?.click()} aria-label="Attach a photo or file" title="Attach a photo or file"><Paperclip size={20} /></button>
            <input ref={fileRef} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif,.pdf,.txt,.md,.csv,.docx,.xlsx,.pptx" data-testid="attach" onChange={e => { const f = [...e.target.files]; e.target.value = ""; uploadFiles(f); }} />
          </div>

          <div className="pill">
            <div className="pop-wrap">
              <button className={`dock-btn${menu === "share" ? " open" : ""}`} onClick={() => setMenu(menu === "share" ? null : "share")} aria-label="Share" title="Share" aria-expanded={menu === "share"}><Share size={20} /></button>
              {menu === "share" && (
                <div className="menu right" role="menu">
                  {item(Copy, "Copy text", copyText)}
                  {item(Download, "Download as text file", downloadText)}
                  {typeof navigator !== "undefined" && navigator.share && item(Share, "Share…", shareNative)}
                  {item(Printer, "Print or save as PDF", printNote)}
                </div>
              )}
            </div>
            <div className="pop-wrap">
              <button className={`dock-btn${menu === "more" ? " open" : ""}`} onClick={() => setMenu(menu === "more" ? null : "more")} aria-label="More" title="More" aria-expanded={menu === "more"}><Ellipsis size={20} /></button>
              {menu === "more" && (
                <div className="menu right" role="menu">
                  {item(draft.pinned ? PinOff : Pin, draft.pinned ? "Unpin" : "Pin to top", () => { edit("pinned", !draft.pinned); setMenu(null); })}
                  {item(CopyPlus, "Duplicate", duplicateNote)}
                  <div className="menu-info">{words} {words === 1 ? "word" : "words"}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {error && <div className="toast" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss"><X size={16} /></button></div>}
      {!error && notice && <div className="toast info" role="status"><span>{notice}</span></div>}

      {profileOpen && (
        <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) setProfileOpen(false); }}>
          <form className="dialog" onSubmit={saveProfile}>
            <button type="button" className="icon dialog-close" onClick={() => setProfileOpen(false)} aria-label="Close"><X size={19} /></button>
            <label className="avatar-pick">
              <Avatar src={avatar} name={shownName} size={96} />
              <em><Camera size={15} /> {avatarSaving ? "Uploading…" : "Change photo"}</em>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={uploadAvatar} disabled={avatarSaving} />
            </label>
            <input className="name-input" value={profileName} maxLength={80} onChange={e => setProfileName(e.target.value)} placeholder="Your name" aria-label="Display name" />
            <p className="email">{user.email}</p>
            <label className="toggle-row">
              <input type="checkbox" checked={shrinkUploads} onChange={e => { setShrinkUploads(e.target.checked); try { localStorage.setItem("mn-shrink", e.target.checked ? "on" : "off"); } catch {} }} />
              <span>Shrink photos before uploading<small>Saves space and loads faster. Turn off to keep the original quality.</small></span>
            </label>
            <button className="save" type="submit" disabled={profileSaving}>{profileSaving ? "Saving…" : "Save"}</button>
            <button type="button" className="signout" onClick={() => { setProfileOpen(false); flush(); signOut(auth); }}><LogOut size={16} /> Sign out</button>
          </form>
        </div>
      )}
    </div>
  );
}
