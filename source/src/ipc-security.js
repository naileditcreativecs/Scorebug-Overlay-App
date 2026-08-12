'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

function samePath(left, right) {
  if (!left || !right) return false;
  const normalizedLeft = path.resolve(String(left));
  const normalizedRight = path.resolve(String(right));
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function localDocumentPath(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'file:') return '';
    return fileURLToPath(url);
  } catch {
    return '';
  }
}

function liveWebContents(browserWindow) {
  if (!browserWindow || browserWindow.isDestroyed?.()) return null;
  const contents = browserWindow.webContents;
  if (!contents || contents.isDestroyed?.()) return null;
  return contents;
}

function trustedIpcSender(event, rules = []) {
  if (!event || !event.sender || !event.senderFrame) return false;
  for (const rule of rules) {
    const contents = liveWebContents(rule?.window);
    if (!contents || event.sender !== contents) continue;
    if (contents.mainFrame && event.senderFrame !== contents.mainFrame) continue;
    const senderPath = localDocumentPath(event.senderFrame.url);
    const documents = Array.isArray(rule.documents) ? rule.documents : [];
    if (senderPath && documents.some((documentPath) => samePath(senderPath, documentPath))) return true;
  }
  return false;
}

function assertTrustedIpcSender(event, rules, channel = 'IPC') {
  if (!trustedIpcSender(event, rules)) {
    const error = new Error(`${channel} request was denied because its sender is not trusted.`);
    error.code = 'ERR_UNTRUSTED_IPC_SENDER';
    throw error;
  }
}

function installLocalNavigationGuard(browserWindow, allowedDocuments = []) {
  const contents = liveWebContents(browserWindow);
  if (!contents) return () => {};
  const isAllowed = (value) => {
    const candidate = localDocumentPath(value);
    return Boolean(candidate && allowedDocuments.some((documentPath) => samePath(candidate, documentPath)));
  };
  const preventUnexpectedNavigation = (event, targetUrl) => {
    if (!isAllowed(targetUrl)) event.preventDefault();
  };
  contents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
  contents.on?.('will-navigate', preventUnexpectedNavigation);
  contents.on?.('will-redirect', preventUnexpectedNavigation);
  return () => {
    contents.removeListener?.('will-navigate', preventUnexpectedNavigation);
    contents.removeListener?.('will-redirect', preventUnexpectedNavigation);
  };
}

module.exports = {
  assertTrustedIpcSender,
  installLocalNavigationGuard,
  localDocumentPath,
  samePath,
  trustedIpcSender,
};
