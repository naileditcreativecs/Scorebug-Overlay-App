'use strict';

// User-defined teams (TeamBuilder schools, rivals not in the bundled roster,
// or a school whose art the user wants to replace outright). A custom team
// behaves exactly like a bundled one downstream: it can be picked as an
// override, it carries its own colors and logo, and if the reader ever
// publishes its exact name the app matches it automatically.

const CUSTOM_TEAM_ID = /^ct-[a-z0-9]{8,32}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_CUSTOM_TEAMS = 100;
const MAX_NAME_LENGTH = 40;
const MAX_ABBREVIATION_LENGTH = 6;

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanColor(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return HEX_COLOR.test(text) ? text : null;
}

function normalizeCustomTeam(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = String(entry.id || '').trim();
  const name = cleanText(entry.name, MAX_NAME_LENGTH);
  if (!CUSTOM_TEAM_ID.test(id) || !name) return null;
  return {
    id,
    name,
    nickname: cleanText(entry.nickname, MAX_NAME_LENGTH) || null,
    abbreviation: cleanText(entry.abbreviation, MAX_ABBREVIATION_LENGTH).toUpperCase() || null,
    primary: cleanColor(entry.primary),
    secondary: cleanColor(entry.secondary),
    logoFile: /^[a-z0-9-]+\.png$/i.test(String(entry.logoFile || '')) ? String(entry.logoFile) : null,
    logoWidth: Number.isInteger(Number(entry.logoWidth)) && Number(entry.logoWidth) > 0 ? Number(entry.logoWidth) : null,
    logoHeight: Number.isInteger(Number(entry.logoHeight)) && Number(entry.logoHeight) > 0 ? Number(entry.logoHeight) : null,
  };
}

// Settings-file shape: an array, deduplicated by id, malformed rows dropped.
function normalizeCustomTeams(list) {
  const seen = new Set();
  const teams = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const team = normalizeCustomTeam(entry);
    if (!team || seen.has(team.id)) continue;
    seen.add(team.id);
    teams.push(team);
    if (teams.length >= MAX_CUSTOM_TEAMS) break;
  }
  return teams;
}

// Validates a payload from the editor. Throws a plain-English error the UI
// shows verbatim. `makeId` mints an id for a brand new team.
function upsertCustomTeam(list, payload = {}, { makeId } = {}) {
  const teams = normalizeCustomTeams(list);
  const name = cleanText(payload.name, MAX_NAME_LENGTH);
  if (!name) throw new Error('Give the custom team a name.');
  const requestedId = String(payload.id || '').trim();
  const existing = requestedId ? teams.find((team) => team.id === requestedId) : null;
  if (requestedId && !existing) throw new Error('That custom team no longer exists.');
  const duplicate = teams.find((team) => team.name.toLowerCase() === name.toLowerCase() && team !== existing);
  if (duplicate) throw new Error(`You already have a custom team named ${duplicate.name}.`);
  if (!existing && teams.length >= MAX_CUSTOM_TEAMS) {
    throw new Error(`Up to ${MAX_CUSTOM_TEAMS} custom teams are supported.`);
  }
  for (const key of ['primary', 'secondary']) {
    const raw = payload[key];
    if (raw !== null && raw !== undefined && String(raw).trim() !== '' && !cleanColor(raw)) {
      throw new Error(`The ${key} color must look like #1a2b3c.`);
    }
  }
  const id = existing ? existing.id : `ct-${String(makeId ? makeId() : '').toLowerCase()}`;
  if (!CUSTOM_TEAM_ID.test(id)) throw new Error('Could not create an id for the custom team.');
  const team = normalizeCustomTeam({
    id,
    name,
    nickname: Object.hasOwn(payload, 'nickname') ? payload.nickname : existing?.nickname,
    abbreviation: Object.hasOwn(payload, 'abbreviation') ? payload.abbreviation : existing?.abbreviation,
    primary: Object.hasOwn(payload, 'primary') ? payload.primary : existing?.primary,
    secondary: Object.hasOwn(payload, 'secondary') ? payload.secondary : existing?.secondary,
    logoFile: Object.hasOwn(payload, 'logoFile') ? payload.logoFile : existing?.logoFile,
    logoWidth: Object.hasOwn(payload, 'logoWidth') ? payload.logoWidth : existing?.logoWidth,
    logoHeight: Object.hasOwn(payload, 'logoHeight') ? payload.logoHeight : existing?.logoHeight,
  });
  const next = existing
    ? teams.map((entry) => (entry.id === existing.id ? team : entry))
    : [...teams, team];
  return { teams: next, team };
}

function removeCustomTeam(list, id) {
  const teams = normalizeCustomTeams(list);
  const target = String(id || '').trim();
  const removed = teams.find((team) => team.id === target) || null;
  return { teams: teams.filter((team) => team.id !== target), removed };
}

function isCustomTeamId(id) {
  return CUSTOM_TEAM_ID.test(String(id || ''));
}

module.exports = {
  CUSTOM_TEAM_ID,
  MAX_CUSTOM_TEAMS,
  isCustomTeamId,
  normalizeCustomTeams,
  removeCustomTeam,
  upsertCustomTeam,
};
