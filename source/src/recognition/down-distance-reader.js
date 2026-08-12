'use strict';

const { PNG } = require('pngjs');
const { cleanRawText, normalizeInchesToken } = require('./ocr-worker');

const INCHES_EXTENT_START = 0.80;
const INCHES_EXTENT_MIN_COMPONENTS = 2;
const INCHES_EXTENT_MIN_COLUMNS = 8;
const INCHES_EXTENT_MIN_PIXELS = 16;

const DOWN_RECTANGLE = Object.freeze({
  // Keep this crop on the leading numeral only. The former 0.285 width also
  // included the tiny ordinal suffix, so digit-only OCR turned 2ND/3RD/4TH
  // into repeatable `214`, `21`/`31`, and `41` collisions. A 0.15 crop reads
  // both saved 1st- and 3rd-down rows correctly and avoids those suffixes.
  units: 'normalized', x: 0, y: 0, width: 0.15, height: 1,
});
const LEGACY_DOWN_RECTANGLE = Object.freeze({
  // Compatibility pass for the exact, already-proven artifact signatures.
  // It is used only when the narrow digit crop cannot produce a legal down.
  units: 'normalized', x: 0, y: 0, width: 0.285, height: 1,
});
const DISTANCE_RECTANGLE = Object.freeze({
  units: 'normalized', x: 0.30, y: 0, width: 0.40, height: 1,
});

function compactAttempt(read) {
  if (!read) return null;
  return {
    rawText: read.rawText ?? '',
    value: read.value ?? null,
    valid: Boolean(read.valid),
    confidence: Number(read.confidence) || 0,
    engineConfidence: Number(read.engineConfidence) || 0,
    elapsedMs: Number(read.elapsedMs) || 0,
  };
}

function goalHint(rawText) {
  return /(?:&|-)\s*G(?:OAL)?\b/i.test(String(rawText || ''));
}

/**
 * A lone trailing G is useful recovery evidence, but it is not conclusive:
 * at native scorebug size, `10` can collapse into the same glyph. A complete
 * GOAL token remains conclusive and does not need another OCR pass.
 */
function abbreviatedGoalHint(rawText) {
  const line = cleanRawText(rawText)
    .toUpperCase()
    .replace(/\bAND\b/g, '&')
    .replace(/[^A-Z0-9&-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = /(?:^|[\s&-])(G(?:OAL)?)$/.exec(line);
  return Boolean(match && match[1] === 'G');
}

/**
 * Require two literal digits from the isolated distance crop before it may
 * overturn an abbreviated Goal read. This recovers the common G/10 collision
 * while preventing a real G from becoming a one-digit distance such as 6.
 */
function strongNumericGoalConflict(read) {
  if (!read?.valid) return null;
  const raw = cleanRawText(read.rawText).replace(/\s+/g, '');
  if (!/^\d{2}$/.test(raw)) return null;
  const value = Number(read.value);
  return Number.isInteger(value) && value >= 10 && value <= 99 && value === Number(raw)
    ? String(value)
    : null;
}

function inchesHint(rawText) {
  const line = cleanRawText(rawText)
    .toUpperCase()
    .replace(/\bAND\b/g, '&')
    .replace(/[^A-Z0-9&-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!line || /COLLEGE/.test(line)) return false;

  // A missing ordinal is recoverable by the split pass when the delimiter and
  // an INCH-like token survive (for example, "& INCHE"). Without a delimiter,
  // require a legal or recognizably truncated ordinal before the hint.
  const delimited = /(?:^|\s)[&-]\s*([A-Z0-9]+)$/.exec(line);
  if (delimited && normalizeInchesToken(delimited[1])) return true;
  const structured = /^(?:1(?:ST?|S)?|2(?:ND?|N)?|3(?:RD?|R)?|4(?:TH?|T)?)\s+([A-Z0-9]+)$/.exec(line);
  return Boolean(structured && normalizeInchesToken(structured[1]));
}

function downHint(rawText) {
  const line = cleanRawText(rawText).toUpperCase();
  const match = /^(1(?:ST?|S)?|2(?:ND?|N)?|3(?:RD?|R)?|4(?:TH?|T)?)(?=\s|&|-)/.exec(line);
  return match ? Number(match[1][0]) : null;
}

function compactLiveText(rawText) {
  return cleanRawText(rawText)
    .toUpperCase()
    .replace(/\s*&\s*/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Recover only a numeric distance that survives after a scoreboard delimiter.
 *
 * The leading part is deliberately restricted to an empty prefix, a legal
 * (possibly truncated) ordinal, or the repeatable `A`/`A3` third-down OCR
 * residue. The distance is never accepted by itself: recognizeDownDistance
 * also requires an independent legal result from the narrow leading-digit
 * crop. This rejects menu text such as SCORE/COLLEGE while recovering the
 * July 20 live rows `&1`, `A&19`, and `&23` without another OCR pass.
 */
function numericDistanceSuffix(rawText) {
  const line = compactLiveText(rawText);
  if (!line || /COLLEGE|KICK\s*-?\s*OFF|KICKOFF|PAT|EXTRA POINT/.test(line)) return null;
  // The full-line pass can retain only the ordinal suffix (`N &10` for 2ND)
  // while the isolated leading crop still supplies the legal down digit.
  // Accept only short ordinal residues here; the caller still requires that
  // independent 1-4 read before it can publish the fused result.
  const match = /^(?:(?:[1-4](?:ST?|ND?|RD?|TH?)?|A[1-4]?|ST?|ND?|RD?|TH?|H)?)&(\d{1,2})$/.exec(line);
  if (!match) return null;
  const distance = Number(match[1]);
  return Number.isInteger(distance) && distance >= 1 && distance <= 99
    ? String(distance)
    : null;
}

function legalDownFromRead(read) {
  const value = Number(read?.value);
  return read?.valid && Number.isInteger(value) && value >= 1 && value <= 4
    ? value
    : null;
}

function normalizedLineDown(value) {
  const match = /^([1-4])(?:st|nd|rd|th)\s*&/i.exec(String(value || ''));
  return match ? Number(match[1]) : null;
}

function luminance(data, offset) {
  return (0.2126 * data[offset]) + (0.7152 * data[offset + 1]) + (0.0722 * data[offset + 2]);
}

/**
 * Detect the long rendered distance word from the original, untrimmed row.
 *
 * The calibrated 212px native row puts every saved numeric distance at or
 * before x=129. A labeled 3rd & Inches frame reaches x=208. Requiring two
 * substantial glyph components past x=170 (80%) leaves a wide safety gap for
 * 1-99 and Goal while ignoring borders, specks, and dark menu panels.
 */
function inchesExtentHint(input, rawText) {
  const empty = {
    matched: false,
    width: 0,
    height: 0,
    cutoffX: null,
    rightmostInkX: null,
    rightComponents: 0,
    rightColumns: 0,
    rightPixels: 0,
  };
  const line = compactLiveText(rawText);
  if (!/[&-]/.test(line) || /COLLEGE|KICK\s*-?\s*OFF|KICKOFF|PAT|EXTRA POINT|GOAL/.test(line)) {
    return empty;
  }

  let decoded;
  try {
    const buffer = Buffer.isBuffer(input)
      ? input
      : (input instanceof Uint8Array
        ? Buffer.from(input.buffer, input.byteOffset, input.byteLength)
        : null);
    if (!buffer) return empty;
    decoded = PNG.sync.read(buffer, { skipRescale: false });
  } catch {
    return empty;
  }
  const { width, height, data } = decoded;
  if (width < 80 || height < 16) return { ...empty, width, height };

  const top = Math.max(2, Math.floor(height * 0.10));
  const bottom = Math.min(height - 2, Math.ceil(height * 0.90));
  const samples = [];
  for (let y = top; y < bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      if (data[offset + 3] < 128) continue;
      samples.push(luminance(data, offset));
    }
  }
  if (!samples.length) return { ...empty, width, height };
  samples.sort((a, b) => a - b);
  const background = samples[Math.floor((samples.length - 1) * 0.75)];
  if (background < 190) return { ...empty, width, height };
  const brightFloor = background - 24;
  const brightRatio = samples.filter((value) => value >= brightFloor).length / samples.length;
  if (brightRatio < 0.55) return { ...empty, width, height };

  const darkThreshold = Math.min(192, background - 45);
  const mask = new Uint8Array(width * height);
  for (let y = top; y < bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      if (data[offset + 3] >= 128 && luminance(data, offset) <= darkThreshold) {
        mask[(y * width) + x] = 1;
      }
    }
  }

  const visited = new Uint8Array(mask.length);
  const components = [];
  for (let y = top; y < bottom; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = (y * width) + x;
      if (!mask[start] || visited[start]) continue;
      const queue = [start];
      visited[start] = 1;
      let cursor = 0;
      let area = 0;
      let left = x;
      let right = x;
      let componentTop = y;
      let componentBottom = y;
      while (cursor < queue.length) {
        const index = queue[cursor++];
        const cy = Math.floor(index / width);
        const cx = index - (cy * width);
        area += 1;
        left = Math.min(left, cx);
        right = Math.max(right, cx);
        componentTop = Math.min(componentTop, cy);
        componentBottom = Math.max(componentBottom, cy);
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (!ox && !oy) continue;
            const nx = cx + ox;
            const ny = cy + oy;
            if (nx < 0 || nx >= width || ny < top || ny >= bottom) continue;
            const next = (ny * width) + nx;
            if (!mask[next] || visited[next]) continue;
            visited[next] = 1;
            queue.push(next);
          }
        }
      }
      const componentWidth = right - left + 1;
      const componentHeight = componentBottom - componentTop + 1;
      if (area >= 8 && componentWidth >= 2 && componentHeight >= 4) {
        components.push({ area, left, right, width: componentWidth, height: componentHeight });
      }
    }
  }

  const cutoffX = Math.ceil(width * INCHES_EXTENT_START);
  const rightward = components.filter((component) => component.right >= cutoffX);
  const columns = new Set();
  let rightPixels = 0;
  let rightmostInkX = null;
  for (let y = top; y < bottom; y += 1) {
    for (let x = cutoffX; x < width; x += 1) {
      if (!mask[(y * width) + x]) continue;
      columns.add(x);
      rightPixels += 1;
      rightmostInkX = rightmostInkX === null ? x : Math.max(rightmostInkX, x);
    }
  }
  const leftAnchored = components.some((component) => component.left <= Math.floor(width * 0.22));
  const matched = leftAnchored
    && rightward.length >= INCHES_EXTENT_MIN_COMPONENTS
    && columns.size >= INCHES_EXTENT_MIN_COLUMNS
    && rightPixels >= INCHES_EXTENT_MIN_PIXELS;
  return {
    matched,
    width,
    height,
    cutoffX,
    rightmostInkX,
    rightComponents: rightward.length,
    rightColumns: columns.size,
    rightPixels,
  };
}

/**
 * Recover only the three repeatable glyph-collision signatures captured from
 * a real 2nd/3rd/4th-and-Inches sequence. The normal line read has already
 * failed before this runs. Requiring agreement from both split passes avoids
 * rewriting a genuinely readable numeric distance such as 2nd & 3 or 3rd &
 * 83, and COLLEGE/menu text cannot satisfy any signature.
 */
function liveInchesArtifactDown(primaryRead, downRead, distanceRead) {
  const line = compactLiveText(primaryRead?.rawText);
  if (!line || /COLLEGE/.test(line)) return null;
  const downRaw = cleanRawText(downRead?.rawText);
  const distanceRaw = cleanRawText(distanceRead?.rawText);

  if (line === '2N&3' && (downRaw === '2' || downRaw === '214') && distanceRaw === '163') return 2;
  if (line === 'A&3' && downRaw === '3' && (distanceRaw === '83' || distanceRaw === '85')) return 3;
  if (line === '4&N' && downRaw === '4' && !distanceRead?.valid && !distanceRaw) return 4;
  return null;
}

/**
 * Recover the live second-down OCR failure without guessing from gameplay.
 *
 * Two independent signatures are safe enough to use:
 *   - the primary row retains a structured 2/2N/2ND prefix; or
 *   - the primary row retains only "& distance" while the split down crop is
 *     the repeatable `214` collision seen on real second downs.
 *
 * The distance comes from the strict primary suffix because the split crop
 * commonly merges neighboring glyphs (`1633`, `1615`, and so on). `21` is
 * deliberately not accepted because it also occurs on verified third downs.
 */
function liveSecondDownArtifact(primaryRead, downRead) {
  const line = compactLiveText(primaryRead?.rawText);
  if (!line || /COLLEGE|KICK\s*-?\s*OFF|KICKOFF|PAT|EXTRA POINT/.test(line)) return null;

  const structured = /^(?:2(?:ND?|N)?)&(\d{1,2}|G(?:OAL)?)$/.exec(line);
  const orphaned = /^&(\d{1,2}|G(?:OAL)?)$/.exec(line);
  const match = structured || (cleanRawText(downRead?.rawText) === '214' ? orphaned : null);
  if (!match) return null;

  if (/^G/i.test(match[1])) return { down: 2, distance: 'Goal' };
  const numericDistance = Number(match[1]);
  if (!Number.isInteger(numericDistance) || numericDistance < 1 || numericDistance > 99) return null;
  return { down: 2, distance: String(numericDistance) };
}

function ordinal(down) {
  return ['', '1st', '2nd', '3rd', '4th'][down] || null;
}

// A partially recovered 1st & 10 has two strong structural clues: the legal
// first-down digit and the exact ten-yard distance. Put that resolved result
// in the higher confidence bucket so a clipped ordinal is not held back by
// the generic text-line confidence score.
const FIRST_AND_TEN_CONFIDENCE_FLOOR = 0.72;

function downDistanceConfidence(value, confidence) {
  const numeric = Number(confidence) || 0;
  return value === '1st & 10'
    ? Math.max(FIRST_AND_TEN_CONFIDENCE_FLOOR, numeric)
    : numeric;
}

/**
 * The native CFB27 scorebug starts a normal series at 1st & 10. At the small
 * donor size, Tesseract frequently drops only the narrow trailing zero and
 * returns a perfectly structured `1st & 1`. Goal-to-go is rendered as Goal,
 * so publishing that one-glyph collision is substantially less useful than
 * restoring the missing zero. Keep other downs at distance 1 untouched.
 */
function correctFirstAndTenCollision(value) {
  return /^1st\s*&\s*1$/i.test(String(value || '').trim())
    ? '1st & 10'
    : value;
}

/**
 * Read the fixed native down-and-distance row.
 *
 * Tesseract can see the ampersand and distance while dropping the small
 * ordinal glyph (for example, "& 6"). A second pass restricts OCR to digits
 * and reads the down and distance halves independently. This recovers the
 * displayed value without inferring the next down from gameplay.
 */
async function recognizeDownDistance(worker, input) {
  if (!worker || typeof worker.recognize !== 'function') {
    throw new TypeError('A scoreboard OCR worker is required.');
  }

  const primary = await worker.recognize(input, 'downDistance', {
    preprocess: { threshold: 192 },
  });
  // Kickoff/PAT have no ordinal to verify and should remain a one-pass read.
  if (primary.valid && (primary.value === 'Kickoff' || primary.value === 'PAT')) {
    return {
      ...primary,
      strategy: 'line',
      attempts: { primary: compactAttempt(primary) },
    };
  }

  const downRead = await worker.recognize(input, 'score', {
    rectangle: DOWN_RECTANGLE,
    profile: { targetHeight: 120 },
    preprocess: { threshold: 160 },
  });
  const narrowDown = legalDownFromRead(downRead);

  // A valid full-line OCR result is still checked against the isolated first
  // digit. A legal disagreement is stronger evidence of a transient ordinal
  // misread than either pass alone, so publish neither value for that frame.
  if (primary.valid) {
    const lineDown = normalizedLineDown(primary.value);
    const conflict = lineDown !== null && narrowDown !== null && lineDown !== narrowDown;
    const weakGoal = /\s&\sGoal$/i.test(String(primary.value || ''))
      && abbreviatedGoalHint(primary.rawText);
    let goalDistanceRead = null;
    let numericGoalOverride = null;
    if (!conflict && weakGoal) {
      goalDistanceRead = await worker.recognize(input, 'score', {
        rectangle: DISTANCE_RECTANGLE,
        profile: { targetHeight: 120 },
        preprocess: { threshold: 160 },
      });
      numericGoalOverride = strongNumericGoalConflict(goalDistanceRead);
    }
    const uncorrectedValue = numericGoalOverride && lineDown
      ? `${ordinal(lineDown)} & ${numericGoalOverride}`
      : primary.value;
    const value = correctFirstAndTenCollision(uncorrectedValue);
    const firstAndTenCorrected = value !== uncorrectedValue;
    const confidence = numericGoalOverride
      ? Math.min(
        Number(narrowDown !== null ? downRead.confidence : primary.confidence) || 0,
        Number(goalDistanceRead.confidence) || 0,
      )
      : primary.confidence;
    return {
      ...primary,
      value: conflict ? null : value,
      valid: !conflict,
      confidence: conflict
        ? Math.min(Number(primary.confidence) || 0, Number(downRead.confidence) || 0)
        : downDistanceConfidence(value, confidence),
      elapsedMs: (Number(primary.elapsedMs) || 0)
        + (Number(downRead.elapsedMs) || 0)
        + (Number(goalDistanceRead?.elapsedMs) || 0),
      strategy: conflict
        ? 'ordinal-conflict'
        : (numericGoalOverride
          ? 'line-goal-numeric-conflict'
          : (firstAndTenCorrected ? 'line-first-and-ten-collision' : 'line')),
      attempts: {
        primary: compactAttempt(primary),
        down: compactAttempt(downRead),
        distance: compactAttempt(goalDistanceRead),
        abbreviatedGoalHint: weakGoal,
        numericGoalOverride,
        firstAndTenCorrected,
        ordinalConflict: conflict ? { lineDown, splitDown: narrowDown } : null,
      },
    };
  }

  // Retain the former wider crop only as a fallback. It carries useful exact
  // signatures (`214`, `21`, and so on), but must not override a legal result
  // from the cleaner leading-digit crop.
  let legacyDownRead = null;
  let down = narrowDown;
  if (down === null) {
    legacyDownRead = await worker.recognize(input, 'score', {
      rectangle: LEGACY_DOWN_RECTANGLE,
      profile: { targetHeight: 120 },
      preprocess: { threshold: 160 },
    });
    down = legalDownFromRead(legacyDownRead);
  }
  const hasDown = down !== null;
  const artifactDownRead = legacyDownRead || downRead;
  const isGoal = goalHint(primary.rawText);
  const isAbbreviatedGoal = isGoal && abbreviatedGoalHint(primary.rawText);
  const isInches = inchesHint(primary.rawText);
  const hintedDown = downHint(primary.rawText);
  const suffixDistance = numericDistanceSuffix(primary.rawText);
  const secondDownArtifact = hasDown && down !== 2
    ? null
    : liveSecondDownArtifact(primary, artifactDownRead);
  const compactPrimary = compactLiveText(primary.rawText);
  // These two exact numeric-looking rows have proven live Inches artifact
  // signatures. Extent is checked first; if it cannot decide, retain the old
  // distance-pass signature before accepting the numeric suffix.
  const needsInchesArtifactCheck = compactPrimary === '2N&3' || compactPrimary === 'A&3';
  const extentCandidateDown = hasDown
    ? down
    : (hintedDown || secondDownArtifact?.down || null);
  const extent = (!isGoal && !isInches && extentCandidateDown)
    ? inchesExtentHint(input, primary.rawText)
    : { matched: false };
  let resolvedDown = hasDown ? down : ((isGoal || isInches) ? hintedDown : null);
  let distanceRead = null;
  let distance = null;
  let artifactDown = null;
  let extentDown = null;
  let suffixFused = false;
  let numericGoalOverride = null;

  if (isGoal) {
    resolvedDown = resolvedDown || secondDownArtifact?.down || null;
    if (isAbbreviatedGoal) {
      distanceRead = await worker.recognize(input, 'score', {
        rectangle: DISTANCE_RECTANGLE,
        profile: { targetHeight: 120 },
        preprocess: { threshold: 160 },
      });
      numericGoalOverride = strongNumericGoalConflict(distanceRead);
    }
    distance = numericGoalOverride || 'Goal';
  } else if (isInches) {
    distance = 'Inches';
  } else if (extent.matched) {
    extentDown = extentCandidateDown;
    resolvedDown = extentDown;
    distance = 'Inches';
  } else if (secondDownArtifact && !needsInchesArtifactCheck) {
    resolvedDown = secondDownArtifact.down;
    distance = secondDownArtifact.distance;
  } else if (suffixDistance !== null && extentCandidateDown && !needsInchesArtifactCheck) {
    resolvedDown = extentCandidateDown;
    distance = suffixDistance;
    suffixFused = true;
  } else {
    distanceRead = await worker.recognize(input, 'score', {
      rectangle: DISTANCE_RECTANGLE,
      profile: { targetHeight: 120 },
      preprocess: { threshold: 160 },
    });
    const numericDistance = Number(distanceRead?.value);
    artifactDown = liveInchesArtifactDown(primary, artifactDownRead, distanceRead);
    if (artifactDown) {
      resolvedDown = artifactDown;
      distance = 'Inches';
    } else if (secondDownArtifact) {
      resolvedDown = secondDownArtifact.down;
      distance = secondDownArtifact.distance;
    } else if (suffixDistance !== null && extentCandidateDown) {
      resolvedDown = extentCandidateDown;
      distance = suffixDistance;
      suffixFused = true;
    } else if (hasDown && distanceRead?.valid && Number.isInteger(numericDistance)
      && numericDistance >= 1 && numericDistance <= 99) {
      resolvedDown = down;
      distance = String(numericDistance);
    }
  }

  const uncorrectedValue = resolvedDown && distance !== null
    ? `${ordinal(resolvedDown)} & ${distance}`
    : null;
  const value = correctFirstAndTenCollision(uncorrectedValue);
  const firstAndTenCorrected = value !== uncorrectedValue;
  const downEvidence = narrowDown !== null
    ? downRead
    : (legalDownFromRead(legacyDownRead) !== null ? legacyDownRead : null);
  const confidenceParts = [hasDown
    ? (Number(downEvidence?.confidence) || 0)
    : ((hintedDown || artifactDown || extentDown || secondDownArtifact)
      ? Math.max(0.35, Number(primary.engineConfidence) || 0)
      : 0)];
  if (distanceRead && (numericGoalOverride || (!isGoal && !artifactDown && !secondDownArtifact))) {
    confidenceParts.push(Number(distanceRead.confidence) || 0);
  }
  const confidence = downDistanceConfidence(
    value,
    value ? Math.min(...confidenceParts) : Number(primary.confidence) || 0,
  );

  return {
    ...primary,
    value,
    valid: value !== null,
    confidence,
    elapsedMs: (Number(primary.elapsedMs) || 0)
      + (Number(downRead.elapsedMs) || 0)
      + (Number(legacyDownRead?.elapsedMs) || 0)
      + (Number(distanceRead?.elapsedMs) || 0),
    strategy: value
      ? (extentDown
        ? 'split-inches-extent'
        : (artifactDown
          ? 'split-inches-artifact'
          : (numericGoalOverride
            ? 'split-goal-numeric-conflict'
            : (secondDownArtifact
            ? 'split-second-artifact'
            : (suffixFused ? 'split-primary-suffix' : 'split')))))
      : 'failed',
    attempts: {
      primary: compactAttempt(primary),
      down: compactAttempt(downRead),
      legacyDown: compactAttempt(legacyDownRead),
      distance: compactAttempt(distanceRead),
      numericSuffix: suffixDistance,
      goalHint: isGoal,
      abbreviatedGoalHint: isAbbreviatedGoal,
      numericGoalOverride,
      inchesHint: isInches,
      inchesExtentHint: Boolean(extentDown),
      inchesExtent: extent,
      inchesArtifactHint: Boolean(artifactDown),
      secondDownArtifact: secondDownArtifact || null,
      secondDownInchesDisambiguation: needsInchesArtifactCheck,
      downHint: hintedDown,
      firstAndTenCorrected,
    },
  };
}

module.exports = {
  DISTANCE_RECTANGLE,
  DOWN_RECTANGLE,
  FIRST_AND_TEN_CONFIDENCE_FLOOR,
  LEGACY_DOWN_RECTANGLE,
  correctFirstAndTenCollision,
  downDistanceConfidence,
  goalHint,
  inchesHint,
  inchesExtentHint,
  liveInchesArtifactDown,
  liveSecondDownArtifact,
  numericDistanceSuffix,
  downHint,
  recognizeDownDistance,
};
