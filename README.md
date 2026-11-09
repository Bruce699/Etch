# Etch

Etch is a local writing workspace for collecting fragments, arranging them on a canvas and turning a chosen arrangement into an editable, source-linked outline. The included workspace follows Rachel’s exploration of identity and AI.

## Run on this Mac

Double-click **Start Etch.command**, or run the following from the Etch folder.

```sh
python3 launch.py
```

The launcher opens [Etch in your browser](http://127.0.0.1:8741). Keep its terminal open while working. Control-C stops the server. Running the launcher again opens the existing instance. The installed copy includes the writing model and runs offline.

The portable source archive requires Python 3.9 or newer and a modern browser. Run the same command for the app and its extractive outline writer. To install the local language model on an Apple Silicon Mac, use the following command once. The download is about 1.2 GB and the launcher verifies both checksums.

```sh
python3 launch.py --install-model
```

For another platform, start a local llama.cpp server with a compatible instruction model, set `ETCH_MODEL_URL` to its base URL and optionally set `ETCH_MODEL_NAME`. The writing service uses its structured chat-completions endpoint. The supplied Mac runtime pairs [llama.cpp b12211](https://github.com/ggml-org/llama.cpp/releases/tag/b12211) with [Qwen2.5-1.5B-Instruct](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF).

## Follow Rachel’s workflow

1. In **New Note**, type a thought. Press ⌘-Enter or Ctrl-Enter to save it. Use the canvas tree to open **Thoughts on AI**. Its child workspace explores identity as a potential moat.
2. Open the note inbox on the canvas and drag a card into a section. A blue insertion line shows where it will land. Select a note to inspect its other appearances or insert a connected note.
3. Drag a note’s round connector to another card and enter a relationship. Shift-click cards to select several. The selection toolbar can group them or create a child canvas. Drag empty space to pan, pinch or Ctrl-scroll to zoom, and press F to fit the canvas.
4. Open the identity canvas. Double-click **OpenAI: The New Moat** to read the original design example. Click a passage’s source control to reveal its evidence. Both panes remain interactive.
5. Select a section’s name, choose the outline action and enter a writing prompt. The document appears beside the section. Double-click to edit, use **Branch** to try another framing, or export Markdown from the document menu. To change the writing order itself, duplicate a section, select its vertical arrangement, reorder the notes and request another outline.

## Data and recovery

The hosted Open Layer preview stores its workspace in `.cache/etch/workspace.sqlite`, outside preview file watching so SQLite journal writes cannot reload the page. Preview setup copies an existing `data/workspace.sqlite` there once, including committed WAL contents; subsequent starts keep the hosted workspace. Back up the hosted database from `.cache/etch`.

The app listens on loopback and stores notes, image attachments, canvases, placements, connections and documents in `data/workspace.sqlite`. To back up the whole workspace, stop the launcher and copy the data folder. The initial state comes from `src/seed.json` on the first launch. The original note IDs connect appearances across canvases. Documents preserve a snapshot of their source text and relationship labels. Simultaneous edits in a second browser window trigger a revision-conflict recovery message.

## Source and tests

The browser runs native JavaScript modules with no build step. `src/app.js` handles screens and commands, `src/gestures.js` handles spatial interactions, `src/view.js` draws cards, miniatures and connectors, and `src/store.js` manages workspace identity and saves. `server.py` implements SQLite persistence and writing. Fonts, icons and reference images are local.

The storage suite uses only Python. The browser suite uses Python Playwright and Google Chrome, starts a separate server and creates a disposable database. A running local model lets the suite exercise inference. Without one it exercises the identified extractive writer. Launch Etch first if you want the browser tests to use its model.

```sh
python3 tests/storage.py
python3 -m venv .venv
. .venv/bin/activate
python -m pip install playwright
python tests/journey.py
```

For Playwright’s bundled Chromium, run `python -m playwright install chromium` and `ETCH_CHROME=chromium python tests/journey.py`. Set `ETCH_EVIDENCE` to a directory to save screenshots of the journey. Use `python3 launch.py --port 8742` if the normal app port is occupied.

Read the [reconstruction report](docs/reconstruction-report.html), [slide-by-slide coverage](docs/slide-audit.html), [recorded interactions](docs/motion-audit.html) and [implementation plan](docs/implementation-plan.md) alongside the [original Figma page](https://www.figma.com/design/la7ujjhDfFxmMD1IBSToeL/Shopify-Portfolio-Presentation---Formal?node-id=171-1287).
