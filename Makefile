.PHONY: test

test:
	npm test

test-all-nodejs:
	for v in '0.8' '0.9' '0.10' '0.11' '0.12' '1.0' '1.1' '1.2' '1.3' '1.4' '1.5' '1.6'; \
		do nave use $$v npm test; \
	done
