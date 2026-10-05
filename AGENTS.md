# Jermi's Assistant repository workflow

The owner wants every completed code change committed and pushed to `origin/main`.

- Preserve `data/`, `.venv/`, `.local-models/`, and `.env`; they contain local state, downloaded models, or secrets and must never be committed.
- Run `npm test` and relevant syntax or offline voice checks before committing.
- Review the staged file list for private PC content or credentials before every push.
- Commit the completed change with a clear message and push it to `origin/main`.
