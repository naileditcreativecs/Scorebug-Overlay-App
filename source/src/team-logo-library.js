'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PNG_SIGNATURE, trimTransparentPng } = require('./png-alpha-trim');

const SAFE_CUSTOM_ID = /^custom-[a-z0-9-]{8,80}$/;

function safePngFile(value) {
  const file = String(value || '').trim();
  if (!file || path.basename(file) !== file || path.extname(file).toLowerCase() !== '.png') return null;
  return file;
}

function normalizedCustomTeamLogos(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const candidate of value) {
    const id = String(candidate?.id || '').trim().toLowerCase();
    const teamId = String(candidate?.teamId ?? '').trim();
    const file = safePngFile(candidate?.file);
    if (!SAFE_CUSTOM_ID.test(id) || !teamId || !file || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      teamId,
      label: String(candidate?.label || 'Imported logo').trim().slice(0, 80) || 'Imported logo',
      file,
      width: Math.max(1, Math.round(Number(candidate?.width) || 1)),
      height: Math.max(1, Math.round(Number(candidate?.height) || 1)),
      originalWidth: Math.max(1, Math.round(Number(candidate?.originalWidth) || Number(candidate?.width) || 1)),
      originalHeight: Math.max(1, Math.round(Number(candidate?.originalHeight) || Number(candidate?.height) || 1)),
      trimBounds: candidate?.trimBounds && typeof candidate.trimBounds === 'object'
        ? {
            left: Math.max(0, Math.round(Number(candidate.trimBounds.left) || 0)),
            top: Math.max(0, Math.round(Number(candidate.trimBounds.top) || 0)),
            right: Math.max(0, Math.round(Number(candidate.trimBounds.right) || 0)),
            bottom: Math.max(0, Math.round(Number(candidate.trimBounds.bottom) || 0)),
          }
        : null,
      trimmed: Boolean(candidate?.trimmed),
      source: 'user-import',
      createdAt: String(candidate?.createdAt || ''),
    });
  }
  return result;
}

class CustomTeamLogoStore {
  constructor(rootPath) {
    this.rootPath = path.resolve(rootPath || '.');
    this.dataUrlCache = new Map();
  }

  fullPath(file) {
    const safeFile = safePngFile(file);
    if (!safeFile) return null;
    const resolved = path.resolve(this.rootPath, safeFile);
    return resolved.startsWith(`${this.rootPath}${path.sep}`) ? resolved : null;
  }

  logoAsset(file) {
    const fullPath = this.fullPath(file);
    if (!fullPath || !fs.existsSync(fullPath)) return null;
    const stats = fs.statSync(fullPath);
    const cacheKey = `${fullPath}:${stats.size}:${stats.mtimeMs}`;
    if (this.dataUrlCache.has(cacheKey)) return this.dataUrlCache.get(cacheKey);
    const trimmed = trimTransparentPng(fs.readFileSync(fullPath));
    const asset = Object.freeze({
      logo: `data:image/png;base64,${trimmed.buffer.toString('base64')}`,
      width: trimmed.width,
      height: trimmed.height,
      originalWidth: trimmed.originalWidth,
      originalHeight: trimmed.originalHeight,
      trimBounds: trimmed.bounds,
      trimmed: trimmed.trimmed,
    });
    this.dataUrlCache.clear();
    this.dataUrlCache.set(cacheKey, asset);
    return asset;
  }

  logoDataUrl(file) {
    return this.logoAsset(file)?.logo || null;
  }

  choicesForTeam(teamId, catalog) {
    return normalizedCustomTeamLogos(catalog)
      .filter((entry) => entry.teamId === String(teamId))
      .map((entry) => {
        const asset = this.logoAsset(entry.file);
        if (!asset?.logo) return null;
        const wasTrimmedOnImport = Boolean(entry.trimmed);
        return Object.freeze({
          ...entry,
          ...asset,
          originalWidth: wasTrimmedOnImport ? entry.originalWidth : asset.originalWidth,
          originalHeight: wasTrimmedOnImport ? entry.originalHeight : asset.originalHeight,
          trimBounds: wasTrimmedOnImport ? entry.trimBounds : asset.trimBounds,
          trimmed: wasTrimmedOnImport || asset.trimmed,
          custom: true,
        });
      })
      .filter(Boolean);
  }

  importPng({ teamId, label, png, width, height, catalog }) {
    const normalizedTeamId = String(teamId ?? '').trim();
    const bytes = Buffer.isBuffer(png) ? png : Buffer.from(png || []);
    if (!normalizedTeamId) throw new Error('Choose a detected team before importing a logo.');
    if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error('The selected image could not be converted to a safe PNG.');
    }
    if (bytes.length > 20 * 1024 * 1024) throw new Error('The converted logo is larger than 20 MB.');
    const trimmed = trimTransparentPng(bytes);

    const token = crypto.randomUUID().toLowerCase();
    const id = `custom-${token}`;
    const file = `${normalizedTeamId}-${token}.png`;
    const destination = this.fullPath(file);
    if (!destination) throw new Error('A safe logo destination could not be created.');
    fs.mkdirSync(this.rootPath, { recursive: true });
    const temporary = `${destination}.tmp`;
    fs.writeFileSync(temporary, trimmed.buffer);
    fs.renameSync(temporary, destination);

    const entry = {
      id,
      teamId: normalizedTeamId,
      label: String(label || 'Imported logo').trim().slice(0, 80) || 'Imported logo',
      file,
      width: trimmed.width,
      height: trimmed.height,
      originalWidth: trimmed.originalWidth || Math.max(1, Math.round(Number(width) || 1)),
      originalHeight: trimmed.originalHeight || Math.max(1, Math.round(Number(height) || 1)),
      trimBounds: trimmed.bounds,
      trimmed: trimmed.trimmed,
      source: 'user-import',
      createdAt: new Date().toISOString(),
    };
    return {
      entry,
      catalog: [...normalizedCustomTeamLogos(catalog), entry],
    };
  }

  remove(choiceId, catalog) {
    const normalized = normalizedCustomTeamLogos(catalog);
    const id = String(choiceId || '').trim().toLowerCase();
    const entry = normalized.find((candidate) => candidate.id === id);
    if (!entry) throw new Error('That imported logo is no longer installed.');
    const target = this.fullPath(entry.file);
    if (target && fs.existsSync(target)) fs.unlinkSync(target);
    this.dataUrlCache.clear();
    return normalized.filter((candidate) => candidate.id !== id);
  }
}

module.exports = {
  CustomTeamLogoStore,
  normalizedCustomTeamLogos,
};
