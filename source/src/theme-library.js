'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LIBRARY_SCHEMA = 'cfb27-theme-library/1';
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_PREVIEW_SIZE = Object.freeze({ width: 1200, height: 800 });
const DEFAULT_THEME_CANVAS = Object.freeze({ width: 371, height: 433 });
const ORIGINAL_ESPN_2013_SHA256 = 'BDCF89E766BD98EFF75DEFDFC8E6FBAD2905B09CBEEE886C90B5AC9950A279F2';
const GENERIC_TITLES = new Set([
  'bundled page',
  'document',
  'index',
  'scoreboard',
  'untitled',
  'untitled document',
]);

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function decodeTitle(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function themeName(bytes, sourcePath) {
  const html = bytes.toString('utf8');
  const title = decodeTitle(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const usefulTitle = title && !GENERIC_TITLES.has(title.toLowerCase()) ? title : '';
  return (usefulTitle || path.basename(sourcePath, path.extname(sourcePath)) || 'Imported scoreboard').slice(0, 120);
}

function displayName(name, fileName) {
  const cleanName = String(name || '').trim();
  const fallback = path.basename(String(fileName || 'Imported scoreboard'), path.extname(String(fileName || '')));
  return (!cleanName || GENERIC_TITLES.has(cleanName.toLowerCase()) ? fallback : cleanName).slice(0, 120);
}

function attributeValue(tagSource, attribute) {
  const escaped = String(attribute).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(tagSource || '').match(new RegExp(
    `(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\u0060]+))`,
    'i',
  ));
  return String(match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim();
}

function srcsetValues(value) {
  const input = String(value || '').trim();
  const values = [];
  let cursor = 0;
  while (cursor < input.length) {
    while (cursor < input.length && /[\s,]/.test(input[cursor])) cursor += 1;
    if (cursor >= input.length) break;
    const start = cursor;
    const isData = input.slice(cursor, cursor + 5).toLowerCase() === 'data:';
    while (cursor < input.length && !/\s/.test(input[cursor]) && (isData || input[cursor] !== ',')) cursor += 1;
    const candidate = input.slice(start, cursor).replace(/,+$/, '').trim();
    if (candidate) values.push(candidate);
    while (cursor < input.length && input[cursor] !== ',') cursor += 1;
    if (input[cursor] === ',') cursor += 1;
  }
  return values;
}

function cssResourceValues(css) {
  const source = String(css || '').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const values = [];
  for (const match of source.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'";]+))\s*\)/gi)) {
    const value = String(match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (value) values.push(value);
  }
  for (const match of source.matchAll(/@import\s+(?!url\s*\()\s*(?:"([^"]+)"|'([^']+)')/gi)) {
    const value = String(match[1] ?? match[2] ?? '').trim();
    if (value) values.push(value);
  }
  return values;
}

function moduleResourceValues(script) {
  const source = String(script || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  const values = [];
  const staticStatement = /(?:^|[;}\r\n])\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?(?:"([^"]+)"|'([^']+)')/g;
  const dynamicImport = /\bimport\s*\(\s*(?:"([^"]+)"|'([^']+)')\s*\)/g;
  for (const expression of [staticStatement, dynamicImport]) {
    for (const match of source.matchAll(expression)) {
      const value = String(match[1] ?? match[2] ?? '').trim();
      if (value) values.push(value);
    }
  }
  return values;
}

function refreshTarget(value) {
  const target = String(value || '').match(/(?:^|;)\s*url\s*=\s*(.+?)\s*$/i)?.[1]?.trim() || '';
  if ((target.startsWith('"') && target.endsWith('"')) || (target.startsWith("'") && target.endsWith("'"))) {
    return target.slice(1, -1).trim();
  }
  return target;
}

function tagResources(html) {
  const resources = [];
  const token = /<\/?([a-z][\w:-]*)\b[^>]*>/gi;
  const rawTextTags = new Set(['script', 'style', 'textarea', 'title']);
  const resourceAttributes = {
    audio: ['src'],
    base: ['href'],
    body: ['background'],
    embed: ['src'],
    feimage: ['href', 'xlink:href'],
    iframe: ['src'],
    image: ['href', 'xlink:href'],
    img: ['src', 'srcset'],
    input: ['src'],
    link: ['href'],
    object: ['data'],
    script: ['src'],
    source: ['src', 'srcset'],
    track: ['src'],
    use: ['href', 'xlink:href'],
    video: ['src', 'poster'],
  };
  let rawText = null;
  const add = (tag, attribute, value) => {
    const values = attribute === 'srcset' ? srcsetValues(value) : [value];
    for (const candidate of values) {
      const clean = String(candidate || '').trim();
      if (clean) resources.push({ tag, attribute, value: clean });
    }
  };
  const finishRawText = (end) => {
    if (!rawText) return;
    const content = html.slice(rawText.start, end);
    if (rawText.tag === 'style') {
      for (const value of cssResourceValues(content)) add('style', 'css', value);
    } else if (rawText.tag === 'script' && rawText.module) {
      for (const value of moduleResourceValues(content)) add('script', 'module', value);
    }
    rawText = null;
  };

  let match;
  while ((match = token.exec(html))) {
    const source = match[0];
    const tag = match[1].toLowerCase();
    const closing = /^<\//.test(source);
    if (rawText) {
      if (closing && tag === rawText.tag) finishRawText(match.index);
      continue;
    }
    if (closing) continue;
    for (const attribute of resourceAttributes[tag] || []) {
      const value = attributeValue(source, attribute);
      if (value) add(tag, attribute, value);
    }
    const inlineStyle = attributeValue(source, 'style');
    for (const value of cssResourceValues(inlineStyle)) add(tag, 'style', value);
    if (tag === 'meta' && /^refresh$/i.test(attributeValue(source, 'http-equiv'))) {
      add(tag, 'refresh', refreshTarget(attributeValue(source, 'content')));
    }
    if (rawTextTags.has(tag) && !/\/>\s*$/.test(source)) {
      rawText = {
        tag,
        start: token.lastIndex,
        module: tag === 'script' && /^module$/i.test(attributeValue(source, 'type')),
      };
    }
  }
  if (rawText) finishRawText(html.length);
  return resources;
}

function dependencyKind(value) {
  const normalized = String(value || '').trim();
  if (!normalized || /^(?:#|data:|blob:|about:|javascript:)/i.test(normalized)) return 'embedded';
  if (/^(?:https?:)?\/\//i.test(normalized)) return 'remote';
  return 'local';
}

function authoredCanvasSize(html) {
  const decoded = String(html || '')
    .replace(/&quot;/gi, '"')
    .replace(/&#36;/g, '$')
    .replace(/\\"/g, '"');
  const metadata = new Map();
  for (const match of decoded.matchAll(/<meta\b[^>]*>/gi)) {
    const name = attributeValue(match[0], 'name').toLowerCase();
    const content = attributeValue(match[0], 'content');
    if (name && content) metadata.set(name, content);
  }
  const dataWidth = decoded.match(/data-cfb27-(?:canvas-)?width=["'](\d{2,5})["']/i)?.[1];
  const dataHeight = decoded.match(/data-cfb27-(?:canvas-)?height=["'](\d{2,5})["']/i)?.[1];
  const width = Number(
    metadata.get('cfb27-canvas-width')
    || metadata.get('canvas-width')
    || metadata.get('overlay-width')
    || dataWidth,
  );
  const height = Number(
    metadata.get('cfb27-canvas-height')
    || metadata.get('canvas-height')
    || metadata.get('overlay-height')
    || dataHeight,
  );
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return {
    width: Math.max(160, Math.min(5000, Math.round(width))),
    height: Math.max(32, Math.min(3000, Math.round(height))),
  };
}

function requestedLogoLibrary(html) {
  const decoded = String(html || '')
    .replace(/&quot;/gi, '"')
    .replace(/&#36;/g, '$')
    .replace(/\\"/g, '"');
  const requested = decoded.match(/data-cfb27-logo-library\s*=\s*["']([^"']+)["']/i)?.[1];
  const normalized = String(requested || '').trim().toLowerCase();
  if (normalized === 'original') return 'original';
  if (normalized === 'cropped' || normalized === 'default') return 'cropped';
  return null;
}

function detectedCanvasSize(html) {
  const authored = authoredCanvasSize(html);
  if (authored) return authored;
  const decoded = String(html || '').replace(/&quot;/gi, '"').replace(/&#36;/g, '$');
  const preview = decoded.match(/["']?\$preview["']?\s*:\s*\{[\s\S]{0,500}?["']?width["']?\s*:\s*(\d{2,5})[\s\S]{0,250}?["']?height["']?\s*:\s*(\d{2,5})/i);
  const svg = decoded.match(/<svg\b[^>]*\bviewBox=["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)["']/i);
  const width = Number(preview?.[1] || svg?.[1]);
  const height = Number(preview?.[2] || svg?.[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return {
    width: Math.max(160, Math.min(5000, Math.round(width))),
    height: Math.max(32, Math.min(3000, Math.round(height))),
  };
}

function previewSize(html) {
  return detectedCanvasSize(html) || { ...DEFAULT_PREVIEW_SIZE };
}

function themeCanvasSize(theme = {}) {
  if (String(theme.sha256 || '').toUpperCase() === ORIGINAL_ESPN_2013_SHA256) {
    return { ...DEFAULT_THEME_CANVAS };
  }
  const detected = theme.compatibility?.canvas || null;
  const width = Number(theme.canvasWidth ?? detected?.width);
  const height = Number(theme.canvasHeight ?? detected?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ...DEFAULT_THEME_CANVAS };
  }
  return {
    width: Math.max(160, Math.min(5000, Math.round(width))),
    height: Math.max(32, Math.min(3000, Math.round(height))),
  };
}

function analyzeThemeHtml(bytes) {
  const html = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes || '');
  const resources = tagResources(html);
  const dependencyDetails = resources
    .map((entry) => ({ ...entry, kind: dependencyKind(entry.value) }))
    .filter((entry) => entry.kind !== 'embedded');
  const localDependencies = [...new Set(dependencyDetails.filter((entry) => entry.kind === 'local').map((entry) => entry.value))];
  const remoteDependencies = [...new Set(dependencyDetails.filter((entry) => entry.kind === 'remote').map((entry) => entry.value))];
  const bindings = [...new Set([...html.matchAll(/data-cfb27-bind\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]))];
  const hasExplicitRoot = /data-cfb27-(?:scorebug|import-root)(?:\s|=|>)/i.test(html);
  const claudeStandalone = /type=["']__bundler\/(?:manifest|template)["']/i.test(html)
    && /id=["']__bundler_thumbnail["']/i.test(html);
  const canUse = localDependencies.length === 0 && remoteDependencies.length === 0;
  let level = 'automatic';
  let label = 'Standalone HTML';
  let detail = 'The app will attempt automatic field matching.';
  if (!canUse) {
    level = 'blocked';
    if (localDependencies.length) {
      label = 'Project HTML — not usable';
      detail = `Missing ${localDependencies.slice(0, 2).join(', ')}. Export Claude's Standalone HTML instead.`;
    } else {
      label = 'Online HTML — blocked';
      detail = `External resource ${remoteDependencies.slice(0, 2).join(', ')} is not allowed. Embed every asset in one Standalone HTML file.`;
    }
  } else if (hasExplicitRoot && bindings.length > 0) {
    level = 'ready';
    label = 'Live-data ready';
    detail = `${bindings.length} explicit live field${bindings.length === 1 ? '' : 's'} detected.`;
  } else if (claudeStandalone) {
    level = 'automatic';
    label = 'Claude Standalone HTML';
    detail = 'Self-contained preview; live fields use automatic matching unless data-cfb27-bind tags are added.';
  }
  return {
    canUse,
    claudeStandalone,
    hasExplicitRoot,
    bindings,
    localDependencies,
    remoteDependencies,
    dependencyDetails,
    level,
    label,
    detail,
    canvas: detectedCanvasSize(html),
    authoredCanvas: authoredCanvasSize(html),
    logoLibrary: requestedLogoLibrary(html),
    preview: previewSize(html),
  };
}

function unusableProjectError(compatibility) {
  if (compatibility.remoteDependencies.length) {
    return new Error(`This HTML uses external resource ${compatibility.remoteDependencies.slice(0, 2).join(', ')}. Imported scoreboards run offline; embed every asset in one Standalone HTML file.`);
  }
  return new Error(`This is Project HTML and depends on ${compatibility.localDependencies.slice(0, 2).join(', ')}. In Claude, download Standalone HTML instead.`);
}

function tightenThumbnailSvg(svg) {
  const viewBox = svg.match(/\bviewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)["']/i);
  if (!viewBox) return svg;
  const original = {
    x: Number(viewBox[1]), y: Number(viewBox[2]), width: Number(viewBox[3]), height: Number(viewBox[4]),
  };
  if (!Object.values(original).every(Number.isFinite) || original.width <= 0 || original.height <= 0) return svg;
  const candidates = [];
  for (const match of svg.matchAll(/<rect\b[^>]*>/gi)) {
    const tag = match[0];
    const numberAttribute = (name, fallback = 0) => Number(tag.match(new RegExp(`\\b${name}=["']([-\\d.]+)["']`, 'i'))?.[1] ?? fallback);
    const rect = {
      x: numberAttribute('x'), y: numberAttribute('y'), width: numberAttribute('width'), height: numberAttribute('height'),
    };
    if (!Object.values(rect).every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) continue;
    if (rect.width * rect.height >= original.width * original.height * 0.7) continue;
    candidates.push(rect);
  }
  if (!candidates.length) return svg;
  const left = Math.min(...candidates.map((rect) => rect.x));
  const top = Math.min(...candidates.map((rect) => rect.y));
  const right = Math.max(...candidates.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...candidates.map((rect) => rect.y + rect.height));
  const contentWidth = right - left;
  const contentHeight = bottom - top;
  if (contentWidth < 20 || contentHeight < 20) return svg;
  const padX = Math.max(8, contentWidth * 0.04);
  const padY = Math.max(8, contentHeight * 0.08);
  const x = Math.max(original.x, left - padX);
  const y = Math.max(original.y, top - padY);
  const croppedRight = Math.min(original.x + original.width, right + padX);
  const croppedBottom = Math.min(original.y + original.height, bottom + padY);
  const replacement = `viewBox="${x} ${y} ${croppedRight - x} ${croppedBottom - y}"`;
  return svg.replace(viewBox[0], replacement);
}

function safePreviewDocument(bytes) {
  const html = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes || '');
  const thumbnail = html.match(/<div\b[^>]*\bid=["']__bundler_thumbnail["'][^>]*>[\s\S]*?(<svg\b[\s\S]*?<\/svg>)[\s\S]*?<\/div>/i)?.[1];
  if (thumbnail) {
    return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}body{display:grid;place-items:center}svg{display:block;width:100%;height:100%;object-fit:contain}</style></head><body>${tightenThumbnailSvg(thumbnail)}</body></html>`;
  }
  const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; font-src data:; script-src \'none\'; object-src \'none\'; frame-src \'none\'; connect-src \'none\'; media-src data: blob:; base-uri \'none\'; form-action \'none\';">';
  const withoutBaseOrRefresh = html
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
  if (/<head\b[^>]*>/i.test(withoutBaseOrRefresh)) {
    return withoutBaseOrRefresh.replace(/<head\b[^>]*>/i, (head) => `${head}${policy}`);
  }
  return `<!doctype html><html><head>${policy}</head><body>${withoutBaseOrRefresh}</body></html>`;
}

function isInside(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate !== resolvedRoot && resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

class ThemeLibrary {
  constructor(rootDirectory, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
    if (!rootDirectory) throw new Error('Theme library requires a root directory.');
    this.rootDirectory = path.resolve(rootDirectory);
    this.manifestPath = path.join(this.rootDirectory, 'library.json');
    this.maxBytes = Number(maxBytes) || DEFAULT_MAX_BYTES;
  }

  readManifest() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
      if (parsed?.schema !== LIBRARY_SCHEMA || !Array.isArray(parsed.themes)) throw new Error('Unsupported theme library manifest.');
      return parsed;
    } catch (error) {
      if (error.code === 'ENOENT') return { schema: LIBRARY_SCHEMA, themes: [] };
      throw error;
    }
  }

  writeManifest(manifest) {
    fs.mkdirSync(this.rootDirectory, { recursive: true });
    const temporary = `${this.manifestPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      fs.renameSync(temporary, this.manifestPath);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
  }

  resolveEntry(entry) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.relativePath !== 'string') {
      throw new Error('Theme library entry is invalid.');
    }
    const filePath = path.resolve(this.rootDirectory, entry.relativePath);
    if (!isInside(this.rootDirectory, filePath)) throw new Error('Theme library entry escaped its root directory.');
    if (!['.html', '.htm'].includes(path.extname(filePath).toLowerCase())) throw new Error('Theme library entry is not HTML.');
    const fileStat = fs.lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) throw new Error('Theme library HTML is missing or unsafe.');
    const storedBytes = fs.readFileSync(filePath);
    const storedHash = sha256(storedBytes);
    if (entry.sha256 && String(entry.sha256).toUpperCase() !== storedHash) {
      throw new Error('Theme library HTML failed its stored SHA-256 check.');
    }
    const compatibility = analyzeThemeHtml(storedBytes);
    const canvas = themeCanvasSize({
      sha256: storedHash,
      canvasWidth: compatibility.authoredCanvas?.width ?? entry.canvasWidth,
      canvasHeight: compatibility.authoredCanvas?.height ?? entry.canvasHeight,
      compatibility,
    });
    return {
      id: entry.id,
      name: displayName(entry.name, entry.fileName || path.basename(filePath)),
      fileName: String(entry.fileName || path.basename(filePath)),
      path: filePath,
      sha256: storedHash,
      bytes: storedBytes.length,
      importedAt: String(entry.importedAt || ''),
      sourcePath: String(entry.sourcePath || ''),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      compatibility,
      previewHtml: safePreviewDocument(storedBytes),
    };
  }

  list() {
    const manifest = this.readManifest();
    return manifest.themes
      .map((entry) => {
        try { return this.resolveEntry(entry); } catch { return null; }
      })
      .filter(Boolean)
      .sort((left, right) => right.importedAt.localeCompare(left.importedAt));
  }

  get(id) {
    const entry = this.readManifest().themes.find((candidate) => candidate?.id === id);
    if (!entry) throw new Error('Theme library item was not found.');
    const theme = this.resolveEntry(entry);
    if (!theme.compatibility.canUse) throw unusableProjectError(theme.compatibility);
    return theme;
  }

  delete(id) {
    const manifest = this.readManifest();
    const entryIndex = manifest.themes.findIndex((candidate) => candidate?.id === id);
    if (entryIndex < 0) throw new Error('Theme library item was not found.');
    const entry = manifest.themes[entryIndex];
    const theme = this.resolveEntry(entry);
    const themeDirectory = path.dirname(theme.path);
    if (!isInside(this.rootDirectory, themeDirectory)
      || path.dirname(themeDirectory) !== path.join(this.rootDirectory, 'themes')) {
      throw new Error('Theme library item has an unsafe storage location.');
    }
    const directoryStat = fs.lstatSync(themeDirectory);
    const realThemesRoot = fs.realpathSync(path.join(this.rootDirectory, 'themes'));
    const realThemeDirectory = fs.realpathSync(themeDirectory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()
      || path.dirname(realThemeDirectory) !== realThemesRoot) {
      throw new Error('Theme library item has an unsafe storage location.');
    }
    fs.rmSync(themeDirectory, { recursive: true, force: true });
    manifest.themes.splice(entryIndex, 1);
    this.writeManifest(manifest);
    return theme;
  }

  importFile(sourcePath) {
    const resolvedSource = path.resolve(String(sourcePath || ''));
    if (!['.html', '.htm'].includes(path.extname(resolvedSource).toLowerCase())) {
      throw new Error('Theme library imports must be standalone .html or .htm files.');
    }
    const sourceStat = fs.lstatSync(resolvedSource);
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) throw new Error('Selected theme is not a regular file.');
    if (sourceStat.size < 1 || sourceStat.size > this.maxBytes) {
      throw new Error(`Theme HTML must be between 1 byte and ${this.maxBytes} bytes.`);
    }

    const bytes = fs.readFileSync(resolvedSource);
    const compatibility = analyzeThemeHtml(bytes);
    if (!compatibility.canUse) throw unusableProjectError(compatibility);
    const hash = sha256(bytes);
    const manifest = this.readManifest();
    const duplicate = manifest.themes.find((entry) => String(entry?.sha256 || '').toUpperCase() === hash);
    if (duplicate) {
      try { return this.resolveEntry(duplicate); } catch { /* Rebuild a missing library copy below. */ }
    }

    const id = hash.toLowerCase();
    const isOriginalEspn2013 = hash === ORIGINAL_ESPN_2013_SHA256;
    const name = isOriginalEspn2013 ? 'Football Scorebug ESPN 2013' : themeName(bytes, resolvedSource);
    const fileName = isOriginalEspn2013 ? 'Football Scorebug ESPN 2013.html' : path.basename(resolvedSource);
    const relativePath = `themes/${id}/index.html`;
    const destination = path.resolve(this.rootDirectory, relativePath);
    if (!isInside(this.rootDirectory, destination)) throw new Error('Theme import destination escaped the library.');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporary, bytes);
      fs.renameSync(temporary, destination);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
    if (sha256(fs.readFileSync(destination)) !== hash) throw new Error('Stored theme failed its SHA-256 verification.');

    const canvas = themeCanvasSize({ sha256: hash, compatibility });
    const entry = {
      id,
      name,
      fileName,
      relativePath,
      sha256: hash,
      bytes: bytes.length,
      importedAt: new Date().toISOString(),
      sourcePath: '',
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };
    manifest.themes = manifest.themes.filter((candidate) => candidate?.id !== id && String(candidate?.sha256 || '').toUpperCase() !== hash);
    manifest.themes.push(entry);
    this.writeManifest(manifest);
    return this.resolveEntry(entry);
  }
}

module.exports = {
  DEFAULT_MAX_BYTES,
  LIBRARY_SCHEMA,
  ORIGINAL_ESPN_2013_SHA256,
  ThemeLibrary,
  analyzeThemeHtml,
  authoredCanvasSize,
  detectedCanvasSize,
  displayName,
  isInside,
  previewSize,
  requestedLogoLibrary,
  safePreviewDocument,
  sha256,
  themeCanvasSize,
  themeName,
  tightenThumbnailSvg,
};
