SHELL := /bin/bash
PYTHON ?= python3
BASE_URL ?= http://127.0.0.1:3000
EVAL_TOKEN ?= local-eval-token-change-me

.PHONY: install bootstrap dev build start typecheck test test-python test-integration eval eval-baseline smoke reliability docker-up docker-down clean

install:
	npm ci

bootstrap:
	npm run bootstrap

dev:
	npm run start:dev

build:
	npm run build

start:
	npm start

typecheck:
	npm run typecheck

test: test-python
	npm test

test-python:
	PYTHONPATH=evals $(PYTHON) -m unittest discover -s evals/tests -v

test-integration:
	INTEGRATION=1 MAXIFY_BASE_URL=$(BASE_URL) EVAL_API_TOKEN=$(EVAL_TOKEN) npm run test:integration

eval:
	PYTHONPATH=evals $(PYTHON) -m maxify_evals \
		--base-url $(BASE_URL) --token $(EVAL_TOKEN) --fail-under 0.9

eval-baseline:
	PYTHONPATH=evals $(PYTHON) -m maxify_evals \
		--base-url $(BASE_URL) --token $(EVAL_TOKEN) --fail-under 0 \
		--baseline none --no-import --output evals/baselines/demo-engine.json

smoke:
	MAXIFY_BASE_URL=$(BASE_URL) EVAL_API_TOKEN=$(EVAL_TOKEN) npm run smoke

reliability:
	MAXIFY_BASE_URL=$(BASE_URL) EVAL_API_TOKEN=$(EVAL_TOKEN) npm run reliability

docker-up:
	docker compose up --build -d

docker-down:
	docker compose down

clean:
	rm -rf build dist coverage
	rm -rf evals/reports
	find evals -name '__pycache__' -type d -prune -exec rm -rf {} +
