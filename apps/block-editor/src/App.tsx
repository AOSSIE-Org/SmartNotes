import { useState, useRef, useEffect } from "react";
import BlockNoteEditor from "./editors/BlockNoteEditor";
import "./App.css";

const EDITORS = [
  { id: "blocknote", label: "Notion-style" },
  // { id: "simple", label: "Simple (Tiptap)" },
] as const;

type EditorId = (typeof EDITORS)[number]["id"];

export default function App() {
  const [isDark, setIsDark] = useState(true);
  const [activeEditor, setActiveEditor] = useState<EditorId>("blocknote");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const currentEditorLabel = EDITORS.find((e) => e.id === activeEditor)?.label;

  return (
    <div className={`app-root ${isDark ? "dark" : "light"}`}>
      {/* ── Top bar ─────────────────────────────────────── */}
      <header className="topbar">
        {/* Left: editor picker */}
        <div className="topbar-left" ref={dropdownRef}>
          <button
            className="dropdown-btn"
            onClick={() => setDropdownOpen((o) => !o)}
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
          >
            <span className="dropdown-icon">▤</span>
            {currentEditorLabel}
            <span className="chevron">{dropdownOpen ? "▲" : "▼"}</span>
          </button>

          {dropdownOpen && (
            <ul className="dropdown-menu" role="listbox">
              {EDITORS.map((ed) => (
                <li
                  key={ed.id}
                  role="option"
                  aria-selected={ed.id === activeEditor}
                  className={`dropdown-item ${ed.id === activeEditor ? "active" : ""}`}
                  onClick={() => {
                    setActiveEditor(ed.id);
                    setDropdownOpen(false);
                  }}
                >
                  {ed.label}
                  {ed.id === activeEditor && <span className="check">✓</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right: dark / light toggle */}
        <button
          className="theme-toggle"
          onClick={() => setIsDark((d) => !d)}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? "☀ Light" : "☾ Dark"}
        </button>
      </header>

      {/* ── Editor ──────────────────────────────────────── */}
      <main className="editor-area">
        {activeEditor === "blocknote" && <BlockNoteEditor isDark={isDark} />}
      </main>
    </div>
  );
}
