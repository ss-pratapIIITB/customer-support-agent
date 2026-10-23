"""Small synchronous client for the app's internal evaluation API."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from typing import Any

from .dataset import Case


class EvalApiError(RuntimeError):
    """The application returned an error or was unreachable."""


class EvalApi:
    def __init__(
        self,
        base_url: str,
        token: str,
        run_id: str,
        timeout: float = 90.0,
        retries: int = 2,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.run_id = run_id
        self.timeout = timeout
        self.retries = retries

    def _request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        url = f"{self.base_url}{path}"
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "maxify-evals/1.0",
            "x-eval-token": self.token,
            "x-eval-run-id": self.run_id,
        }
        if extra_headers:
            headers.update(extra_headers)
        body = json.dumps(payload).encode("utf-8") if payload is not None else None

        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            request = urllib.request.Request(url, data=body, headers=headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    raw = response.read().decode("utf-8")
                    return json.loads(raw) if raw.strip() else {}
            except urllib.error.HTTPError as error:
                detail = error.read().decode("utf-8", "replace")[:800]
                last_error = EvalApiError(
                    f"{method} {path} returned HTTP {error.code}: {detail}"
                )
                if error.code not in {429, 500, 502, 503, 504} or attempt >= self.retries:
                    raise last_error from error
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
                last_error = EvalApiError(f"{method} {path} failed: {error}")
                if attempt >= self.retries:
                    raise last_error from error
            time.sleep(0.4 * (2**attempt))

        raise last_error or EvalApiError(f"{method} {path} failed")

    def meta(self) -> dict[str, Any]:
        return self._request("GET", "/api/internal/eval/meta")

    def answer(self, case: Case, user_id: str) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/internal/eval/answer",
            {
                "question": case.question,
                "history": list(case.history),
                "category": case.category,
                "userId": user_id,
                "runId": self.run_id,
                "caseId": case.id,
            },
            {"x-eval-case-id": case.id},
        )

    def judge(
        self,
        question: str,
        answer: str,
        expected_behavior: str,
        citations: list[dict[str, Any]],
        evidence: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return self._request(
            "POST",
            "/api/internal/eval/judge",
            {
                "question": question,
                "answer": answer,
                "expectedBehavior": expected_behavior,
                "citations": citations,
                "evidence": evidence,
            },
        )

    def import_report(self, report: dict[str, Any]) -> dict[str, Any]:
        return self._request("POST", "/api/internal/eval/import", report)
