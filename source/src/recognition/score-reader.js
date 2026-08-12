'use strict';

// A clear score glyph normally lands well above this value. Recent validation
// logs showed the specific 0 -> 8 failure at 0-8% engine confidence, but the
// generic OCR worker promoted any structurally valid number to 35%. Do not let
// that confidence floor turn an uncertain 0/8 shape into a published score.
// Rejecting the weak pass also lets the existing uniform-block retry recover a
// clean zero without delaying a genuine, high-confidence eight.
const ZERO_EIGHT_ENGINE_CONFIDENCE = 0.5;

function guardAmbiguousScoreEight(read) {
  const digits = String(read?.rawText ?? '').replace(/[^0-9]/g, '');
  const engineConfidence = Number(read?.engineConfidence) || 0;
  if (!read?.valid || !digits.includes('8') || engineConfidence >= ZERO_EIGHT_ENGINE_CONFIDENCE) {
    return read;
  }
  return {
    ...read,
    value: null,
    valid: false,
    confidence: engineConfidence,
    ambiguity: 'zero-or-eight',
    rejectedValue: read.value,
  };
}

function compactAttempt(read, strategy) {
  return {
    rawText: read?.rawText || '',
    value: read?.value ?? null,
    valid: Boolean(read?.valid),
    confidence: Number(read?.confidence) || 0,
    engineConfidence: Number(read?.engineConfidence) || 0,
    ambiguity: read?.ambiguity || null,
    rejectedValue: read?.rejectedValue ?? null,
    strategy,
  };
}

/** Retry a rejected block-font score with uniform-block segmentation. */
async function recognizeScore(worker, image) {
  if (!worker || typeof worker.recognize !== 'function') {
    throw new TypeError('Score recognition requires an OCR worker');
  }
  const primary = guardAmbiguousScoreEight(await worker.recognize(image, 'score'));
  const attempts = [compactAttempt(primary, 'single-word')];
  if (primary?.valid) return { ...primary, strategy: 'single-word', attempts };

  const fallback = guardAmbiguousScoreEight(await worker.recognize(image, 'score', {
    profile: { pageSegmentation: '6' },
  }));
  attempts.push(compactAttempt(fallback, 'uniform-block'));
  const selected = fallback?.valid
    || Number(fallback?.confidence) > Number(primary?.confidence)
    ? fallback
    : primary;
  return {
    ...selected,
    strategy: fallback?.valid ? 'uniform-block-fallback' : 'single-word',
    attempts,
  };
}

module.exports = {
  ZERO_EIGHT_ENGINE_CONFIDENCE,
  guardAmbiguousScoreEight,
  recognizeScore,
};
