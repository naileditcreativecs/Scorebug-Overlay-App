'use strict';

const DEFAULT_RANK_SIGHTING_WINDOW_MS = 5 * 60_000;

// Poll ranks do not change during a game, but OCR can lose the narrow leading
// digit from one frame to the next. Remember repeated, recent sightings per
// bundled team, while expiring and resetting the evidence between games.
class TeamRankMemory {
  constructor(options = {}) {
    this.minimumSightings = Math.max(1, Number(options.minimumSightings) || 2);
    this.windowMs = Math.max(1_000, Number(options.windowMs) || DEFAULT_RANK_SIGHTING_WINDOW_MS);
    this.sightings = new Map();
  }

  remember(teamId, rank, at = Date.now()) {
    const id = String(teamId || '');
    const value = Number(rank);
    const timestamp = Number(at) || Date.now();
    if (!id || !Number.isInteger(value) || value < 1 || value > 25) return;
    const perTeam = this.sightings.get(id) || new Map();
    const times = perTeam.get(value) || [];
    times.push(timestamp);
    perTeam.set(value, times);
    this.sightings.set(id, perTeam);
    this.prune(perTeam, timestamp);
  }

  prune(perTeam, at) {
    for (const [rank, times] of perTeam) {
      const fresh = times.filter((time) => at - time <= this.windowMs);
      if (fresh.length) perTeam.set(rank, fresh);
      else perTeam.delete(rank);
    }
  }

  establishedRank(teamId, at = Date.now()) {
    const perTeam = this.sightings.get(String(teamId || ''));
    if (!perTeam) return null;
    this.prune(perTeam, Number(at) || Date.now());
    const countFor = (rank) => (perTeam.get(rank) || []).length;
    let best = null;
    for (const rank of perTeam.keys()) {
      if (countFor(rank + 10) >= 1) continue;
      const total = countFor(rank) + (rank > 10 ? countFor(rank - 10) : 0);
      if (total < this.minimumSightings) continue;
      if (!best || total > best.total) best = { rank, total };
    }
    return best ? best.rank : null;
  }

  reset() {
    this.sightings.clear();
  }
}

module.exports = { DEFAULT_RANK_SIGHTING_WINDOW_MS, TeamRankMemory };
