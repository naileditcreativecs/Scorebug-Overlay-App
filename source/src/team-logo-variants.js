'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { trimPngDataUrl, trimTransparentPng } = require('./png-alpha-trim');

const DEFAULT_VARIANT_ID = 'default';
const SAFE_VARIANT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function safePngFile(value) {
  const file = String(value || '').trim();
  if (!file || path.basename(file) !== file || path.extname(file).toLowerCase() !== '.png') return null;
  return file;
}

function normalizedPreferences(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([teamId, variantId]) => [String(teamId), String(variantId || '').trim().toLowerCase()])
    .filter(([, variantId]) => SAFE_VARIANT_ID.test(variantId)));
}

class TeamLogoVariantResolver {
  constructor(manifest = {}, assetRoot = '') {
    this.assetRoot = path.resolve(assetRoot || '.');
    this.byTeamId = new Map();
    this.dataUrlCache = new Map();
    this.normalizedLogoCache = new Map();
    this.additionalChoiceSource = null;

    for (const entry of Array.isArray(manifest.teams) ? manifest.teams : []) {
      const teamId = String(entry?.teamId ?? '').trim();
      if (!teamId || this.byTeamId.has(teamId)) continue;
      const variants = [];
      const seen = new Set([DEFAULT_VARIANT_ID]);
      for (const candidate of Array.isArray(entry.variants) ? entry.variants : []) {
        const id = String(candidate?.id || '').trim().toLowerCase();
        const file = safePngFile(candidate?.file);
        if (!SAFE_VARIANT_ID.test(id) || seen.has(id) || !file) continue;
        seen.add(id);
        variants.push(Object.freeze({
          id,
          label: String(candidate?.label || id).trim() || id,
          file,
          width: Number(candidate?.width) || null,
          height: Number(candidate?.height) || null,
          source: String(candidate?.source || 'bundled-variant'),
          preserveCanvas: candidate?.preserveCanvas === true,
        }));
      }
      this.byTeamId.set(teamId, Object.freeze({
        teamId,
        defaultLabel: String(entry?.defaultLabel || 'Default logo').trim() || 'Default logo',
        variants: Object.freeze(variants),
      }));
    }
  }

  setAdditionalChoiceSource(source) {
    this.additionalChoiceSource = source && typeof source.choicesForTeam === 'function'
      ? source
      : null;
    return this;
  }

  static fromAppRoot(appRoot) {
    const assetRoot = path.join(appRoot, 'assets', 'team-logo-variants');
    const manifestPath = path.join(assetRoot, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return new TeamLogoVariantResolver({}, assetRoot);
    return new TeamLogoVariantResolver(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), assetRoot);
  }

  logoDataUrl(file, options = {}) {
    const safeFile = safePngFile(file);
    if (!safeFile) return null;
    const preserveCanvas = options.preserveCanvas === true;
    const cacheKey = `${preserveCanvas ? 'raw' : 'trim'}:${safeFile}`;
    if (this.dataUrlCache.has(cacheKey)) return this.dataUrlCache.get(cacheKey);
    const fullPath = path.join(this.assetRoot, safeFile);
    if (!fs.existsSync(fullPath)) return null;
    const bytes = fs.readFileSync(fullPath);
    const asset = preserveCanvas
      ? Object.freeze({
        logo: `data:image/png;base64,${bytes.toString('base64')}`,
        width: Number(options.width) || null,
        height: Number(options.height) || null,
        originalWidth: Number(options.width) || null,
        originalHeight: Number(options.height) || null,
        trimBounds: null,
        trimmed: false,
      })
      : (() => {
        const trimmed = trimTransparentPng(bytes);
        return Object.freeze({
          logo: `data:image/png;base64,${trimmed.buffer.toString('base64')}`,
          width: trimmed.width,
          height: trimmed.height,
          originalWidth: trimmed.originalWidth,
          originalHeight: trimmed.originalHeight,
          trimBounds: trimmed.bounds,
          trimmed: trimmed.trimmed,
        });
      })();
    this.dataUrlCache.set(cacheKey, asset);
    return asset;
  }

  normalizedLogoAsset(source, fallback = {}) {
    if (typeof source !== 'string' || !source) return null;
    if (this.normalizedLogoCache.has(source)) return this.normalizedLogoCache.get(source);
    let asset;
    if (fallback.preCropped === true) {
      asset = Object.freeze({
        logo: source,
        width: Number(fallback.width) || null,
        height: Number(fallback.height) || null,
        originalWidth: Number(fallback.width) || null,
        originalHeight: Number(fallback.height) || null,
        trimBounds: null,
        trimmed: false,
      });
      this.normalizedLogoCache.set(source, asset);
      return asset;
    }
    try {
      const trimmed = trimPngDataUrl(source);
      asset = trimmed ? Object.freeze({
        logo: trimmed.dataUrl,
        width: trimmed.width,
        height: trimmed.height,
        originalWidth: trimmed.originalWidth,
        originalHeight: trimmed.originalHeight,
        trimBounds: trimmed.bounds,
        trimmed: trimmed.trimmed,
      }) : Object.freeze({
        logo: source,
        width: Number(fallback.width) || null,
        height: Number(fallback.height) || null,
        originalWidth: Number(fallback.width) || null,
        originalHeight: Number(fallback.height) || null,
        trimBounds: null,
        trimmed: false,
      });
    } catch {
      asset = Object.freeze({
        logo: source,
        width: Number(fallback.width) || null,
        height: Number(fallback.height) || null,
        originalWidth: Number(fallback.width) || null,
        originalHeight: Number(fallback.height) || null,
        trimBounds: null,
        trimmed: false,
      });
    }
    if (this.normalizedLogoCache.size >= 300) this.normalizedLogoCache.clear();
    this.normalizedLogoCache.set(source, asset);
    return asset;
  }

  choicesForTeam(teamId, teamAssetResolver) {
    const asset = teamAssetResolver?.resolveTeamId(String(teamId));
    if (!asset) return [];
    const entry = this.byTeamId.get(String(teamId));
    const choices = [];
    if (asset.logo) {
      const normalized = this.normalizedLogoAsset(asset.logo, asset);
      choices.push(Object.freeze({
        id: DEFAULT_VARIANT_ID,
        label: entry?.defaultLabel || 'Default logo',
        ...normalized,
        source: asset.source || 'bundled-team',
      }));
    }
    for (const variant of entry?.variants || []) {
      const normalized = this.logoDataUrl(variant.file, variant);
      if (!normalized?.logo) continue;
      choices.push(Object.freeze({ ...variant, ...normalized }));
    }
    const seen = new Set(choices.map((choice) => choice.id));
    for (const choice of this.additionalChoiceSource?.choicesForTeam(String(teamId)) || []) {
      const id = String(choice?.id || '').trim().toLowerCase();
      if (!SAFE_VARIANT_ID.test(id) || seen.has(id) || !choice?.logo) continue;
      seen.add(id);
      choices.push(Object.freeze({ ...choice, id }));
    }
    return choices;
  }

  resolveChoice(teamId, variantId, teamAssetResolver) {
    const target = String(variantId || '').trim().toLowerCase();
    if (!SAFE_VARIANT_ID.test(target)) return null;
    return this.choicesForTeam(teamId, teamAssetResolver)
      .find((choice) => choice.id === target) || null;
  }
}

function applyTeamLogoPreferences(sourceState, preferences, teamAssetResolver, variantResolver) {
  const payload = {
    ...sourceState,
    away: { ...(sourceState?.away || {}) },
    home: { ...(sourceState?.home || {}) },
    game: { ...(sourceState?.game || {}) },
    meta: { ...(sourceState?.meta || {}) },
  };
  const selected = normalizedPreferences(preferences);
  const applied = {};

  for (const side of ['away', 'home']) {
    const publishedTeamId = payload.meta?.teamAssets?.[side]?.id;
    const asset = publishedTeamId
      ? teamAssetResolver?.resolveTeamId(publishedTeamId)
      : teamAssetResolver?.resolve(payload[side]?.name);
    if (!asset) continue;
    const requestedVariantId = selected[String(asset.id)] || DEFAULT_VARIANT_ID;
    let choice = variantResolver?.resolveChoice(asset.id, requestedVariantId, teamAssetResolver);
    if (!choice && requestedVariantId !== DEFAULT_VARIANT_ID) {
      choice = variantResolver?.resolveChoice(asset.id, DEFAULT_VARIANT_ID, teamAssetResolver);
    }
    if (!choice?.logo) continue;
    payload[side].logo = choice.logo;
    if (choice.id !== DEFAULT_VARIANT_ID) {
      applied[side] = {
        teamId: String(asset.id),
        variantId: choice.id,
        label: choice.label,
      };
    }
  }

  if (Object.keys(applied).length) payload.meta.teamLogoPreferences = applied;
  else delete payload.meta.teamLogoPreferences;
  return payload;
}

function normalizeThemeLogoLibrary(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'original') return 'original';
  if (normalized === 'cropped' || normalized === 'default') return 'cropped';
  return null;
}

function applyThemeLogoLibrary(sourceState, library, teamAssetResolver, variantResolver) {
  const normalizedLibrary = normalizeThemeLogoLibrary(library);
  if (!normalizedLibrary) return sourceState;

  const payload = {
    ...sourceState,
    away: { ...(sourceState?.away || {}) },
    home: { ...(sourceState?.home || {}) },
    game: { ...(sourceState?.game || {}) },
    meta: { ...(sourceState?.meta || {}) },
  };
  const variantId = normalizedLibrary === 'original' ? 'original' : DEFAULT_VARIANT_ID;
  const applied = {};

  for (const side of ['away', 'home']) {
    const publishedTeamId = payload.meta?.teamAssets?.[side]?.id;
    const asset = publishedTeamId
      ? teamAssetResolver?.resolveTeamId(publishedTeamId)
      : teamAssetResolver?.resolve(payload[side]?.name);
    if (!asset) continue;
    const choice = variantResolver?.resolveChoice(asset.id, variantId, teamAssetResolver)
      || variantResolver?.resolveChoice(asset.id, DEFAULT_VARIANT_ID, teamAssetResolver);
    if (!choice?.logo) continue;
    payload[side].logo = choice.logo;
    applied[side] = {
      teamId: String(asset.id),
      variantId: choice.id,
      label: choice.label,
    };
  }

  payload.meta.teamLogoThemeOverride = {
    library: normalizedLibrary,
    teams: applied,
  };
  return payload;
}

module.exports = {
  DEFAULT_VARIANT_ID,
  TeamLogoVariantResolver,
  applyThemeLogoLibrary,
  applyTeamLogoPreferences,
  normalizeThemeLogoLibrary,
  normalizedPreferences,
};
