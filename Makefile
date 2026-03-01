.PHONY: validate test-unit test test-all

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
