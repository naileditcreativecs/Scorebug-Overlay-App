'use strict';

/** Screen capture is opt-in to the automatic local reader only. */
function screenCaptureEnabled(settings = {}) {
  if (settings.dataExtraction?.scoreboardSource === 'ram') return false;
  return settings.capture?.enabled !== false
    && settings.recognition?.mode === 'local-ocr';
}

module.exports = { screenCaptureEnabled };
