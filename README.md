> [!IMPORTANT]
> Readme is needed to be updated. To get an overview of the project and ideas to work on go through [arch.md](./arch.md).

# Dont Compete

**Dont Compete** is a purely local, containerized, and agent-driven platform for GATE (Graduate Aptitude Test in Engineering) preparation. It combines a modern React frontend with an autonomous backend pipeline that scrapes, classifies, and generates study materials from raw syllabus PDFs and local LLMs.

## Core Philosophy & Features

*   **100% Local & Private**: All data processing and AI generation happens on your machine using Ollama. No external APIs, no cloud dependencies.
*   **Container-First Architecture**: The entire system runs via Docker Compose. No local Python or Node.js environment setup required.
*   **Functional Asset Generator**:
    *   **Sequential Pipeline**: 8-stage functional sequence (Download -> OCR -> DB Sync -> Classification -> Theory -> Manifest).
    *   **Deterministic**: Heuristic Parsing ensures high-fidelity image extraction for questions and explanations.
    *   **Idempotent**: Re-runs extend existing datasets instead of reclaiming them.
*   **Modern Modular Interface**:
    *   **Modular Shell**: Minimal root layout delegating logic to specialized, reusable components.
    *   **Adaptive Assessment**: Handles MCQ, MSQ, and Numeric inputs with real-time validation.
    *   **Dynamic Navigation**: URI-based breadcrumbs and stateful dashboard expansion.

## Technical Architecture

The system is split into two autonomous components that communicate via shared file-system artifacts:

1.  **Asset Generator (`/generator`)**: A functional Python pipeline using DuckDB, PyMuPDF, `tenacity` (retries), and Ollama.
2.  **Frontend (`/frontend`)**: A high-performance React application (Vite, TanStack Router) that **dynamically discovers** generated static assets via filesystem structure (Zero-Config discovery).

*For a detailed deep-dive into the system design, components, and data flow, please refer to [`arch.md`](./arch.md).*

## Getting Started

### Prerequisites
*   [Docker Desktop](https://docs.docker.com/get-docker/) or Docker Engine + Compose.
*   [Git](https://git-scm.com/).
<!-- *   [Git LFS](https://git-lfs.github.com/). -->

### Quick Start
1.  **Clone the repository**:
    ```bash
    git clone https://github.com/imxade/dont-compete.git
    cd dont-compete
    ```

2.  **Launch the System**:
    ```bash
    docker compose up --build
    ```
    *   **Frontend**: Accessible at `http://localhost:3000`.
    *   **Generator**: Autonomously populates content in the background.
    *   **Idempotency**: Existing data is skipped; re-launching only processes new or missing streams.

3.  **Monitor Pipeline**:
    ```bash
    docker compose logs -f generator
    ```

### Configuration
Central configuration is managed in `generator/src/config.py`. You can customize:
*   `TARGET_STREAMS`: Which exam streams to process (e.g., CS, DA).
*   `OLLAMA_MODEL`: The local LLM to use (default: `llama3.1`).

## Contributing

We are building a free, high-quality platform for everyone, and we need your help to achieve that!

### Non-Coding Contributions
AI is a powerful accelerator, but it's not perfect. We rely on the community to ensure quality and depth.

*   **Improve Theories**: AI-generated explanations can be generic or miss nuance. If you have a better explanation, analogy, or diagram for a concept, please submit a PR!
*   **Quality Assurance**:
    *   **Review**: Help us verify the correctness of questions and answers in Pull Requests.
    *   **Model Testing**: Run the generator with different LLMs (Mistral, Gemma, Phi-3, or larger parameter models on your local machine) and report which yields the best results.
*   **Community Questions**: Identify gaps in our question bank and add commonly asked questions or "gotchas" for specific topics.
*   **Expand Scope**: PRs adding support for **other competitive exams** are highly welcome! Let's build a universal free platform together.

### Testing
The project includes a comprehensive test suite that runs in Docker.

**1. Generator Tests (Backend)**
```bash
docker compose run --rm asset-generator pytest generator/tests
```

**2. Frontend Tests (Playwright)**
Run the end-to-end tests using the official Playwright container:
```bash
docker run --rm --network gatebuster_app_network \
  -e BASE_URL=http://frontend:3000 \
  -v $(pwd)/frontend:/app \
  -w /app \
  mcr.microsoft.com/playwright:v1.58.0-jammy \
  /bin/sh -c "npm install && npx playwright test"
```
*Note: Ensure the frontend service is running (`docker compose up`) before starting Playwright tests.*

## License
Apache 2.0 License - see `LICENSE` for details.
