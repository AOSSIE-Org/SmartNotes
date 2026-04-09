<!-- Don't delete it -->
<div name="readme-top"></div>

<!-- Organization Logo -->
<div align="center" style="display: flex; align-items: center; justify-content: center; gap: 16px;">
  <img alt="AOSSIE" src="public/aossie-logo.svg" width="175">
  <img src="public/logo-full.svg" width="175" />
</div>

&nbsp;

<!-- Organization Name -->
<div align="center">

[![Static Badge](https://img.shields.io/badge/AOSSIE-SmartNotes-228B22?style=for-the-badge&labelColor=FFC517)](https://github.com/AOSSIE-Org/SmartNotes)

</div>

<!-- Organization/Project Social Handles -->
<p align="center">
<!-- Telegram -->
<a href="https://t.me/StabilityNexus">
<img src="https://img.shields.io/badge/Telegram-black?style=flat&logo=telegram&logoColor=white&logoSize=auto&color=24A1DE" alt="Telegram Badge"/></a>
&nbsp;&nbsp;
<!-- X (formerly Twitter) -->
<a href="https://x.com/aossie_org">
<img src="https://img.shields.io/twitter/follow/aossie_org" alt="X (formerly Twitter) Badge"/></a>
&nbsp;&nbsp;
<!-- Discord -->
<a href="https://discord.gg/hjUhu33uAn">
<img src="https://img.shields.io/discord/1022871757289422898?style=flat&logo=discord&logoColor=white&logoSize=auto&label=Discord&labelColor=5865F2&color=57F287" alt="Discord Badge"/></a>
&nbsp;&nbsp;
<!-- Medium -->
<a href="https://news.stability.nexus/">
  <img src="https://img.shields.io/badge/Medium-black?style=flat&logo=medium&logoColor=black&logoSize=auto&color=white" alt="Medium Badge"></a>
&nbsp;&nbsp;
<!-- LinkedIn -->
<a href="https://www.linkedin.com/company/aossie/">
  <img src="https://img.shields.io/badge/LinkedIn-black?style=flat&logo=LinkedIn&logoColor=white&logoSize=auto&color=0A66C2" alt="LinkedIn Badge"></a>
&nbsp;&nbsp;
<!-- Youtube -->
<a href="https://www.youtube.com/@StabilityNexus">
  <img src="https://img.shields.io/youtube/channel/subscribers/UCZOG4YhFQdlGaLugr_e5BKw?style=flat&logo=youtube&logoColor=white&logoSize=auto&labelColor=FF0000&color=FF0000" alt="Youtube Badge"></a>
</p>

---

<div align="center">
<h1>SmartNotes</h1>
</div>

**SmartNotes** is a local-first, privacy-focused desktop application for knowledge management. All AI runs on your machine — no API keys, no cloud, no data leaving your device. Write, search, and ask questions about your notes entirely offline.

---

## 🚀 Features

- **Rich Text Editor**: Full-featured editor powered by TipTap with slash commands, wikilinks (`[[Note Title]]`), headings, code blocks, and tables
- **Semantic Search**: Search your notes by meaning, not just keywords — powered by local sentence-transformer embeddings (Transformers.js + WASM)
- **RAG-based Q&A**: Ask questions and get answers grounded in your notes using a local LLM via Ollama — no internet required
- **Knowledge Graph**: Automatic note linking and a visual force-directed graph showing how your notes connect
- **Import/Export**: Full compatibility with Markdown files and Obsidian vaults — bring your existing notes in, export anytime

---

## 💻 Tech Stack

### Desktop Shell
- [Electron](https://electronjs.org/) — cross-platform desktop application
- [React](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) — renderer UI
- [Vite](https://vitejs.dev/) — fast dev server and bundler

### Editor
- [TipTap](https://tiptap.dev/) — headless rich-text editor built on ProseMirror

### AI / Search
- [Transformers.js](https://huggingface.co/docs/transformers.js) — sentence-transformer embeddings in WebAssembly (no Python)
- [Ollama](https://ollama.com/) — local LLM inference (llama3.2, phi3, mistral)
- [LlamaIndex.TS](https://ts.llamaindex.ai/) — RAG orchestration

### Storage
- [SQLite](https://sqlite.org/) — all notes, metadata, and tags
- [sqlite-vec](https://github.com/asg017/sqlite-vec) — vector similarity search directly in SQLite

### Visualization
- [D3.js](https://d3js.org/) — force-directed knowledge graph

### Packaging & Testing
- [Electron Forge](https://www.electronforge.io/) — cross-platform builds (.exe, .dmg, .deb, .rpm)
- [Vitest](https://vitest.dev/) — unit and integration tests
- [Playwright](https://playwright.dev/) — end-to-end tests

---

## ✅ Project Checklist

- [x] **AI/ML components**:
   - [x] LLM/model selection documented (Ollama with llama3.2/phi3/mistral)
   - [x] Embeddings run fully locally via Transformers.js WASM
   - [x] No API keys required — fully offline
   - [ ] Content moderation for generated responses (planned)

---

## 🔗 Repository Links

1. [Main Repository](https://github.com/AOSSIE-Org/SmartNotes)
2. [Issue Tracker](https://github.com/AOSSIE-Org/SmartNotes/issues)
3. [GSoC 2026 Project Ideas](https://github.com/AOSSIE-Org/Info/blob/main/GSoC-Ideas/2026/index.md)

---

## 🏗️ Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│                  Electron App                    │
│                                                  │
│  ┌──────────────┐      ┌──────────────────────┐  │
│  │ Main Process │      │  Renderer Process    │  │
│  │              │ IPC  │                      │  │
│  │ SQLite DB    │◄────►│  TipTap Editor       │  │
│  │ File System  │      │  Search Bar          │  │
│  │ Ollama Mgr   │      │  Q&A Sidebar         │  │
│  └──────────────┘      │  Knowledge Graph     │  │
│                        │                      │  │
│                        │  ┌────────────────┐  │  │
│                        │  │  Web Worker    │  │  │
│                        │  │ Transformers.js│  │  │
│                        │  │ (WASM embeds)  │  │  │
│                        │  └────────────────┘  │  │
│                        └──────────────────────┘  │
└─────────────────────────────────────────────────┘
                          │
                    localhost:11434
                          │
                 ┌─────────────────┐
                 │  Ollama Daemon  │
                 │  llama3.2/phi3  │
                 └─────────────────┘
```

---

## 🔄 User Flow

### Key User Journeys

1. **Writing a Note**
   - Open SmartNotes → click New Note
   - Type with rich formatting, use `/` for slash commands
   - Use `[[` to link to another note (builds the knowledge graph automatically)
   - Note is saved and embedded in the background

2. **Semantic Search**
   - Press `Ctrl+K` or click the search bar
   - Type a query in natural language
   - Results ranked by meaning + keyword relevance (hybrid BM25 + vector search)

3. **Q&A over Notes**
   - Open the Q&A sidebar
   - Type a question like "What did I write about neural networks?"
   - SmartNotes retrieves relevant note chunks and sends them to your local LLM
   - Answer streams back with source citations linking to specific notes

---

## 🍀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- [npm](https://www.npmjs.com/) v9 or higher
- [Git](https://git-scm.com/)
- [Ollama](https://ollama.com/) (optional — only needed for Q&A feature)

### Installation

#### 1. Clone the Repository

```bash
git clone https://github.com/AOSSIE-Org/SmartNotes.git
cd SmartNotes
```

#### 2. Install Dependencies

```bash
npm install
```

#### 3. Run the Development Server

```bash
npm run dev
```

#### 4. (Optional) Install Ollama for Q&A

Download Ollama from [ollama.com](https://ollama.com/), then pull a model:

```bash
ollama pull llama3.2
```

SmartNotes will detect Ollama automatically on startup.

---

## 📱 App Screenshots

> Screenshots will be added as the application UI is built.

---

## 🙌 Contributing

⭐ Don't forget to star this repository if you find it useful! ⭐

Thank you for considering contributing to SmartNotes! Contributions are highly appreciated and welcomed. To ensure smooth collaboration, please refer to our [Contribution Guidelines](./CONTRIBUTING.md).

**Important**: All project communication happens on [Discord](https://discord.gg/hjUhu33uAn). Post your PR updates there for faster review.

---

## ✨ Maintainers

- [@SharkyBytes](https://github.com/SharkyBytes)
- [@yatikakain](https://github.com/yatikakain)

---

## 📍 License

This project is licensed under the GNU General Public License v3.0.
See the [LICENSE](LICENSE) file for details.

---

## 💪 Thanks To All Contributors

Thanks a lot for spending your time helping SmartNotes grow. Keep rocking 🥂

[![Contributors](https://contrib.rocks/image?repo=AOSSIE-Org/SmartNotes)](https://github.com/AOSSIE-Org/SmartNotes/graphs/contributors)

© 2025 AOSSIE
