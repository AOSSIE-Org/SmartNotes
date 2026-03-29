# Smart Notes (Local AI Notes App)

Hi! This project is a small but meaningful attempt to build a local, privacy-first note-taking system with AI features. It is inspired by the Smart Notes idea from AOSSIE for GSoC.

Instead of relying on cloud services, everything here runs locally on your machine. The idea is simple — your notes are yours, and the intelligence around them should also stay with you.

---

## 🌱 What this project does

This app lets you:

* Write and store notes
* Ask questions based on your notes
* Get short summaries of your notes
* See related notes automatically

All of this is powered by a basic Retrieval-Augmented Generation (RAG) pipeline running locally.

---

## 🧠 Features

### 1. Ask Questions (Q&A)

You can ask questions about your notes, and the system will try to answer using only the content you’ve written.

### 2. Smart Summarization

Notes can be summarized into a short, clean sentence instead of just repeating the same text.

### 3. Related Notes

When you add a new note, the system suggests other notes that are similar in meaning.

### 4. Local First

Everything runs on your system — no mandatory APIs, no cloud dependency.

### 5. Desktop App

The app is wrapped using Electron so it can run like a desktop application.

---

## ⚙️ Tech Stack

* Python (Flask)
* HTML + CSS (simple UI)
* HuggingFace Transformers
* Sentence Transformers (for embeddings)
* Electron (for desktop wrapper)

---

## 🏗️ How it works (simple view)

1. Notes are stored locally
2. Each note is converted into embeddings
3. When you ask a question:

   * relevant notes are retrieved
   * a model generates an answer from that context

---

## 🚀 How to run the project

### 1. Clone the repo

```
git clone https://github.com/KRISHNPRIY2820/smart-notes-mvp.git
cd smart-notes
```

### 2. Create virtual environment

```
python -m venv venv
venv\Scripts\activate
```

### 3. Install requirements

```
pip install -r requirements.txt
```

### 4. Run the backend

```
python app.py
```

Open in browser:

```
http://127.0.0.1:5000
```

---

## 💻 Run as Desktop App (Electron)

```
cd frontend
npm install
npm start
```

---

## 🧪 Current limitations

* UI is basic (focused more on functionality)
* Models are simple and not heavily optimized
* No persistent vector database yet

---

## 🌟 Why this project

Most note-taking tools today depend heavily on the cloud. This project explores a different direction — keeping everything local while still providing AI assistance.
>This MVP focuses on building a strong local-first foundation, with scalability planned in future iterations.

---

## 🚧 Future Improvements

- Multi-page UI instead of a single screen for better feature separation
- Persistent storage so notes are saved locally and do not vanish after restarting the app
- Knowledge graph visualization to explore connections between notes
- Improved retrieval using hybrid search (keyword + semantic)
- Enhanced UI using React + Electron
- Optional multi-device sync while maintaining privacy

---

## 🤝 Contribution

This is part of my GSoC preparation with AOSSIE. Any feedback or suggestions are genuinely welcome.

---

## 📜 License

GNU GPL v3

---

Thanks for checking this out 🙂
