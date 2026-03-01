# Test Strategy: n8n News Clipper Workflow

## Current State

| Aspect | Status |
|--------|--------|
| Test runner | None configured |
| Test count | 0 automated |
| Coverage | Unknown — no tooling |
| Test directories | None |
| CI/CD | None |

**This is an n8n workflow-as-code project.** The entire application is a single JSON file (`security-news-workflow.json`) with embedded JavaScript in Code/Function nodes, deployed via Docker Compose. Standard unit test frameworks (Jest, Vitest) cannot directly test n8n node code without extracting it.

---

## Testing Pyramid (Adapted for n8n Workflow)

```
           ╱  E2E (Telegram)  ╲       ← Manual: send commands, verify responses
          ╱────────────────────╲
         ╱  Integration (JSON)  ╲     ← Automated: validate workflow structure
        ╱────────────────────────╲
       ╱   Unit (Extracted Code)  ╲   ← Automated: test Code node logic offline
      ╱────────────────────────────╲
     ╱  Static Validation (Schema)  ╲ ← Automated: JSON integrity, connections
    ╱────────────────────────────────╲
```

---

## Layer Definitions

### Layer 1: Static Validation (Automated)
- **What**: Validate workflow JSON structure, connections, node references
- **How**: Python/Node.js scripts that parse `security-news-workflow.json`
- **Speed**: < 1s
- **Coverage**: Every node, every connection, every `$node['...']` reference
- **When**: Before every deploy, in pre-commit hook

**Checks:**
1. JSON is valid and parseable
2. All connection targets reference existing nodes
3. All `$node['NodeName']` references match actual node names
4. All `$env.VAR_NAME` references are documented
5. No duplicate node names
6. Node count assertion (detect accidental deletions)
7. Critical nodes exist (Telegram Trigger, Parse Command, Call AI, etc.)

### Layer 2: Unit Tests — Extracted Code Node Logic (Automated)
- **What**: Test JavaScript logic from Code/Function nodes in isolation
- **Isolation**: Extract `jsCode`/`functionCode` into standalone functions, mock `$env`, `this.helpers`, `$node`, `$input`
- **Speed**: < 50ms per test
- **Coverage target**: Parse Command routing, Call AI provider fallback, Condense Digest formatting
- **Naming**: `tests/unit/{nodeName}.test.js`

**Key code to extract and test:**
- `Parse Command`: command routing logic (input → action/command/mediaType)
- `Call AI`: provider fallback chain (Gemini → GPT-5 → NVIDIA → Cerebras → Mistral)
- `Condense Digest`: HTML formatting, section grouping, deduplication
- `Generate AI Briefing`: prompt construction, response parsing

### Layer 3: Integration Tests — Workflow Structure (Automated)
- **What**: Verify data flow paths through the workflow graph
- **How**: Parse connections JSON, trace paths from trigger to terminal nodes
- **Speed**: < 5s
- **Coverage**: All critical paths (AI, digest, voice, photo, video)

**Paths to verify:**
1. `Telegram Trigger → Parse Command → Is AI? → Send AI Thinking → Call AI → Is Audio Response? → Edit AI Response`
2. `Telegram Trigger → Parse Command → Is Help? → Send Help`
3. `Cron Daily → Send Processing → Route to Fetchers → ... → Condense Digest → Deliver`
4. `Call AI → Is Audio Response? → Prepare TTS → Fetch TTS Audio → Has Audio? → Send Voice Reply`

### Layer 4: E2E Tests — Telegram Bot (Manual)
- **What**: Send real commands to the bot, verify responses
- **How**: Manual testing via Telegram chat
- **Speed**: 30-120s per test
- **Coverage**: Top 10 user flows
- **When**: After every workflow update, before marking deploy complete

**Test cases:**
| # | Input | Expected |
|---|-------|----------|
| 1 | `/help` | Help menu with all commands |
| 2 | `/all` | Digest with all categories |
| 3 | `/search quantum computing` | AI search results |
| 4 | `/explain DNS` | AI explanation |
| 5 | `/cve CVE-2024-1234` | CVE lookup result |
| 6 | Voice message | Transcription + voice reply |
| 7 | Photo (no caption) | Image analysis with 📷 header |
| 8 | Video (< 20 MB) | Video analysis with 🎥 header |
| 9 | Photo + caption | Contextual image analysis |
| 10 | Video > 20 MB | "Too large" error message |

---

## What to Test (Priority Order)

1. **Command routing** (Parse Command): correct action/command for each input type
2. **AI provider fallback**: Gemini → GPT-5 → NVIDIA → Cerebras → Mistral chain
3. **Media analysis**: photo download → Gemini Vision, video → File API → Gemini Vision
4. **Error paths**: missing API keys, download failures, rate limits, oversized files
5. **Connection integrity**: all node connections are valid
6. **Node reference integrity**: `$node['Name']` matches actual node names
7. **Digest formatting**: correct HTML, section grouping, dedup logic
8. **Response formatting**: correct emoji/title per command type

## What NOT to Test

- n8n framework internals (node execution engine, expression resolution)
- Telegram Bot API behavior (message delivery, webhook handling)
- Gemini/GPT-5/NVIDIA API response quality (model output is non-deterministic)
- Docker Compose orchestration
- PostgreSQL n8n state storage

---

## Test Quality Rules

- **One behavior per test**: Test command routing for `/search` separately from `/explain`
- **Descriptive names**: `parseCommand_photoWithNoCaption_shouldReturnAiActionWithMediaTypePhoto`
- **Mock external calls**: Replace `this.helpers.httpRequest` with mock returning controlled data
- **Test error paths**: Every try/catch block should have a corresponding error test
- **No test interdependence**: Each test resets state (fresh workflow JSON parse)
- **Test data factories**: Helper functions to create Telegram message objects

---

## Implementation: Static Validation Script

```javascript
// tests/validate-workflow.js
// Run: node tests/validate-workflow.js

const fs = require('fs');
const path = require('path');

const wfPath = path.join(__dirname, '..', 'security-news-workflow.json');
const wf = JSON.parse(fs.readFileSync(wfPath, 'utf8'));
let errors = 0;

function check(condition, msg) {
  if (!condition) { console.error(`❌ ${msg}`); errors++; }
  else console.log(`✅ ${msg}`);
}

// 1. Node count
check(wf.nodes.length >= 69, `Node count: ${wf.nodes.length} (expected >= 69)`);

// 2. No duplicate names
const names = wf.nodes.map(n => n.name);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
check(dupes.length === 0, `No duplicate node names${dupes.length ? ': ' + dupes.join(', ') : ''}`);

// 3. All connections reference existing nodes
const nameSet = new Set(names);
const conns = wf.connections || {};
for (const [src, srcConns] of Object.entries(conns)) {
  check(nameSet.has(src), `Connection source exists: "${src}"`);
  for (const portList of (srcConns.main || [])) {
    for (const c of portList) {
      check(nameSet.has(c.node), `Connection target exists: "${c.node}" (from "${src}")`);
    }
  }
}

// 4. Critical nodes exist
const critical = [
  'Telegram Trigger', 'Parse Command', 'Is Help?', 'Is AI?',
  'Send AI Thinking', 'Call AI', 'Is Audio Response?',
  'Cron Daily', 'Route to Fetchers', 'Tag Category',
  'Condense Digest', 'Generate AI Briefing',
  'Send Photo Reply', 'Send Video Reply', 'Send Voice Reply',
];
for (const name of critical) {
  check(nameSet.has(name), `Critical node exists: "${name}"`);
}

// 5. Check $node references in code
const nodeRefPattern = /\$node\['([^']+)'\]/g;
for (const node of wf.nodes) {
  const code = node.parameters?.jsCode || node.parameters?.functionCode || '';
  let match;
  while ((match = nodeRefPattern.exec(code)) !== null) {
    check(nameSet.has(match[1]), `$node['${match[1]}'] reference valid (in "${node.name}")`);
  }
}

// 6. Check required env vars are documented
const envPattern = /\$env\.(\w+)/g;
const envVars = new Set();
for (const node of wf.nodes) {
  const code = node.parameters?.jsCode || node.parameters?.functionCode || '';
  let match;
  while ((match = envPattern.exec(code)) !== null) {
    envVars.add(match[1]);
  }
}
console.log(`\nEnv vars referenced: ${[...envVars].sort().join(', ')}`);

// Summary
console.log(`\n${errors === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${errors} CHECKS FAILED`}`);
process.exit(errors > 0 ? 1 : 0);
```

## Implementation: Parse Command Unit Test Example

```javascript
// tests/unit/parseCommand.test.js
// Run: node --test tests/unit/parseCommand.test.js  (Node 18+ built-in test runner)

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Extract Parse Command logic into a testable function
function parseCommand(messageObj) {
  const msg_obj = messageObj || {};
  const chatId = (msg_obj.chat?.id || '').toString();
  const text = (msg_obj.text || msg_obj.caption || '').trim();
  const msgLower = text.toLowerCase();

  const hasPhoto = !!(msg_obj.photo && msg_obj.photo.length > 0);
  const hasVoice = !!msg_obj.voice;
  const hasVideo = !!msg_obj.video;
  const hasMedia = hasPhoto || hasVoice || hasVideo;

  if (hasMedia && !text) {
    const mediaType = hasPhoto ? 'photo' : hasVoice ? 'voice' : 'video';
    let fileId = '';
    let videoFileSize = 0, videoMimeType = 'video/mp4';
    if (hasPhoto) fileId = msg_obj.photo[msg_obj.photo.length - 1].file_id;
    else if (hasVoice) fileId = msg_obj.voice.file_id;
    else if (hasVideo) {
      fileId = msg_obj.video.file_id;
      videoFileSize = msg_obj.video.file_size || 0;
      videoMimeType = msg_obj.video.mime_type || 'video/mp4';
    }
    return { action: 'ai', command: 'explain', query: 'Describe and explain what you see/hear', chatId, mediaType, fileId, respondAsAudio: hasVoice, videoFileSize, videoMimeType };
  }

  const cveMatch = text.match(/^\/cve\s+(CVE-\d{4}-\d{4,})/i);
  if (cveMatch) return { action: 'cve_lookup', cveId: cveMatch[1].toUpperCase(), chatId };

  const searchMatch = text.match(/^\/search\s+(.+)/i);
  if (searchMatch) return { action: 'ai', command: 'search', query: searchMatch[1], chatId, respondAsAudio: false };

  // ... (abbreviated — extract full code for real tests)

  const categoryMap = {
    '/cve':'cve','/security':'security_news','/services':'service',
    '/retro':'retrogaming','/scitech':'scitech','/world':'world',
    '/hn':'hackernews','/brpt':'brpt','/youtube':'youtube',
    '/all':'all','/extended':'all','/help':'help'
  };
  const cleanCmd = msgLower.replace(/\s+(full|extended)$/, '');
  const category = categoryMap[cleanCmd] || null;

  if (msgLower === '/help' || !category) return { action: 'help', chatId };
  return { action: 'fetch', category, chatId };
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
  });

  describe('text commands', () => {
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

    it('should route /help to help action', () => {
      const msg = makeMsg({ text: '/help' });
      const result = parseCommand(msg);
      assert.equal(result.action, 'help');
    });

    it('should route unknown commands to help', () => {
      const msg = makeMsg({ text: '/unknown' });
      const result = parseCommand(msg);
      assert.equal(result.action, 'help');
    });

    it('should route /all to fetch with category=all', () => {
      const msg = makeMsg({ text: '/all' });
      const result = parseCommand(msg);
      assert.equal(result.action, 'fetch');
      assert.equal(result.category, 'all');
    });
  });
});
```

---

## CI Integration

Since there is no CI pipeline, these commands can be run manually or added to a `Makefile`:

```makefile
# Makefile
.PHONY: validate test test-unit test-all

# Layer 1: Static validation (< 1s)
validate:
	node tests/validate-workflow.js

# Layer 2: Unit tests (< 5s)
test-unit:
	node --test tests/unit/

# All automated tests
test: validate test-unit

# Full test (includes manual reminder)
test-all: test
	@echo ""
	@echo "=== AUTOMATED TESTS COMPLETE ==="
	@echo "Now run manual E2E tests via Telegram:"
	@echo "  1. /help"
	@echo "  2. /all"
	@echo "  3. /search test query"
	@echo "  4. Send a photo"
	@echo "  5. Send a video"
	@echo "  6. Send a voice message"
```

**Test execution order (fail-fast):**
1. `make validate` — Static validation (fastest, catches structural issues)
2. `make test-unit` — Unit tests (fast, tests routing + formatting logic)
3. Manual E2E via Telegram — Full integration (slow, highest confidence)

---

## Getting Started

To set up test infrastructure:

```bash
# 1. Create test directories
mkdir -p tests/unit tests/integration

# 2. Copy the validation script
# (paste validate-workflow.js from above into tests/validate-workflow.js)

# 3. Run static validation
node tests/validate-workflow.js

# 4. Extract Parse Command code and create unit tests
# (paste parseCommand.test.js from above into tests/unit/parseCommand.test.js)

# 5. Run unit tests (Node 18+ built-in test runner)
node --test tests/unit/
```

No `npm install` needed — uses Node.js built-in test runner and `assert` module.
