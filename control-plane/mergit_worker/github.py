"""Opening the pull request for a finished plan (plan task O9).

Runs only in the worker, which is the one process that holds `GITHUB_TOKEN`. The token is used in two
places and nowhere else: the `Authorization` header of API calls, and the environment of the single
`git push` process. It is never given to a sandbox, a model prompt, a URL or argv.

The change set is the stored patch of each task that passed Φ, applied in task order onto a fresh
checkout of the plan's base ref, committed once, pushed to `mergit/<plan_uuid>` and opened as a PR.
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

from .workspace import GitLimits, Workspace, WorkspaceError

log = logging.getLogger(__name__)

_REPO_PATH = re.compile(r"^/([A-Za-z0-9._-]+)/([A-Za-z0-9._-]+?)(?:\.git)?/?$")
_TITLE_MAX = 120
_RETRIES = 3


class GitHubError(Exception):
    """The pull request could not be opened. The message is safe to show to the requester."""


@dataclass(frozen=True, slots=True)
class PrTask:
    index: int
    task_id: str
    title: str
    patch: str


@dataclass(frozen=True, slots=True)
class PrSpec:
    plan_uuid: str
    goal: str
    repo_url: str
    base_ref: str
    tasks: Sequence[PrTask]


@dataclass(frozen=True, slots=True)
class PrResult:
    branch: str
    commit_sha: str
    pr_number: int
    pr_url: str


@dataclass(frozen=True, slots=True)
class GitHubConfig:
    token: str
    api_url: str
    git_base_url: str
    hosts: Sequence[str]
    app_base_url: str
    author_name: str
    author_email: str
    workspace_root: Path
    git: GitLimits
    http_timeout_s: float


def parse_github_repo(repo_url: str, hosts: Sequence[str]) -> tuple[str, str]:
    """`https://github.com/<owner>/<repo>[.git]` to `(owner, repo)`. Any other host or shape is refused."""
    parts = urlsplit(repo_url)
    if parts.scheme != "https" or parts.hostname not in hosts or parts.query or parts.fragment:
        raise GitHubError(f"{repo_url!r} is not a repository URL on {', '.join(hosts)}")
    match = _REPO_PATH.match(parts.path)
    if match is None:
        raise GitHubError(f"{repo_url!r} does not name an owner and a repository")
    return match.group(1), match.group(2)


def clean_line(text: str, limit: int = _TITLE_MAX) -> str:
    """One line of plain text for a title or list item: whitespace collapsed, markup characters
    escaped, length capped. Titles come from the planner and the requester, so they are not trusted."""
    line = " ".join(text.split())
    line = re.sub(r"([\\`*_{}\[\]<>#|])", r"\\\1", line)
    return line if len(line) <= limit else line[: limit - 1] + "…"


def receipt_url(app_base_url: str, task_id: str) -> str:
    return f"{app_base_url.rstrip('/')}/app/proofs/{task_id}"


def pr_body(spec: PrSpec, app_base_url: str) -> str:
    lines = [
        f"Goal: {clean_line(spec.goal, 300)}",
        "",
        "Each task below passed its approved check. Every receipt is signed with a development key "
        "and is **unattested**: no hardware attests where it ran.",
        "",
    ]
    for task in sorted(spec.tasks, key=lambda t: t.index):
        link = receipt_url(app_base_url, task.task_id)
        lines.append(f"- Task {task.index}: {clean_line(task.title)} · [receipt]({link})")
    lines += ["", "Opened after the requester approved the final diff in Mergit."]
    return "\n".join(lines)


class GitHubPrOpener:
    def __init__(
        self,
        cfg: GitHubConfig,
        client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._cfg = cfg
        self._http = client or httpx.Client(timeout=cfg.http_timeout_s)
        self._sleep = sleep

    def open(self, spec: PrSpec) -> PrResult:
        if not spec.tasks:
            raise GitHubError("the plan has no passing task changes")
        owner, repo = parse_github_repo(spec.repo_url, self._cfg.hosts)
        git_url = f"{self._cfg.git_base_url.rstrip('/')}/{owner}/{repo}.git"
        branch = f"mergit/{spec.plan_uuid}"

        try:
            sha = self._build_and_push(spec, git_url, branch)
        except WorkspaceError as exc:
            raise GitHubError(str(exc)) from exc
        number, url = self._open_or_find_pr(spec, owner, repo, branch)
        return PrResult(branch=branch, commit_sha=sha, pr_number=number, pr_url=url)

    # -- git -----------------------------------------------------------------------------------

    def _build_and_push(self, spec: PrSpec, git_url: str, branch: str) -> str:
        ws = Workspace.clone(git_url, spec.base_ref, self._cfg.workspace_root, self._cfg.git)
        try:
            for task in sorted(spec.tasks, key=lambda t: t.index):
                try:
                    ws.apply_patch(task.patch)
                except WorkspaceError as exc:
                    raise WorkspaceError(f"the change of task {task.index} does not apply: {exc}") from exc
            sha = ws.commit_all(
                f"mergit: {clean_line(spec.goal, 72)}\n\nPlan {spec.plan_uuid}",
                self._cfg.author_name,
                self._cfg.author_email,
            )
            ws.push(git_url, branch, self._cfg.token, self._cfg.git)
            return sha
        finally:
            ws.destroy()

    # -- API -----------------------------------------------------------------------------------

    def _open_or_find_pr(self, spec: PrSpec, owner: str, repo: str, branch: str) -> tuple[int, str]:
        base = f"{self._cfg.api_url.rstrip('/')}/repos/{owner}/{repo}"
        response = self._request(
            "POST",
            f"{base}/pulls",
            json={
                "title": f"mergit: {clean_line(spec.goal, 100)}",
                "head": branch,
                "base": spec.base_ref,
                "body": pr_body(spec, self._cfg.app_base_url),
            },
        )
        if response.status_code == 201:
            data = response.json()
            return int(data["number"]), str(data["html_url"])
        if response.status_code == 422 and "already exists" in response.text:
            return self._existing_pr(base, owner, branch)  # a retry after the PR was already opened
        raise GitHubError(_describe(response))

    def _existing_pr(self, base: str, owner: str, branch: str) -> tuple[int, str]:
        found = self._request("GET", f"{base}/pulls", params={"head": f"{owner}:{branch}", "state": "open"})
        items: list[dict[str, Any]] = found.json() if found.status_code == 200 else []
        if not items:
            raise GitHubError("GitHub says the pull request exists but it could not be found")
        return int(items[0]["number"]), str(items[0]["html_url"])

    def _request(self, method: str, url: str, **kwargs: object) -> httpx.Response:
        headers = {
            "Authorization": f"Bearer {self._cfg.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        delay = 1.0
        for attempt in range(1, _RETRIES + 1):
            try:
                response = self._http.request(method, url, headers=headers, **kwargs)  # type: ignore[arg-type]
                if response.status_code < 500:
                    return response
                reason = f"HTTP {response.status_code}"
            except httpx.TransportError as exc:
                reason = type(exc).__name__
            if attempt == _RETRIES:
                raise GitHubError(f"GitHub is unavailable ({reason})")
            log.warning("GitHub %s %s failed (%s), retrying", method, url, reason)
            self._sleep(delay)
            delay *= 2
        raise AssertionError("unreachable")  # pragma: no cover


def _describe(response: httpx.Response) -> str:
    status = response.status_code
    if status in (401, 403):
        return "GitHub rejected the worker's token (check its scope and expiry)"
    if status == 404:
        return "GitHub cannot find the repository, or the token has no access to it"
    try:
        detail = response.json().get("message", "")
    except ValueError:
        detail = ""
    return f"GitHub refused to open the pull request ({status}): {str(detail)[:200]}"
