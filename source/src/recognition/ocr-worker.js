'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

// Page segmentation numbers are stable Tesseract API values. Keeping them here
// lets the lightweight normalization/preprocessing helpers be required without
// starting the relatively expensive WASM worker.
const PAGE_SEGMENTATION = Object.freeze({
  SINGLE_LINE: '7',
  SINGLE_WORD: '8',
  RAW_LINE: '13',
  SPARSE_TEXT: '11',
});

const FIELD_PROFILES = Object.freeze({
  score: Object.freeze({
    whitelist: '0123456789',
    pageSegmentation: PAGE_SEGMENTATION.SINGLE_WORD,
    targetHeight: 96,
    maximumLength: 3,
    minimumValidConfidence: 0.35,
    preprocess: Object.freeze({ threshold: 208 }),
  }),
  playClock: Object.freeze({
    whitelist: '0123456789',
    pageSegmentation: PAGE_SEGMENTATION.SINGLE_WORD,
    targetHeight: 96,
    maximumLength: 2,
    minimumValidConfidence: 0.35,
    preprocess: Object.freeze({ threshold: 96 }),
  }),
  clock: Object.freeze({
    whitelist: '0123456789:',
    pageSegmentation: PAGE_SEGMENTATION.SINGLE_WORD,
    targetHeight: 96,
    maximumLength: 5,
    minimumValidConfidence: 0.35,
  }),
  quarter: Object.freeze({
    whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    pageSegmentation: PAGE_SEGMENTATION.SINGLE_WORD,
    targetHeight: 96,
    maximumLength: 4,
    minimumValidConfidence: 0.35,
  }),
  downDistance: Object.freeze({
    whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ&- ',
    pageSegmentation: PAGE_SEGMENTATION.SINGLE_LINE,
    targetHeight: 84,
    maximumLength: 16,
    minimumValidConfidence: 0.35,
  }),
  teamName: Object.freeze({
    whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ&.\'- ',
    pageSegmentation: PAGE_SEGMENTATION.SINGLE_LINE,
    targetHeight: 84,
    maximumLength: 32,
  }),
  record: Object.freeze({
    whitelist: '0123456789O- ',
    pageSegmentation: PAGE_SEGMENTATION.SINGLE_WORD,
    targetHeight: 96,
    maximumLength: 5,
    minimumValidConfidence: 0.35,
  }),
  screenText: Object.freeze({
    whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz&.\'\"-:/(),+%# ',
    pageSegmentation: PAGE_SEGMENTATION.SPARSE_TEXT,
    targetHeight: 1080,
    maximumLength: 16000,
    minimumValidConfidence: 0.08,
  }),
});

function clampInteger(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function toBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) {
    return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('OCR input must be a PNG Buffer or Uint8Array');
}

function resolveCrop(width, height, rectangle) {
  if (!rectangle) return { left: 0, top: 0, width, height };
  const normalized = rectangle.units === 'normalized'
    || [rectangle.x, rectangle.y, rectangle.width, rectangle.height]
      .filter((value) => value !== undefined)
      .every((value) => Number(value) >= 0 && Number(value) <= 1);
  const multiplierX = normalized ? width : 1;
  const multiplierY = normalized ? height : 1;
  const left = clampInteger((rectangle.left ?? rectangle.x ?? 0) * multiplierX, 0, width - 1);
  const top = clampInteger((rectangle.top ?? rectangle.y ?? 0) * multiplierY, 0, height - 1);
  const requestedWidth = (rectangle.width ?? rectangle.w ?? (normalized ? 1 : width)) * multiplierX;
  const requestedHeight = (rectangle.height ?? rectangle.h ?? (normalized ? 1 : height)) * multiplierY;
  return {
    left,
    top,
    width: clampInteger(requestedWidth, 1, width - left),
    height: clampInteger(requestedHeight, 1, height - top),
  };
}

function percentile(histogram, count, ratio) {
  const target = Math.max(0, Math.min(count - 1, Math.round((count - 1) * ratio)));
  let seen = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value];
    if (seen > target) return value;
  }
  return 255;
}

function otsuThreshold(histogram, count) {
  let total = 0;
  for (let value = 0; value < 256; value += 1) total += value * histogram[value];
  let backgroundWeight = 0;
  let backgroundTotal = 0;
  let bestVariance = -1;
  let threshold = 127;
  for (let value = 0; value < 256; value += 1) {
    backgroundWeight += histogram[value];
    if (!backgroundWeight) continue;
    const foregroundWeight = count - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundTotal += value * histogram[value];
    const backgroundMean = backgroundTotal / backgroundWeight;
    const foregroundMean = (total - backgroundTotal) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * ((backgroundMean - foregroundMean) ** 2);
    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = value;
    }
  }
  return threshold;
}

function nearestScale(binary, width, height, scale) {
  if (scale === 1) return { pixels: binary, width, height };
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  const output = Buffer.alloc(scaledWidth * scaledHeight);
  for (let y = 0; y < scaledHeight; y += 1) {
    const sourceY = Math.floor(y / scale);
    for (let x = 0; x < scaledWidth; x += 1) {
      output[(y * scaledWidth) + x] = binary[(sourceY * width) + Math.floor(x / scale)];
    }
  }
  return { pixels: output, width: scaledWidth, height: scaledHeight };
}

/**
 * Convert a cropped scoreboard PNG to high-contrast black text on white.
 *
 * The game commonly renders white type over a dark panel. Tesseract is more
 * reliable with the polarity reversed, a little padding, and a glyph height of
 * roughly 60-100 pixels. This preprocessing is deliberately deterministic so
 * calibration screenshots produce repeatable results.
 */
function preprocessPng(input, options = {}) {
  const decoded = PNG.sync.read(toBuffer(input), { skipRescale: false });
  if (!decoded.width || !decoded.height) throw new Error('PNG has no pixels');
  const crop = resolveCrop(decoded.width, decoded.height, options.rectangle);
  const count = crop.width * crop.height;
  const gray = Buffer.alloc(count);
  const histogram = new Uint32Array(256);
  let borderTotal = 0;
  let borderCount = 0;

  for (let y = 0; y < crop.height; y += 1) {
    for (let x = 0; x < crop.width; x += 1) {
      const source = (((crop.top + y) * decoded.width) + crop.left + x) * 4;
      const alpha = decoded.data[source + 3] / 255;
      const luminance = Math.round(
        ((0.2126 * decoded.data[source])
          + (0.7152 * decoded.data[source + 1])
          + (0.0722 * decoded.data[source + 2])) * alpha,
      );
      const destination = (y * crop.width) + x;
      gray[destination] = luminance;
      histogram[luminance] += 1;
      if (x === 0 || y === 0 || x === crop.width - 1 || y === crop.height - 1) {
        borderTotal += luminance;
        borderCount += 1;
      }
    }
  }

  const low = percentile(histogram, count, Number(options.lowPercentile ?? 0.01));
  const high = percentile(histogram, count, Number(options.highPercentile ?? 0.99));
  const range = Math.max(1, high - low);
  const normalized = Buffer.alloc(count);
  const normalizedHistogram = new Uint32Array(256);
  for (let index = 0; index < count; index += 1) {
    const value = clampInteger(((gray[index] - low) * 255) / range, 0, 255);
    normalized[index] = value;
    normalizedHistogram[value] += 1;
  }

  const configuredThreshold = options.threshold;
  const threshold = Number.isFinite(Number(configuredThreshold))
    ? clampInteger(configuredThreshold, 0, 255)
    : otsuThreshold(normalizedHistogram, count);
  const originalBorderMean = borderCount ? borderTotal / borderCount : 255;
  const darkBackground = options.invert === true
    || (options.invert !== false && originalBorderMean < ((low + high) / 2));
  const binary = Buffer.alloc(count, 255);
  let inkLeft = crop.width;
  let inkTop = crop.height;
  let inkRight = -1;
  let inkBottom = -1;
  for (let y = 0; y < crop.height; y += 1) {
    for (let x = 0; x < crop.width; x += 1) {
      const index = (y * crop.width) + x;
      const isInk = darkBackground ? normalized[index] > threshold : normalized[index] < threshold;
      if (!isInk) continue;
      binary[index] = 0;
      inkLeft = Math.min(inkLeft, x);
      inkTop = Math.min(inkTop, y);
      inkRight = Math.max(inkRight, x);
      inkBottom = Math.max(inkBottom, y);
    }
  }

  const trim = options.trim !== false && inkRight >= inkLeft;
  const sourceLeft = trim ? inkLeft : 0;
  const sourceTop = trim ? inkTop : 0;
  const sourceWidth = trim ? (inkRight - inkLeft + 1) : crop.width;
  const sourceHeight = trim ? (inkBottom - inkTop + 1) : crop.height;
  const trimmed = Buffer.alloc(sourceWidth * sourceHeight, 255);
  for (let y = 0; y < sourceHeight; y += 1) {
    binary.copy(
      trimmed,
      y * sourceWidth,
      ((sourceTop + y) * crop.width) + sourceLeft,
      ((sourceTop + y) * crop.width) + sourceLeft + sourceWidth,
    );
  }

  const targetHeight = clampInteger(options.targetHeight ?? 84, 24, 256);
  const automaticScale = Math.ceil(targetHeight / Math.max(1, sourceHeight));
  const scale = clampInteger(options.scale ?? automaticScale, 1, options.maxScale ?? 8);
  const scaled = nearestScale(trimmed, sourceWidth, sourceHeight, scale);
  const padding = clampInteger(options.padding ?? Math.max(8, Math.round(scaled.height * 0.14)), 0, 96);
  const output = new PNG({
    width: scaled.width + (padding * 2),
    height: scaled.height + (padding * 2),
    colorType: 6,
  });
  output.data.fill(255);
  for (let y = 0; y < scaled.height; y += 1) {
    for (let x = 0; x < scaled.width; x += 1) {
      const value = scaled.pixels[(y * scaled.width) + x];
      const destination = (((y + padding) * output.width) + x + padding) * 4;
      output.data[destination] = value;
      output.data[destination + 1] = value;
      output.data[destination + 2] = value;
      output.data[destination + 3] = 255;
    }
  }

  return {
    buffer: PNG.sync.write(output, { colorType: 6 }),
    metadata: {
      input: { width: decoded.width, height: decoded.height },
      crop,
      output: { width: output.width, height: output.height },
      contrast: { low, high, threshold, darkBackground },
      scale,
      padding,
      hasInk: inkRight >= inkLeft,
    },
  };
}

function cleanRawText(rawText) {
  return String(rawText ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanScreenText(rawText) {
  return String(rawText ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, FIELD_PROFILES.screenText.maximumLength);
}

function normalizeScore(rawText, maximum = 999) {
  const compact = cleanRawText(rawText).replace(/[^0-9]/g, '');
  if (!compact || compact.length > 3) return null;
  const value = Number(compact);
  return Number.isInteger(value) && value >= 0 && value <= maximum ? value : null;
}

function normalizePlayClock(rawText) {
  const value = normalizeScore(rawText, 99);
  return value === null ? null : value;
}

function normalizeClock(rawText) {
  let compact = cleanRawText(rawText)
    .replace(/[.;,]/g, ':')
    .replace(/[^0-9:]/g, '');
  if (!compact.includes(':') && /^\d{3,4}$/.test(compact)) {
    compact = `${compact.slice(0, -2)}:${compact.slice(-2)}`;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(compact);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (minutes > 15 || seconds > 59) return null;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function normalizeQuarter(rawText) {
  const compact = cleanRawText(rawText).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const aliases = {
    '1': '1st', '1ST': '1st',
    '2': '2nd', '2ND': '2nd',
    '3': '3rd', '3RD': '3rd',
    '4': '4th', '4TH': '4th',
    I: '1st', IST: '1st', '1SI': '1st', '15T': '1st', '1S': '1st', '15': '1st',
    '18': '1st',
    '2N': '2nd', '2NO': '2nd', '2N0': '2nd',
    '3R': '3rd', '3RO': '3rd',
    '4T': '4th', '4TN': '4th', '47H': '4th',
    OT: 'OT', OVERTIME: 'OT', '0T': 'OT',
  };
  if (aliases[compact]) return aliases[compact];
  const overtime = /^(\d{1,2})OT$/.exec(compact);
  if (overtime) return `${Number(overtime[1])}OT`;
  // The leading 1-4 digit is authoritative inside this dedicated quarter crop;
  // reject a second digit so neighboring score/clock bleed cannot invent one.
  const leading = /^([1-4])(?!\d)/.exec(compact);
  return leading ? ordinalForQuarter(Number(leading[1])) : null;
}

function ordinalForQuarter(quarter) {
  return ['', '1st', '2nd', '3rd', '4th'][quarter] || null;
}

function ordinalForDown(down) {
  return ['','1st', '2nd', '3rd', '4th'][down] || null;
}

// Tesseract occasionally drops the final one or two glyphs in INCHES, or
// confuses a high-contrast I/E/H with 1/F/N. Keep this list deliberately
// narrow: these aliases are only accepted as the distance token in an
// otherwise complete, legal down-and-distance line.
const INCHES_OCR_TOKENS = new Set([
  'INC', 'INCH', 'INCHE', 'INCHES', 'INCHS',
  '1NCHES', 'LNCHES', 'INCHFS', 'INCNES',
]);

function normalizeInchesToken(value) {
  const token = cleanRawText(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return INCHES_OCR_TOKENS.has(token) ? 'Inches' : null;
}

function normalizeDownDistance(rawText) {
  let compact = cleanRawText(rawText).toUpperCase();
  if (!compact) return null;
  compact = compact
    .replace(/\bAND\b/g, '&')
    .replace(/[|]/g, '1')
    .replace(/[^A-Z0-9&-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^KICK\s*-?\s*OFF$/.test(compact) || compact === 'KICKOFF') return 'Kickoff';
  if (compact === 'PAT' || compact === 'EXTRA POINT') return 'PAT';
  const match = /^(1(?:ST)?|2(?:ND)?|3(?:RD)?|4(?:TH)?)\s*(?:&|-)?\s*([A-Z0-9]{1,8})$/.exec(compact);
  if (!match) return null;
  const down = Number(match[1][0]);
  let distance = null;
  if (/^G(?:OAL)?$/.test(match[2])) {
    distance = 'Goal';
  } else if (normalizeInchesToken(match[2])) {
    distance = 'Inches';
  } else if (/^\d{1,2}$/.test(match[2])) {
    const numericDistance = Number(match[2]);
    // The native scorebug uses "Inches", not zero, for a sub-yard distance.
    if (numericDistance >= 1) distance = String(numericDistance);
  }
  if (distance === null) return null;
  return `${ordinalForDown(down)} & ${distance}`;
}

function normalizeTeamName(rawText) {
  const value = cleanRawText(rawText)
    .toUpperCase()
    .replace(/[^A-Z0-9&.' -]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return value.length >= 2 && value.length <= 32 ? value : null;
}

function normalizeRecord(rawText) {
  const compact = cleanRawText(rawText)
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[\u2013\u2014_]/g, '-')
    .replace(/\s+/g, '')
    .replace(/[^0-9-]/g, '');
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(compact);
  if (!match) return null;
  const wins = Number(match[1]);
  const losses = Number(match[2]);
  if (wins > 20 || losses > 20) return null;
  return `${wins}-${losses}`;
}

function normalizeScreenText(rawText) {
  const value = cleanScreenText(rawText);
  return value.length >= 2 ? value : null;
}

function normalizeField(fieldType, rawText) {
  switch (fieldType) {
    case 'score': return normalizeScore(rawText);
    case 'playClock': return normalizePlayClock(rawText);
    case 'clock': return normalizeClock(rawText);
    case 'quarter': return normalizeQuarter(rawText);
    case 'downDistance': return normalizeDownDistance(rawText);
    case 'teamName': return normalizeTeamName(rawText);
    case 'record': return normalizeRecord(rawText);
    case 'screenText': return normalizeScreenText(rawText);
    default: throw new Error(`Unknown OCR field type: ${fieldType}`);
  }
}

function resolvePhysicalAsarPath(candidatePath) {
  const value = String(candidatePath || '');
  return value.replace(/([\\/])app\.asar([\\/])/i, '$1app.asar.unpacked$2');
}

function requirePhysicalAsset(modulePath, description) {
  let resolved;
  try {
    resolved = require.resolve(modulePath);
  } catch (error) {
    throw new Error(`${description} is not installed: ${error.message}`);
  }
  const physicalPath = resolvePhysicalAsarPath(resolved);
  if (!fs.existsSync(physicalPath)) {
    throw new Error(`${description} is missing: ${physicalPath}`);
  }
  return physicalPath;
}

function getBundledOcrWorkerOptions() {
  const workerPath = requirePhysicalAsset(
    'tesseract.js/src/worker-script/node/index.js',
    'Bundled OCR worker',
  );
  const coreEntryPath = requirePhysicalAsset('tesseract.js-core', 'Bundled OCR engine');
  return {
    workerPath,
    corePath: path.dirname(coreEntryPath),
  };
}

function getBundledLanguageData() {
  let language;
  try {
    language = require('@tesseract.js-data/eng');
  } catch (error) {
    throw new Error(`Bundled English OCR data is not installed: ${error.message}`);
  }
  const langPath = resolvePhysicalAsarPath(language.langPath);
  const suffix = language.gzip ? '.traineddata.gz' : '.traineddata';
  const dataFile = path.join(langPath, `${language.code}${suffix}`);
  if (!fs.existsSync(dataFile)) {
    throw new Error(`Bundled English OCR data is missing: ${dataFile}`);
  }
  return { ...language, langPath, dataFile };
}

class LocalScoreboardOcr {
  constructor(options = {}) {
    this.options = options;
    this.worker = null;
    this.initializing = null;
    this.queue = Promise.resolve();
    this.closed = false;
  }

  async initialize() {
    if (this.closed) throw new Error('OCR worker has been terminated');
    if (this.worker) return this.worker;
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      const { createWorker, OEM } = this.options.tesseract ?? require('tesseract.js');
      const language = this.options.languageData ?? getBundledLanguageData();
      const bundledWorkerOptions = this.options.tesseract ? {} : getBundledOcrWorkerOptions();
      const workerOptions = {
        ...bundledWorkerOptions,
        langPath: language.langPath,
        gzip: language.gzip !== false,
        cacheMethod: 'readOnly',
        ...this.options.workerOptions,
      };
      if (typeof this.options.logger === 'function') workerOptions.logger = this.options.logger;
      // The language package is in node_modules and the core/worker scripts are
      // transitive local dependencies, so initialization never needs a CDN.
      const worker = await createWorker(language.code ?? 'eng', OEM?.LSTM_ONLY ?? 1, workerOptions, {
        load_system_dawg: '0',
        load_freq_dawg: '0',
      });
      if (this.closed) {
        await worker.terminate();
        throw new Error('OCR worker was terminated during initialization');
      }
      this.worker = worker;
      return worker;
    })();
    try {
      return await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  recognize(input, fieldType, options = {}) {
    const run = async () => {
      const profile = { ...FIELD_PROFILES[fieldType], ...options.profile };
      if (!FIELD_PROFILES[fieldType]) throw new Error(`Unknown OCR field type: ${fieldType}`);
      const worker = await this.initialize();
      const preprocessed = options.preprocess === false
        ? { buffer: toBuffer(input), metadata: null }
        : preprocessPng(input, {
          targetHeight: profile.targetHeight,
          ...(profile.preprocess || {}),
          ...this.options.preprocess,
          ...options.preprocess,
          rectangle: options.rectangle,
        });
      await worker.setParameters({
        tessedit_pageseg_mode: profile.pageSegmentation,
        tessedit_char_whitelist: profile.whitelist,
        preserve_interword_spaces: ['downDistance', 'teamName', 'screenText'].includes(fieldType) ? '1' : '0',
        user_defined_dpi: '300',
      });
      const startedAt = Date.now();
      const recognition = await worker.recognize(preprocessed.buffer);
      const rawText = fieldType === 'screenText'
        ? cleanScreenText(recognition?.data?.text)
        : cleanRawText(recognition?.data?.text);
      const value = normalizeField(fieldType, rawText);
      const engineConfidence = Math.max(0, Math.min(1, Number(recognition?.data?.confidence ?? 0) / 100));
      // Proven black/white scorebug alias: Tesseract reads the isolated `1st`
      // suffix as `15`. Preserve the normal structural confidence floor.
      const structuralFloor = fieldType === 'quarter'
        && cleanRawText(rawText).replace(/[^A-Z0-9]/gi, '').toUpperCase() === '15'
        ? 0.62
        : Number(profile.minimumValidConfidence) || 0;
      const confidence = value === null
        ? engineConfidence * 0.35
        : Math.max(engineConfidence, structuralFloor);
      return {
        fieldType,
        value,
        rawText,
        valid: value !== null,
        confidence,
        engineConfidence,
        elapsedMs: Date.now() - startedAt,
        preprocessing: preprocessed.metadata,
      };
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async recognizeFields(fields) {
    if (!Array.isArray(fields)) throw new TypeError('fields must be an array');
    const results = {};
    for (const field of fields) {
      if (!field || !field.name || !field.type || !field.image) {
        throw new TypeError('Each OCR field needs name, type, and image');
      }
      results[field.name] = await this.recognize(field.image, field.type, field.options);
    }
    return results;
  }

  async terminate() {
    this.closed = true;
    await this.queue.catch(() => {});
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }
}

module.exports = {
  FIELD_PROFILES,
  LocalScoreboardOcr,
  PAGE_SEGMENTATION,
  cleanScreenText,
  cleanRawText,
  getBundledLanguageData,
  getBundledOcrWorkerOptions,
  normalizeClock,
  normalizeDownDistance,
  normalizeField,
  normalizeInchesToken,
  normalizePlayClock,
  normalizeQuarter,
  normalizeRecord,
  normalizeScore,
  normalizeScreenText,
  normalizeTeamName,
  preprocessPng,
  resolvePhysicalAsarPath,
};
