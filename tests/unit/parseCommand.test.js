#!/usr/bin/env node
// Unit tests for Parse Command node logic
// Run: node --test tests/unit/parseCommand.test.js  (Node 18+ built-in test runner)

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// ===== Extract Parse Command logic from workflow JSON =====
// We load the actual functionCode from the workflow to keep tests in sync.
const wfPath = path.join(__dirname, '..', '..', 'security-news-workflow.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
const parseNode = wf.nodes.find(n => n.name === 'Parse Command');

if (!parseNode) {
  console.error('Parse Command node not found in workflow JSON');
  process.exit(1);
}

// The functionCode returns items via `return [{ json: {...} }]`.
// We extract the core logic into a callable function by wrapping it.
const rawCode = parseNode.parameters.functionCode;

// Create a function that simulates the n8n Function node environment
function parseCommand(messageObj) {
  // Simulate $input.first().json.message (the Telegram message object)
  const items = [{ json: { message: messageObj } }];

  // Simulate $env (not used in Parse Command, but available)
  const $env = {};

  // Build a function from the raw code, injecting the items context
  // The functionCode expects `items` to be available and returns an array
  const fn = new Function('items', '$env', rawCode);
  const result = fn(items, $env);

  // Return the first item's json
  return result[0]?.json || {};
}

// ===== TESTS =====

describe('Parse Command', () => {
  const baseChatId = '12345';
  const makeMsg = (overrides = {}) => ({
    chat: { id: baseChatId },
    ...overrides,
  });

  describe('media without text', () => {
    it('should route photo to AI with mediaType=photo', () => {
      const msg = makeMsg({ photo: [{ file_id: 'photo123' }] });
      const result = parseCommand(msg);
      assert.equal(result.action, 'ai');
      assert.equal(result.mediaType, 'photo');
      assert.equal(result.fileId, 'photo123');
      assert.equal(result.respondAsAudio, false);
    });

    it('should pick highest-resolution photo (last in array)', () => {
      const msg = makeMsg({ photo: [
        { file_id: 'thumb' },
        { file_id: 'medium' },
        { file_id: 'full' },
      ]});
      const result = parseCommand(msg);
      assert.equal(result.fileId, 'full');
    });

    it('should route voice to AI with respondAsAudio=true', () => {
      const msg = makeMsg({ voice: { file_id: 'voice123' } });
      const result = parseCommand(msg);
      assert.equal(result.action, 'ai');
      assert.equal(result.mediaType, 'voice');
      assert.equal(result.respondAsAudio, true);
    });

    it('should route video to AI with videoFileSize and videoMimeType', () => {
      const msg = makeMsg({ video: { file_id: 'vid123', file_size: 5000000, mime_type: 'video/mp4' } });
      const result = parseCommand(msg);
      assert.equal(result.action, 'ai');
      assert.equal(result.mediaType, 'video');
      assert.equal(result.videoFileSize, 5000000);
      assert.equal(result.videoMimeType, 'video/mp4');
    });

    it('should default videoMimeType to video/mp4 when not provided', () => {
      const msg = makeMsg({ video: { file_id: 'vid123' } });
      const result = parseCommand(msg);
      assert.equal(result.videoMimeType, 'video/mp4');
      assert.equal(result.videoFileSize, 0);
    });

    it('should set command=explain and default query for media without text', () => {
      const msg = makeMsg({ photo: [{ file_id: 'p1' }] });
      const result = parseCommand(msg);
      assert.equal(result.command, 'explain');
      assert.equal(result.query, 'Describe and explain what you see/hear');
    });
  });

  describe('text commands', () => {
    it('should route /help to help action', () => {
      const msg = makeMsg({ text: '/help' });
      const result = parseCommand(msg);
      assert.equal(result.action, 'help');
    });

    it('should route /search to AI with command=search', () => {
      const msg = makeMsg({ text: '/search quantum computing' });
      const result = parseCommand(msg);
      assert.equal(result.action, 'ai');
      assert.equal(result.command, 'search');
      assert.equal(result.query, 'quantum computing');
    });

    it('should route /cve CVE-2024-1234 to cve_lookup', () => {
      const msg = makeMsg({ text: '/cve CVE-2024-1234' });
      const result = parseCommand(msg);
      assert.equal(result.action, 'cve_lookup');
      assert.equal(result.cveId, 'CVE-2024-1234');
    });

    it('should uppercase CVE ID', () => {
      const msg = makeMsg({ text: '/cve cve-2024-5678' });
      const result = parseCommand(msg);
      assert.equal(result.cveId, 'CVE-2024-5678');
    });

    it('should route /all to fetch with category=all', () => {
      const msg = makeMsg({ text: '/all' });
      const result = parseCommand(msg);
      assert.equal(result.action, 'fetch');
      assert.equal(result.category, 'all');
    });

    it('should route /security to fetch with category=security_news', () => {
      const msg = makeMsg({ text: '/security' });
      const result = parseCommand(msg);
      assert.equal(result.action, 'fetch');
      assert.equal(result.category, 'security_news');
    });

    it('should route /cve (without ID) to fetch with category=cve', () => {
      const msg = makeMsg({ text: '/cve' });
      const result = parseCommand(msg);
      assert.equal(result.action, 'fetch');
      assert.equal(result.category, 'cve');
    });

    it('should route unknown commands to help', () => {
      const msg = makeMsg({ text: '/unknown' });
      const result = parseCommand(msg);
      assert.equal(result.action, 'help');
    });

    it('should always include chatId', () => {
      const msg = makeMsg({ text: '/help' });
      const result = parseCommand(msg);
      assert.equal(result.chatId, baseChatId);
    });
  });

  describe('media with caption', () => {
    it('should treat non-command caption as text and route to help', () => {
      // When a photo has a non-command caption, Parse Command reads it as text
      // and tries command matching. Since "What is this building?" isn't a command,
      // it falls through to the help action.
      const msg = makeMsg({
        photo: [{ file_id: 'p1' }],
        caption: 'What is this building?',
      });
      const result = parseCommand(msg);
      assert.equal(result.action, 'help');
    });

    it('should route photo with /explain caption to AI', () => {
      const msg = makeMsg({
        photo: [{ file_id: 'p1' }],
        caption: '/explain What is this?',
      });
      const result = parseCommand(msg);
      assert.equal(result.action, 'ai');
      assert.equal(result.command, 'explain');
    });
  });

  describe('/explain command with media', () => {
    it('should route /explain with photo to AI with mediaType=photo', () => {
      const msg = makeMsg({
        text: '/explain deep analysis please',
        photo: [{ file_id: 'p1' }],
      });
      // Note: /explain with text + photo depends on exact Parse Command logic
      // The actual behavior routes based on the /explain regex match
      const result = parseCommand(msg);
      assert.equal(result.action, 'ai');
      assert.equal(result.command, 'explain');
    });
  });
});
