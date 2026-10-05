import fs from 'node:fs';
import { lstat, mkdir, opendir, readFile, realpath, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export const readableExtensions = new Set([
  '.pdf', '.docx', '.txt', '.md', '.markdown', '.csv', '.json', '.log', '.rtf',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.html', '.css', '.xml',
  '.yml', '.yaml', '.toml', '.ini', '.sql', '.sh', '.ps1'
]);
const skippedDuringScan = new Set(['node_modules', '.git', '$recycle.bin', 'system volume information',
  'windows', 'program files', 'program files (x86)', 'programdata', 'appdata', '.cache', '.venv', 'venv', '.local-models']);
const tidyCategories = new Map([
  ['.pdf', 'Documents'], ['.docx', 'Documents'], ['.doc', 'Documents'], ['.txt', 'Documents'], ['.md', 'Documents'], ['.rtf', 'Documents'],
  ['.jpg', 'Images'], ['.jpeg', 'Images'], ['.png', 'Images'], ['.gif', 'Images'], ['.webp', 'Images'], ['.heic', 'Images'],
  ['.mp4', 'Videos'], ['.mov', 'Videos'], ['.mkv', 'Videos'], ['.avi', 'Videos'],
  ['.mp3', 'Audio'], ['.wav', 'Audio'], ['.flac', 'Audio'], ['.m4a', 'Audio'],
  ['.zip', 'Archives'], ['.7z', 'Archives'], ['.rar', 'Archives'],
  ['.xlsx', 'Spreadsheets'], ['.xls', 'Spreadsheets'], ['.csv', 'Spreadsheets'],
  ['.pptx', 'Presentations'], ['.ppt', 'Presentations']
]);
const maxReadBytes = 15 * 1024 * 1024;
const maxTextLength = 600_000;
const key = value => process.platform === 'win32' ? value.toLowerCase() : value;
const within = (target, root) => key(target) === key(root) || key(target).startsWith(key(root.endsWith(path.sep) ? root : root + path.sep));
const cleanPath = value => typeof value === 'string' && value.trim() && path.isAbsolute(value.trim()) ? path.resolve(value.trim()) : null;
const safeName = value => typeof value === 'string' ? value.trim() : '';

export function createLocalFiles({ dataDir, roots = null } = {}) {
  const candidates = roots || (process.env.JERMI_FS_ROOTS
    ? process.env.JERMI_FS_ROOTS.split(';').filter(Boolean)
    : process.platform === 'win32'
      ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter => `${letter}:\\`).filter(p => fs.existsSync(p))
      : [os.homedir()]);
  const allowedRoots = candidates.map(cleanPath).filter(Boolean).filter(p => fs.existsSync(p));
  if (!allowedRoots.length) throw new Error('No accessible local filesystem roots found.');
  const excludedData = dataDir ? path.resolve(dataDir) : null;

  async function resolveExisting(value, kind = null) {
    const requested = cleanPath(value);
    if (!requested) throw Object.assign(new Error('Use an absolute local path.'), { status: 400 });
    let actual;
    try { actual = await realpath(requested); }
    catch { throw Object.assign(new Error('That file or folder was not found.'), { status: 404 }); }
    if (!allowedRoots.some(root => within(actual, root)) || (excludedData && within(actual, excludedData)))
      throw Object.assign(new Error('This path is outside the accessible local drives.'), { status: 403 });
    const info = await stat(actual);
    if (kind === 'file' && !info.isFile() || kind === 'directory' && !info.isDirectory())
      throw Object.assign(new Error(`Choose a ${kind}.`), { status: 400 });
    return { path: actual, info };
  }

  async function rootsList() {
    const home = os.homedir();
    const shortcuts = [home, path.join(home, 'Documents'), path.join(home, 'Desktop'), path.join(home, 'Downloads')]
      .filter(p => fs.existsSync(p) && allowedRoots.some(root => within(p, root)));
    return { roots: allowedRoots.map(p => ({ name: p, path: p })), shortcuts: [...new Set(shortcuts)].map(p => ({ name: path.basename(p) || p, path: p })) };
  }

  async function list(folder, offset = 0) {
    const target = await resolveExisting(folder, 'directory');
    const pageOffset = Number(offset);
    if (!Number.isInteger(pageOffset) || pageOffset < 0 || pageOffset > 1_000_000)
      throw Object.assign(new Error('Invalid folder page.'), { status: 400 });
    const entries = [];
    try {
      for await (const item of await opendir(target.path)) {
        try {
          const absolute = path.join(target.path, item.name);
          const info = await stat(absolute);
          if (item.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) continue;
          entries.push({ name: item.name, path: absolute, kind: info.isDirectory() ? 'folder' : 'file',
            size: info.size, modifiedAt: info.mtime.toISOString(), readable: info.isFile() && readableExtensions.has(path.extname(item.name).toLowerCase()) });
        } catch { /* inaccessible entries are omitted */ }
      }
    } catch { throw Object.assign(new Error('This folder cannot be opened.'), { status: 403 }); }
    entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
    const parent = path.dirname(target.path);
    const pageSize = 200;
    return { path: target.path, parent: parent !== target.path && allowedRoots.some(root => within(parent, root)) ? parent : null,
      entries: entries.slice(pageOffset, pageOffset + pageSize), total: entries.length,
      nextOffset: pageOffset + pageSize < entries.length ? pageOffset + pageSize : null };
  }

  async function readDocument(filePath) {
    const target = await resolveExisting(filePath, 'file');
    const ext = path.extname(target.path).toLowerCase();
    if (!readableExtensions.has(ext)) throw Object.assign(new Error('Preview supports text, code, PDF, and DOCX files.'), { status: 415 });
    if (target.info.size > maxReadBytes) throw Object.assign(new Error('This file is larger than the 15 MB reading limit.'), { status: 413 });
    const buffer = await readFile(target.path);
    let content;
    if (ext === '.pdf') {
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, disableFontFace: true });
      try {
        const pdf = await task.promise;
        const pages = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          const words = await page.getTextContent();
          pages.push(words.items.map(item => item.str || '').join(' '));
          page.cleanup();
          if (pages.join('').length > maxTextLength) break;
        }
        content = pages.join('\n\n');
      } finally { await task.destroy(); }
    } else if (ext === '.docx') {
      const { default: mammoth } = await import('mammoth');
      content = (await mammoth.extractRawText({ buffer })).value;
    }
    else {
      content = buffer.toString('utf8');
      if (content.includes('\uFFFD') || content.includes('\0')) throw Object.assign(new Error('This file is not readable as text.'), { status: 422 });
    }
    content = content.trim().slice(0, maxTextLength);
    if (!content) throw Object.assign(new Error('No text was found. Scanned PDFs require OCR.'), { status: 422 });
    return { name: path.basename(target.path), path: target.path, size: target.info.size,
      modifiedAt: target.info.mtime.toISOString(), content };
  }

  async function searchNames(query, scope, { limit = 40, maxEntries = 18000, maxMs = 8000 } = {}) {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const home = os.homedir();
    const quickPlaces = [path.join(home, 'Documents'), path.join(home, 'Desktop'), path.join(home, 'Downloads'), home]
      .filter(folder => fs.existsSync(folder) && allowedRoots.some(root => within(folder, root)));
    const startFolders = scope ? [(await resolveExisting(scope, 'directory')).path] : [...quickPlaces, ...allowedRoots];
    const queue = [], queued = new Set(), matches = [], started = Date.now();
    const enqueue = folder => { if (!queued.has(key(folder))) { queued.add(key(folder)); queue.push(folder); } };
    startFolders.forEach(enqueue);
    let visited = 0;
    while (queue.length && visited < maxEntries && Date.now() - started < maxMs && matches.length < limit) {
      const folder = queue.shift();
      try {
        for await (const item of await opendir(folder)) {
          if (++visited > maxEntries) break;
          const full = path.join(folder, item.name);
          if (excludedData && within(full, excludedData) || item.isSymbolicLink()) continue;
          const name = item.name.toLowerCase();
          if (terms.every(term => name.includes(term))) {
            matches.push({ name: item.name, path: full, kind: item.isDirectory() ? 'folder' : 'file', source: 'name' });
            if (matches.length >= limit) break;
          }
          if (item.isDirectory() && !skippedDuringScan.has(name)) enqueue(full);
        }
      } catch { /* unreadable folders are skipped */ }
    }
    return matches;
  }

  async function createFolder(parentPath, name) {
    const parent = await resolveExisting(parentPath, 'directory');
    const label = safeName(name);
    if (!label || label === '.' || label === '..' || /[\\/\x00-\x1f<>:"|?*]/.test(label) || label.endsWith('.'))
      throw Object.assign(new Error('Choose a valid single folder name.'), { status: 400 });
    const destination = path.join(parent.path, label);
    try { await mkdir(destination); }
    catch (err) { throw Object.assign(new Error(err.code === 'EEXIST' ? 'A file or folder with that name already exists.' : 'Could not create the folder.'), { status: err.code === 'EEXIST' ? 409 : 403 }); }
    return { path: destination, name: label };
  }

  async function relocate(sourcePath, destinationPath, mode) {
    const source = await resolveExisting(sourcePath);
    if (allowedRoots.some(root => key(root) === key(source.path))) throw Object.assign(new Error('A drive root cannot be moved or renamed.'), { status: 400 });
    let destination;
    if (mode === 'rename') {
      const label = safeName(destinationPath);
      if (!label || label === '.' || label === '..' || /[\\/\x00-\x1f<>:"|?*]/.test(label) || label.endsWith('.'))
        throw Object.assign(new Error('Choose a valid single name.'), { status: 400 });
      destination = path.join(path.dirname(source.path), label);
    } else if (mode === 'move') {
      const folder = await resolveExisting(destinationPath, 'directory');
      destination = path.join(folder.path, path.basename(source.path));
    } else throw Object.assign(new Error('Unknown file action.'), { status: 400 });
    if (key(destination) === key(source.path)) throw Object.assign(new Error('Choose a different name or folder.'), { status: 400 });
    if (source.info.isDirectory() && within(destination, source.path)) throw Object.assign(new Error('A folder cannot be moved inside itself.'), { status: 400 });
    if (fs.existsSync(destination)) throw Object.assign(new Error('A file or folder already exists at the destination.'), { status: 409 });
    try { await rename(source.path, destination); }
    catch (err) { throw Object.assign(new Error(err.code === 'EXDEV' ? 'Moving between drives is not supported yet.' : 'Could not complete this file action.'), { status: 400 }); }
    return { from: source.path, path: destination };
  }

  async function planOrganization(folderPath) {
    const folder = await resolveExisting(folderPath, 'directory');
    const items = [];
    let skipped = 0;
    for await (const entry of await opendir(folder.path)) {
      if (!entry.isFile() || entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name.startsWith('$')) { skipped++; continue; }
      const category = tidyCategories.get(path.extname(entry.name).toLowerCase());
      if (!category) { skipped++; continue; }
      const destinationFolder = path.join(folder.path, category);
      try {
        const existing = await lstat(destinationFolder);
        if (!existing.isDirectory() || existing.isSymbolicLink()) { skipped++; continue; }
      } catch (err) { if (err.code !== 'ENOENT') { skipped++; continue; } }
      const destination = path.join(destinationFolder, entry.name);
      if (fs.existsSync(destination)) { skipped++; continue; }
      items.push({ from: path.join(folder.path, entry.name), to: destination, name: entry.name, category });
      if (items.length >= 200) break;
    }
    items.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    return { folder: folder.path, items, skipped, limited: items.length >= 200 };
  }

  async function organize(folderPath, proposedItems) {
    if (!Array.isArray(proposedItems) || proposedItems.length > 200) throw Object.assign(new Error('Invalid organization plan.'), { status: 400 });
    const current = await planOrganization(folderPath);
    const valid = new Map(current.items.map(item => [item.from, item]));
    if (!proposedItems.length || new Set(proposedItems.map(item => item?.from)).size !== proposedItems.length ||
        proposedItems.some(item => !item || valid.get(item.from)?.to !== item.to))
      throw Object.assign(new Error('The folder changed. Review a fresh plan before organizing.'), { status: 409 });
    const moved = [], failed = [];
    for (const requested of proposedItems) {
      const item = valid.get(requested.from);
      try {
        await mkdir(path.dirname(item.to)).catch(err => { if (err.code !== 'EEXIST') throw err; });
        const categoryInfo = await lstat(path.dirname(item.to));
        if (!categoryInfo.isDirectory() || categoryInfo.isSymbolicLink() || fs.existsSync(item.to)) throw new Error('Destination changed.');
        await rename(item.from, item.to);
        moved.push({ from: item.from, path: item.to });
      } catch (err) { failed.push({ name: item.name, error: err.message }); }
    }
    return { moved, failed };
  }

  return { rootsList, resolveExisting, list, readDocument, searchNames, createFolder, relocate,
    planOrganization, organize, roots: allowedRoots, shouldSkipScan: name => skippedDuringScan.has(name.toLowerCase()) };
}
