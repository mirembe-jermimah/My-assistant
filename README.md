# Jermi's Assistant — local PC assistant

Jermi's Assistant is a password-protected web app that runs on your computer. It browses local drives, reads supported documents where they already live, searches filenames, indexes document text locally, and answers questions with links back to source files. It can create folders, rename or move files and folders, and schedule a cancellable Windows shutdown or restart.

## Start

Node.js 24 or newer is required. In PowerShell:

```powershell
npm install
npm start
```

Open **http://127.0.0.1:3000**. On first use, create a password of at least 12 characters. Jermi's Assistant binds to the local loopback address and is available only on this computer by default. Running `npm start` starts the assistant server; closing that terminal stops it.

The app does not power on a fully off computer. That needs Wake-on-LAN, firmware scheduling, or a separate powered device. A scheduled shutdown requires typing `SHUT DOWN`, and a restart requires `RESTART`. Both provide a 60-second cancellation period.

## Working with files

- **My PC** shows accessible local drives and shortcuts such as Documents, Desktop, and Downloads. The menu has labeled sections and can be collapsed or expanded with the menu button.
- Open a folder to inspect its contents. Supported text, code, PDF, and DOCX files can be previewed and discussed in chat. Image-only PDFs require OCR.
- Filename search works directly on the file system and checks a bounded search window of up to 18,000 entries or eight seconds per request. Large folders can be browsed page by page. **Scan folder** adds readable text from that folder and its subfolders to a local SQLite search index. The assistant also queues bounded scans of the user folder and local drives on startup and every 45 minutes. A scan checks up to 12,000 entries, indexes up to 3,000 documents, and stops after five minutes. System and dependency folders are skipped. A manual scan receives priority when automatic scans are running.
- File actions create a folder, rename an item, or move it to another folder on the same drive. **Tidy folder** proposes moving common personal file types into Documents, Images, Videos, Audio, Archives, Spreadsheets, or Presentations. It shows each move for confirmation, skips code and existing destinations, and processes at most 200 proposed moves at a time. Jermi's Assistant does not expose a file deletion action.
- Ask “Where did I save my budget proposal?” or “Find the Reports folder” in chat. The answer lists full paths and provides buttons to open each location. Filename searches are bounded; use a likely folder or scan it if a broad search misses something.
- Files are read in place. No browser file transfer is used. Existing data from earlier versions remains on disk, but its old file-transfer routes are no longer available.

Jermi's Assistant can read supported files up to 15 MB and extracts at most 600,000 characters from one document. Files without readable text can still be browsed and organized.

## Conversational answers

Without an AI model, Jermi's Assistant provides filename search, extractive summaries, and source-linked passages. For richer natural-language conversation, connect a local Ollama-compatible model or use an OpenAI API key. Jermi's Assistant automatically detects an installed `qwen3:1.7b` model on the local Ollama service. To choose another model explicitly:

```powershell
$env:JERMI_LOCAL_MODEL = 'your-installed-model-name'
npm start
```

The default local endpoint is `http://127.0.0.1:11434/v1`. Set `JERMI_LOCAL_AI_URL` to another compatible local endpoint. Alternatively, set `OPENAI_API_KEY` and optionally `OPENAI_CHAT_MODEL`. The server does not automatically load `.env` files; set variables in the shell before starting. When using an external AI provider, relevant file excerpts are sent to it when you chat. Local file indexing does not send file content to an AI provider.

The model is given retrieved excerpts and previous conversation turns. It does not execute file or power actions. File content is treated as untrusted data; important answers should be checked against the cited source.

## Voice conversation

Offline voice is optional on a fresh clone. Install its Python packages and English speech model once, while online:

```powershell
.\scripts\setup-offline-voice.ps1 -PythonExe 'C:\path\to\Python312\python.exe'
```

If Python 3.12 is available through `py`, omit `-PythonExe`. On this PC, the voice model and packages are already installed. After setup, open **Talk to Jermi's Assistant** and select the microphone. The assistant greets you, listens through the PC microphone using Vosk, speaks through Windows speech, and listens again. Select the microphone again to stop. **Read aloud** speaks the latest answer. The browser never records audio or performs speech recognition.

For a browser-free resizable chat and voice window, run:

```powershell
.\.venv\Scripts\python.exe .\scripts\desktop_assistant.py
```

The desktop window starts the local server when needed and asks for the existing assistant password. The current offline voice model recognizes English. Installing it requires internet once; recognition, speech playback, and the installed local AI model work offline afterward. An external AI provider is only used if you configure its API key.

## Storage and security

Jermi's Assistant stores its password verifier, session records, preferences, conversation history, and scanned text under `data/`. You can override that folder with `JERMI_DATA_DIR`. It protects endpoints with a password, HttpOnly SameSite cookie, CSRF token, login throttling, and security headers. The server refuses paths outside its accessible roots and blocks access to its own data folder.

By default, local drive roots are discovered on Windows. For a restricted workspace, set `JERMI_FS_ROOTS` to one or more absolute folder paths separated by semicolons before starting. Example:

```powershell
$env:JERMI_FS_ROOTS = 'C:\Users\YourName\Documents;D:\Work'
npm start
```

Do not expose Jermi's Assistant directly to the internet. Back up the `data/` folder to preserve the local index and conversations. Files on your PC are not copied into it; keep normal backups of those files separately.

## Verify

```powershell
npm test
```

The tests use isolated temporary folders and a mocked AI endpoint. Power actions are disabled in tests.
