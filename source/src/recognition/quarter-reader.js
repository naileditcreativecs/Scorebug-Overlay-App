'use strict';

function compactAttempt(read, strategy) {
  return {
    rawText: read?.rawText || '',
    value: read?.value ?? null,
    valid: Boolean(read?.valid),
    confidence: Number(read?.confidence) || 0,
    strategy,
  };
}

/** Retry a rejected small ordinal at a larger raw-line scale. */
async function recognizeQuarter(worker, image) {
  if (!worker || typeof worker.recognize !== 'function') {
    throw new TypeError('Quarter recognition requires an OCR worker');
  }
  const primary = await worker.recognize(image, 'quarter');
  const attempts = [compactAttempt(primary, 'single-word')];
  if (primary?.valid) return { ...primary, strategy: 'single-word', attempts };

  const fallback = await worker.recognize(image, 'quarter', {
    profile: { pageSegmentation: '13', targetHeight: 144 },
  });
  attempts.push(compactAttempt(fallback, 'raw-line-large'));
  const selected = fallback?.valid
    || Number(fallback?.confidence) > Number(primary?.confidence)
    ? fallback
    : primary;
  return {
    ...selected,
    strategy: fallback?.valid ? 'raw-line-large-fallback' : 'single-word',
    attempts,
  };
}

module.exports = { recognizeQuarter };
