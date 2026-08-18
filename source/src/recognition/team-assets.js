'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MINIMUM_UNIQUE_PREFIX_CHARACTERS = 2;
const MINIMUM_UNIQUE_FRAGMENT_CHARACTERS = 4;
const MINIMUM_CLOSEST_MATCH_CHARACTERS = 3;
const MAXIMUM_CLOSEST_MATCH_SCORE = 0.34;
const MINIMUM_CLOSEST_MATCH_MARGIN = 0.055;
const OCR_FRAGMENT_SUBSTITUTIONS = new Set([
  '0O', '1I', '1L', '5S', '6G', '8B', 'CG', 'EF', 'EU', 'FP', 'IL', 'OQ', 'UV',
]);

const OCR_CHARACTER_NEIGHBORS = Object.freeze({
  0: 'OQ',
  1: 'IL',
  2: 'Z',
  5: 'S',
  6: 'G',
  8: 'B',
  B: '8R',
  C: 'GE',
  E: 'CFP',
  F: 'EPL',
  G: 'C6Q',
  I: '1LT',
  L: '1IFT',
  M: 'NHW',
  N: 'MHR',
  O: '0QD',
  P: 'EFR',
  Q: '0OG',
  R: 'BPN',
  S: '5',
  T: 'ILF',
  U: 'VJ',
  V: 'UWY',
  W: 'VM',
  Y: 'V',
  Z: '2',
});

/**
 * Fixed, offline observations that cannot be inferred safely from ordinary
 * spelling alone. These are applied only after an exact official alias lookup,
 * so a complete `LSU` still means LSU. Every other team receives generated
 * dropout, adjacent-swap, and OCR-neighbor rules from its bundled aliases.
 */
const TEAM_SPECIFIC_READING_RULES = Object.freeze({
  32: Object.freeze({
    aliases: Object.freeze(['FSU']),
    observations: Object.freeze(['FS', 'LS']),
  }),
  68: Object.freeze({
    aliases: Object.freeze(['UNM', 'NEW MEX', 'NEWMEX']),
    observations: Object.freeze(['NM']),
  }),
});

/**
 * The inherited logo library predates eight programs in College Football 27.
 * Keep them in the offline identity roster even without a bundled logo. The
 * renderer will retain a live logo/color when one exists; name detection does
 * not depend on image licensing or a network lookup.
 */
const CFB27_ROSTER_ADDITIONS = Object.freeze([
  Object.freeze({
    id: 'cfb27-james-madison', name: 'James Madison', aliases: Object.freeze(['JAMES MADISON', 'JMU']),
  }),
  Object.freeze({
    id: 'cfb27-jacksonville-state', name: 'Jacksonville State', aliases: Object.freeze(['JACKSONVILLE STATE', 'JAX STATE', 'JSU']),
  }),
  Object.freeze({
    id: 'cfb27-delaware', name: 'Delaware', aliases: Object.freeze(['DELAWARE']),
  }),
  Object.freeze({
    id: 'cfb27-kennesaw-state', name: 'Kennesaw State', aliases: Object.freeze(['KENNESAW STATE', 'KENNESAW ST']),
  }),
  Object.freeze({
    id: 'cfb27-north-dakota-state', name: 'North Dakota State', aliases: Object.freeze(['NORTH DAKOTA STATE', 'NDSU']),
  }),
  Object.freeze({
    id: 'cfb27-missouri-state', name: 'Missouri State', aliases: Object.freeze(['MISSOURI STATE', 'MISSOURI ST', 'MO STATE']),
  }),
  Object.freeze({
    id: 'cfb27-sacramento-state', name: 'Sacramento State', aliases: Object.freeze(['SACRAMENTO STATE', 'SAC STATE']),
  }),
  Object.freeze({
    id: 'cfb27-sam-houston', name: 'Sam Houston', aliases: Object.freeze(['SAM HOUSTON', 'SAM HOUSTON STATE', 'SHSU']),
  }),
]);

function normalizeTeamName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' AND ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function compactTeamName(value) {
  return normalizeTeamName(value).replace(/\s+/g, '');
}

function charactersAreOcrNeighbors(left, right) {
  if (left === right) return true;
  return Boolean(
    OCR_CHARACTER_NEIGHBORS[left]?.includes(right)
    || OCR_CHARACTER_NEIGHBORS[right]?.includes(left)
  );
}

function readingVariants(value) {
  const compact = compactTeamName(value);
  const variants = new Set();
  if (compact.length < 2) return variants;

  for (let index = 0; index < compact.length; index += 1) {
    const dropped = `${compact.slice(0, index)}${compact.slice(index + 1)}`;
    if (dropped.length >= 2) variants.add(dropped);
    for (const neighbor of OCR_CHARACTER_NEIGHBORS[compact[index]] || '') {
      variants.add(`${compact.slice(0, index)}${neighbor}${compact.slice(index + 1)}`);
    }
  }

  for (let index = 0; index < compact.length - 1; index += 1) {
    if (compact[index] === compact[index + 1]) continue;
    variants.add(
      `${compact.slice(0, index)}${compact[index + 1]}${compact[index]}${compact.slice(index + 2)}`,
    );
  }
  variants.delete(compact);
  return variants;
}

function weightedTeamDistance(observedValue, expectedValue) {
  const observed = compactTeamName(observedValue);
  const expected = compactTeamName(expectedValue);
  if (!observed) return expected.length;
  if (!expected) return observed.length;

  const rows = Array.from(
    { length: observed.length + 1 },
    () => new Array(expected.length + 1).fill(0),
  );
  for (let row = 1; row <= observed.length; row += 1) rows[row][0] = row * 0.9;
  for (let column = 1; column <= expected.length; column += 1) rows[0][column] = column * 0.72;

  for (let row = 1; row <= observed.length; row += 1) {
    for (let column = 1; column <= expected.length; column += 1) {
      const observedCharacter = observed[row - 1];
      const expectedCharacter = expected[column - 1];
      const substitution = observedCharacter === expectedCharacter
        ? 0
        : (charactersAreOcrNeighbors(observedCharacter, expectedCharacter) ? 0.32 : 1);
      rows[row][column] = Math.min(
        rows[row - 1][column] + 0.9,
        rows[row][column - 1] + 0.72,
        rows[row - 1][column - 1] + substitution,
      );
      if (row > 1
        && column > 1
        && observed[row - 1] === expected[column - 2]
        && observed[row - 2] === expected[column - 1]) {
        rows[row][column] = Math.min(rows[row][column], rows[row - 2][column - 2] + 0.46);
      }
    }
  }
  return rows[observed.length][expected.length];
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function preferredTeamLogo(asset, liveSource = null) {
  const bundled = typeof asset?.logo === 'string' ? asset.logo.trim() : '';
  if (bundled) return bundled;
  const live = typeof liveSource === 'string' ? liveSource.trim() : '';
  return live || null;
}

function preferredTeamColor(asset, liveSource = null) {
  if (isHexColor(asset?.primary)) return asset.primary.toLowerCase();
  return isHexColor(liveSource) ? liveSource.toLowerCase() : null;
}

function isSingleEditApart(left, right) {
  if (left === right || Math.abs(left.length - right.length) > 1) return false;

  if (left.length === right.length) {
    let differences = 0;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) differences += 1;
      if (differences > 1) return false;
    }
    return differences === 1;
  }

  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let shortIndex = 0;
  let longIndex = 0;
  let differences = 0;

  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
      continue;
    }
    differences += 1;
    longIndex += 1;
    if (differences > 1) return false;
  }

  return true;
}

function aliasContainsNearFragment(alias, fragment) {
  if (!alias || !fragment || alias.length < fragment.length) return false;
  if (alias.includes(fragment)) return true;
  for (let start = 0; start <= alias.length - fragment.length; start += 1) {
    const window = alias.slice(start, start + fragment.length);
    let differences = 0;
    let safe = true;
    for (let index = 0; index < fragment.length; index += 1) {
      if (window[index] === fragment[index]) continue;
      differences += 1;
      const pair = [window[index], fragment[index]].sort().join('');
      if (differences > 1 || !OCR_FRAGMENT_SUBSTITUTIONS.has(pair)) {
        safe = false;
        break;
      }
    }
    if (safe && differences === 1) return true;
  }
  return false;
}

class TeamAssetResolver {
  constructor(manifest, assetRoot, nicknameCatalog = null) {
    if (!manifest || manifest.schema !== 'cfb27-team-assets/1') {
      throw new Error('Unsupported CFB27 team-asset manifest');
    }
    if (nicknameCatalog && nicknameCatalog.schema !== 'cfb27-team-nicknames/1') {
      throw new Error('Unsupported CFB27 team-nickname catalog');
    }
    this.manifest = manifest;
    this.assetRoot = assetRoot;
    this.nicknameById = new Map((nicknameCatalog?.teams || []).map((team) => [
      String(team.id),
      String(team.nickname || '').trim(),
    ]));
    const rosterTeams = [...(manifest.teams || [])].map((team) => ({
      ...team,
      nickname: this.nicknameById.get(String(team.id)) || String(team.nickname || '').trim() || null,
    }));
    const existingNames = new Set(rosterTeams.map((team) => normalizeTeamName(team.name)));
    for (const team of CFB27_ROSTER_ADDITIONS) {
      if (existingNames.has(normalizeTeamName(team.name))) continue;
      rosterTeams.push({
        ...team,
        nickname: this.nicknameById.get(String(team.id)) || String(team.nickname || '').trim() || null,
        file: null,
        primary: null,
        secondary: null,
        width: null,
        height: null,
        source: 'ea-cfb27-roster-detection-only',
      });
    }
    this.byId = new Map(rosterTeams.map((team) => [String(team.id), team]));
    this.aliasLookup = new Map(
      Object.entries(manifest.aliases || {}).map(([alias, id]) => [normalizeTeamName(alias), String(id)]),
    );
    for (const team of CFB27_ROSTER_ADDITIONS) {
      for (const alias of team.aliases) {
        const key = normalizeTeamName(alias);
        if (!this.aliasLookup.has(key)) this.aliasLookup.set(key, String(team.id));
      }
    }
    this.prefixAliases = [...this.aliasLookup.entries()]
      .map(([alias, id]) => ({
        compactAlias: compactTeamName(alias),
        id: String(id),
      }))
      .filter((entry) => entry.compactAlias && this.byId.has(entry.id));
    this.teamMatchProfiles = new Map();
    for (const team of this.byId.values()) {
      const id = String(team.id);
      const aliases = new Set([
        team.name,
        ...(Array.isArray(team.aliases) ? team.aliases : []),
      ].map(compactTeamName).filter(Boolean));
      for (const entry of this.prefixAliases) {
        if (entry.id === id) aliases.add(entry.compactAlias);
      }
      for (const alias of TEAM_SPECIFIC_READING_RULES[id]?.aliases || []) {
        aliases.add(compactTeamName(alias));
      }
      this.teamMatchProfiles.set(id, {
        id,
        name: String(team.name || '').trim() || id,
        aliases: [...aliases],
      });
    }
    this.explicitReadingRules = new Map();
    for (const [id, rule] of Object.entries(TEAM_SPECIFIC_READING_RULES)) {
      if (!this.byId.has(String(id))) continue;
      for (const observation of [...(rule.aliases || []), ...(rule.observations || [])]) {
        const compact = compactTeamName(observation);
        if (compact) this.explicitReadingRules.set(compact, String(id));
      }
    }
    this.adjacencyRules = new Map();
    for (const profile of this.teamMatchProfiles.values()) {
      for (const alias of profile.aliases) {
        for (const variant of readingVariants(alias)) {
          if (!this.adjacencyRules.has(variant)) this.adjacencyRules.set(variant, new Set());
          this.adjacencyRules.get(variant).add(profile.id);
        }
      }
    }
    this.dataUrlCache = new Map();
    this.assetCache = new Map();
    this.customTeamIds = new Set();
    this.customAliasKeys = new Set();
  }

  // User-defined teams layered over the bundled roster. Only exact-name
  // (and abbreviation) matching is registered for them - the fuzzy OCR
  // structures built above stay untouched so custom names can never pull a
  // misread bundled team toward themselves. Calling again replaces the
  // previous custom set.
  setCustomTeams(teams = [], logoRoot = null) {
    for (const id of this.customTeamIds) {
      this.byId.delete(id);
      this.assetCache.delete(id);
    }
    for (const key of this.customAliasKeys) this.aliasLookup.delete(key);
    this.customTeamIds = new Set();
    this.customAliasKeys = new Set();
    for (const team of Array.isArray(teams) ? teams : []) {
      const id = String(team?.id || '').trim();
      const name = String(team?.name || '').trim();
      if (!id || !name || this.byId.has(id)) continue;
      const logoPath = team.logoFile && logoRoot && !/[\/]/.test(team.logoFile)
        ? path.join(logoRoot, team.logoFile)
        : null;
      this.byId.set(id, {
        id,
        name,
        nickname: String(team.nickname || '').trim() || null,
        abbreviation: String(team.abbreviation || '').trim() || null,
        primary: team.primary || null,
        secondary: team.secondary || null,
        file: null,
        customLogoPath: logoPath,
        width: Number(team.logoWidth) || null,
        height: Number(team.logoHeight) || null,
        source: 'custom',
      });
      this.customTeamIds.add(id);
      for (const alias of [name, team.abbreviation]) {
        const key = normalizeTeamName(alias);
        if (!key || this.aliasLookup.has(key)) continue;
        this.aliasLookup.set(key, id);
        this.customAliasKeys.add(key);
      }
    }
  }

  isCustomTeam(id) {
    return this.customTeamIds.has(String(id));
  }

  static fromAppRoot(appRoot) {
    const assetRoot = path.join(appRoot, 'assets', 'team-logos');
    const manifestPath = path.join(assetRoot, 'manifest.json');
    const nicknamePath = path.join(appRoot, 'assets', 'team-nicknames.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const nicknameCatalog = fs.existsSync(nicknamePath)
      ? JSON.parse(fs.readFileSync(nicknamePath, 'utf8'))
      : null;
    const resolver = new TeamAssetResolver(manifest, assetRoot, nicknameCatalog);
    if (nicknameCatalog) {
      const missing = [...resolver.byId.values()].filter((team) => !String(team.nickname || '').trim());
      if (missing.length) {
        throw new Error(`The team-nickname catalog is missing ${missing.map((team) => team.name).join(', ')}`);
      }
    }
    return resolver;
  }

  resolve(name) {
    const key = normalizeTeamName(name);
    if (!key) return null;
    const id = this.aliasLookup.get(key);
    return id === undefined ? null : this.resolveTeamId(id);
  }

  resolveTeamId(id) {
    const team = this.byId.get(String(id));
    if (!team) return null;
    const teamId = String(team.id);
    if (this.assetCache.has(teamId)) return this.assetCache.get(teamId);
    const asset = Object.freeze({
      id: String(team.id),
      assetId: team.assetId ?? null,
      name: team.name,
      nickname: String(team.nickname || '').trim() || null,
      primary: isHexColor(team.primary) ? team.primary.toLowerCase() : null,
      secondary: isHexColor(team.secondary) ? team.secondary.toLowerCase() : null,
      logo: team.customLogoPath ? this.customLogoDataUrl(team.customLogoPath) : this.logoDataUrl(team.file),
      width: Number(team.width) || null,
      height: Number(team.height) || null,
      preCropped: team.preCropped === true,
      source: team.source || 'bundled',
      abbreviation: team.abbreviation || null,
    });
    this.assetCache.set(teamId, asset);
    return asset;
  }

  diagnosePrefix(name) {
    const prefix = normalizeTeamName(name);
    const compactPrefix = compactTeamName(prefix);
    const byTeam = new Map();
    if (compactPrefix) {
      for (const entry of this.prefixAliases) {
        if (!entry.compactAlias.startsWith(compactPrefix)) continue;
        const team = this.byId.get(entry.id);
        if (!team) continue;
        byTeam.set(entry.id, {
          id: entry.id,
          name: String(team.name || '').trim() || entry.id,
        });
      }
    }
    const candidates = [...byTeam.values()]
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      prefix,
      compactPrefix,
      candidateCount: candidates.length,
      candidates,
      unique: candidates.length === 1,
      ready: candidates.length === 1
        && compactPrefix.length >= MINIMUM_UNIQUE_PREFIX_CHARACTERS,
    };
  }

  resolveUniquePrefix(name) {
    const diagnosis = this.diagnosePrefix(name);
    if (!diagnosis.ready) return null;
    return this.resolveTeamId(diagnosis.candidates[0].id);
  }

  resolveTeamReadingRule(name) {
    const id = this.explicitReadingRules.get(compactTeamName(name));
    return id === undefined ? null : this.resolveTeamId(id);
  }

  diagnoseClosest(name) {
    const observed = compactTeamName(name);
    const candidates = [];
    const containedByTeams = new Set();
    if (observed.length >= MINIMUM_CLOSEST_MATCH_CHARACTERS) {
      for (const profile of this.teamMatchProfiles.values()) {
        let best = null;
        for (const alias of profile.aliases) {
          if (alias.includes(observed)) containedByTeams.add(profile.id);
          const cost = weightedTeamDistance(observed, alias);
          const score = cost / Math.max(observed.length, alias.length);
          if (!best || score < best.score || (score === best.score && cost < best.cost)) {
            best = { alias, cost, score };
          }
        }
        if (best) candidates.push({
          id: profile.id,
          name: profile.name,
          alias: best.alias,
          cost: best.cost,
          score: best.score,
        });
      }
    }
    candidates.sort((left, right) => (
      left.score - right.score
      || left.cost - right.cost
      || left.name.localeCompare(right.name)
    ));
    const best = candidates[0] || null;
    const second = candidates[1] || null;
    const margin = best && second ? second.score - best.score : 1;
    const ambiguousContainedFragment = containedByTeams.size > 1;
    const ready = Boolean(
      best
      && !ambiguousContainedFragment
      && best.score <= MAXIMUM_CLOSEST_MATCH_SCORE
      && (second === null
        || second.score > MAXIMUM_CLOSEST_MATCH_SCORE
        || margin >= MINIMUM_CLOSEST_MATCH_MARGIN)
    );
    return {
      observed,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 8),
      best,
      second,
      margin,
      ambiguousContainedFragment,
      unique: ready,
      ready,
    };
  }

  resolveClosest(name) {
    const diagnosis = this.diagnoseClosest(name);
    return diagnosis.ready ? this.resolveTeamId(diagnosis.best.id) : null;
  }

  diagnoseAdjacencyRule(name) {
    const candidates = this.adjacencyRules.get(compactTeamName(name));
    const ids = candidates ? [...candidates] : [];
    return {
      candidateCount: ids.length,
      candidates: ids.map((id) => ({
        id,
        name: this.byId.get(id)?.name || id,
      })).sort((left, right) => left.name.localeCompare(right.name)),
      unique: ids.length === 1,
      ready: ids.length === 1,
    };
  }

  resolveAdjacencyRule(name) {
    const diagnosis = this.diagnoseAdjacencyRule(name);
    if (!diagnosis.ready) return null;
    return this.resolveTeamId(diagnosis.candidates[0].id);
  }

  /**
   * Recover a clipped middle/end fragment only when it identifies one team.
   * This covers live reads such as `BURGH`, or the one-letter OCR smear `BERG`,
   * when the left half of PITTSBURGH falls outside the readable glyph run.
   */
  diagnoseFragment(name) {
    const fragment = compactTeamName(name);
    const readyShape = fragment.length >= MINIMUM_UNIQUE_FRAGMENT_CHARACTERS
      && new Set(fragment).size >= 3;
    const byTeam = new Map();
    if (readyShape) {
      for (const entry of this.prefixAliases) {
        if (!aliasContainsNearFragment(entry.compactAlias, fragment)) continue;
        const team = this.byId.get(entry.id);
        if (!team) continue;
        byTeam.set(entry.id, {
          id: entry.id,
          name: String(team.name || '').trim() || entry.id,
        });
      }
    }
    const candidates = [...byTeam.values()]
      .sort((left, right) => left.name.localeCompare(right.name));
    return {
      fragment,
      candidateCount: candidates.length,
      candidates,
      unique: candidates.length === 1,
      ready: readyShape && candidates.length === 1,
    };
  }

  resolveUniqueFragment(name) {
    const diagnosis = this.diagnoseFragment(name);
    if (!diagnosis.ready) return null;
    return this.resolveTeamId(diagnosis.candidates[0].id);
  }

  /**
   * Recover a single OCR insertion, deletion, or substitution only when every
   * matching alias belongs to the same team. Short reads are intentionally
   * excluded because one-character matching is too permissive for them.
   */
  resolveSingleEdit(name) {
    const key = compactTeamName(name);
    if (key.length < 5) return null;

    const candidates = new Map();
    for (const { compactAlias: alias, id } of this.prefixAliases) {
      if (!isSingleEditApart(key, alias)) continue;
      const teamId = String(id);
      if (!this.byId.has(teamId)) continue;
      candidates.set(teamId, alias);
      if (candidates.size > 1) return null;
    }

    if (candidates.size !== 1) return null;
    return this.resolveTeamId(candidates.keys().next().value);
  }

  /**
   * Resolve a renderer identity without blindly stripping a trailing number.
   * The live CFB27 name crop can include a clipped digit from the neighboring
   * record cell (for example, "WEST VIRGINIA 1"). The decorated name always
   * gets an exact lookup first. Only when that misses, the suffix is in the
   * observed 1-25 range, and the base is a known bundled alias do we discard
   * the suffix as OCR noise. A rank is accepted only from its independent
   * field; this fallback never invents one.
   */
  resolveIdentity(name, explicitRank = null) {
    const displayName = String(name || '').trim().replace(/\s+/g, ' ');
    const rankNumber = Number(explicitRank);
    const rank = Number.isInteger(rankNumber) && rankNumber >= 1 && rankNumber <= 99
      ? rankNumber
      : null;
    const exact = this.resolve(displayName);
    if (exact) return { name: displayName || null, rank, asset: exact, match: 'exact' };

    const teamRule = this.resolveTeamReadingRule(displayName);
    if (teamRule) {
      return {
        name: teamRule.name,
        rank,
        asset: teamRule,
        match: 'team-rule',
      };
    }

    const match = displayName.match(/^(.+\D)\s+#?(\d{1,2})$/);
    const candidate = match ? Number(match[2]) : null;
    const legalPollRank = Number.isInteger(candidate) && candidate >= 1 && candidate <= 25;
    if (match && legalPollRank) {
      const baseName = match[1].trim();
      const asset = this.resolve(baseName);
      if (asset) {
        return {
          name: baseName,
          rank,
          asset,
          match: 'trailing-artifact',
        };
      }
    }

    const adjacencyDiagnosis = this.diagnoseAdjacencyRule(displayName);
    const adjacency = adjacencyDiagnosis.ready
      ? this.resolveTeamId(adjacencyDiagnosis.candidates[0].id)
      : null;
    if (adjacency) {
      return {
        name: adjacency.name,
        rank,
        asset: adjacency,
        match: 'adjacency-rule',
      };
    }

    // If this exact two/three-character shape is a generated dropout or glyph
    // neighbor for multiple teams, use the full weighted roster ranking rather
    // than a coincidental prefix from a third team. A real score/margin winner
    // can publish; a tie remains unresolved for another live frame.
    if (adjacencyDiagnosis.candidateCount > 1) {
      const closestAmbiguous = this.resolveClosest(displayName);
      if (closestAmbiguous) {
        return {
          name: closestAmbiguous.name,
          rank,
          asset: closestAmbiguous,
          match: 'closest-roster',
        };
      }
      return { name: displayName || null, rank, asset: null, match: null };
    }

    const prefix = this.resolveUniquePrefix(displayName);
    if (prefix) {
      return {
        name: prefix.name,
        rank,
        asset: prefix,
        match: 'unique-prefix',
      };
    }

    const fuzzy = this.resolveSingleEdit(displayName);
    if (fuzzy) {
      return {
        name: fuzzy.name,
        rank,
        asset: fuzzy,
        match: 'fuzzy',
      };
    }

    const fragment = this.resolveUniqueFragment(displayName);
    if (fragment) {
      return {
        name: fragment.name,
        rank,
        asset: fragment,
        match: 'unique-fragment',
      };
    }

    const closest = this.resolveClosest(displayName);
    if (closest) {
      return {
        name: closest.name,
        rank,
        asset: closest,
        match: 'closest-roster',
      };
    }

    return { name: displayName || null, rank, asset: null, match: null };
  }

  // Custom logos live outside the bundled asset root and can be replaced
  // while the app runs, so they are read fresh (not cached) each time the
  // asset is (re)built - the asset cache is dropped whenever they change.
  customLogoDataUrl(fullPath) {
    try {
      if (!fullPath || !fs.existsSync(fullPath)) return null;
      return `data:image/png;base64,${fs.readFileSync(fullPath).toString('base64')}`;
    } catch {
      return null;
    }
  }

  logoDataUrl(file) {
    if (!file || /[\\/]/.test(file)) return null;
    if (this.dataUrlCache.has(file)) return this.dataUrlCache.get(file);
    const fullPath = path.join(this.assetRoot, file);
    if (!fs.existsSync(fullPath)) return null;
    const dataUrl = `data:image/png;base64,${fs.readFileSync(fullPath).toString('base64')}`;
    this.dataUrlCache.set(file, dataUrl);
    return dataUrl;
  }
}

module.exports = {
  CFB27_ROSTER_ADDITIONS,
  compactTeamName,
  MAXIMUM_CLOSEST_MATCH_SCORE,
  MINIMUM_UNIQUE_FRAGMENT_CHARACTERS,
  MINIMUM_UNIQUE_PREFIX_CHARACTERS,
  TEAM_SPECIFIC_READING_RULES,
  TeamAssetResolver,
  normalizeTeamName,
  preferredTeamColor,
  preferredTeamLogo,
  readingVariants,
  weightedTeamDistance,
};
