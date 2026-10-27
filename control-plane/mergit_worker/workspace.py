"""The repository checkout on the host, and the only code that touches it.

The container mounts `work/` and can write anything there, including symlinks and a `.git` of its own
making. So the host never trusts what it finds inside `work/`:

- the git directory lives outside `work/`, and every host git call names it with `--git-dir` and
  `--work-tree`, so a planted `.git` file, hook or config is never read;
- file reads and writes walk the path one component at a time with `O_NOFOLLOW`, so a symlink the
  agent created cannot point a host read or write outside the checkout.
"""

from __future__ import annotations

import contextlib
import errno
import os
import re
import shutil
import stat
import subprocess
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

import mergit_receipt

_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@+-]{0,254}$")
_MAX_LIST_ENTRIES = 2000


class WorkspaceError(Exception):
    """A path, URL or ref was refused, or git failed. Safe to show to the model."""


@dataclass(frozen=True, slots=True)
class GitLimits:
    allowed_schemes: Sequence[str]
    timeout_s: float


def validate_repo_url(url: str, allowed_schemes: Sequence[str]) -> None:
    if not url or url.startswith("-") or any(c.isspace() or ord(c) < 32 for c in url):
        raise WorkspaceError("repository URL is malformed")
    scheme = urlsplit(url).scheme
    if scheme not in allowed_schemes:
        raise WorkspaceError(f"repository URL scheme {scheme!r} is not allowed")


def validate_ref(ref: str) -> None:
    if not _REF.match(ref) or ".." in ref:
        raise WorkspaceError("git ref is malformed")


def relative_parts(rel: str) -> tuple[str, ...]:
    """Split a model-supplied path into components, refusing anything that could leave the checkout."""
    if "\x00" in rel:
        raise WorkspaceError("path contains a NUL byte")
    path = PurePosixPath(rel)
    if path.is_absolute():
        raise WorkspaceError("path must be relative to the repository root")
    if ".." in path.parts:
        raise WorkspaceError("path must not contain '..'")
    return path.parts


class Workspace:
    def __init__(self, base: Path, work: Path, gitdir: Path, head: str, git_timeout_s: float) -> None:
        self._base = base
        self.work = work
        self._gitdir = gitdir
        self.head = head
        self._git_timeout_s = git_timeout_s

    # -- creation and teardown -------------------------------------------------------------

    @classmethod
    def clone(cls, repo_url: str, ref: str, root: Path, limits: GitLimits) -> Workspace:
        validate_repo_url(repo_url, limits.allowed_schemes)
        validate_ref(ref)
        root.mkdir(parents=True, exist_ok=True)
        base = Path(tempfile.mkdtemp(prefix="ws-", dir=root))
        work, gitdir = base / "work", base / "git"
        work.mkdir()
        try:
            env = _git_env(limits.allowed_schemes)
            _git(["--git-dir", str(gitdir), "init", "-q"], env, limits.timeout_s)
            _git(
                [
                    "--git-dir",
                    str(gitdir),
                    "-c",
                    "core.hooksPath=/dev/null",
                    "fetch",
                    "-q",
                    "--depth",
                    "1",
                    "--no-recurse-submodules",
                    "--",
                    repo_url,
                    ref,
                ],
                env,
                limits.timeout_s,
            )
            _git(
                [
                    "--git-dir",
                    str(gitdir),
                    "--work-tree",
                    str(work),
                    "-c",
                    "core.hooksPath=/dev/null",
                    "checkout",
                    "-q",
                    "--detach",
                    "FETCH_HEAD",
                ],
                env,
                limits.timeout_s,
            )
            head = _git(["--git-dir", str(gitdir), "rev-parse", "HEAD"], env, limits.timeout_s).strip()
        except BaseException:
            shutil.rmtree(base, ignore_errors=True)
            raise
        return cls(base, work, gitdir, head, limits.timeout_s)

    def destroy(self) -> None:
        shutil.rmtree(self._base, ignore_errors=True)

    # -- git ---------------------------------------------------------------------------------

    def changed_paths(self) -> list[str]:
        """Every path that differs from the starting commit, sorted. A rename is reported as the
        deletion of the old path plus the addition of the new one, so both must be allowed."""
        out = _git(
            [
                "--git-dir",
                str(self._gitdir),
                "--work-tree",
                str(self.work),
                "status",
                "--porcelain=v1",
                "-z",
                "--no-renames",
                "--untracked-files=all",
            ],
            _git_env(()),
            self._git_timeout_s,
        )
        paths = {entry[3:] for entry in out.split("\x00") if len(entry) > 3}
        return sorted(paths)

    def diff_from_head(self) -> str:
        """Unified diff of tracked and untracked changes, for the PR gate to show the requester."""
        env = _git_env(())
        base = ["--git-dir", str(self._gitdir), "--work-tree", str(self.work)]
        _git([*base, "add", "-N", "--", "."], env, self._git_timeout_s)
        return _git([*base, "diff", "--no-ext-diff", "--binary", "HEAD"], env, self._git_timeout_s)

    # -- files -------------------------------------------------------------------------------

    def read_file(self, rel: str, max_bytes: int) -> bytes:
        """Up to `max_bytes + 1` bytes, so a caller can tell the file was longer."""
        parts = relative_parts(rel)
        if not parts:
            raise WorkspaceError("path names the repository root")
        fd = self._open(parts, os.O_RDONLY, create_parents=False)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise WorkspaceError("not a regular file")
            with os.fdopen(os.dup(fd), "rb") as f:
                return f.read(max_bytes + 1)
        finally:
            os.close(fd)

    def write_file(self, rel: str, content: bytes) -> None:
        parts = relative_parts(rel)
        if not parts:
            raise WorkspaceError("path names the repository root")
        fd = self._open(parts, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, create_parents=True)
        try:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise WorkspaceError("not a regular file")
            with os.fdopen(os.dup(fd), "wb") as f:
                f.write(content)
        finally:
            os.close(fd)

    def file_hash(self, rel: str, max_bytes: int) -> str | None:
        """keccak-256 of a file's contents from the Rust binding, or None if the file is absent."""
        try:
            data = self.read_file(rel, max_bytes)
        except FileNotFoundError:
            return None
        if len(data) > max_bytes:
            raise WorkspaceError(f"{rel} is larger than {max_bytes} bytes")
        return mergit_receipt.keccak_hex(data)

    def list_files(self, rel: str = ".") -> list[str]:
        """Relative paths below `rel` (files and directories, directories end in '/'), sorted, capped."""
        parts = relative_parts(rel)
        fd = self._open_dir(parts)
        found: list[str] = []
        try:
            self._walk(fd, PurePosixPath(*parts) if parts else PurePosixPath(), found)
        finally:
            os.close(fd)
        return sorted(found)

    # -- internals ---------------------------------------------------------------------------

    def _open_dir(self, parts: tuple[str, ...]) -> int:
        fd = os.open(self.work, os.O_RDONLY | os.O_DIRECTORY)
        try:
            for part in parts:
                nxt = _openat(part, os.O_RDONLY | os.O_DIRECTORY, fd)
                os.close(fd)
                fd = nxt
        except BaseException:
            os.close(fd)
            raise
        return fd

    def _open(self, parts: tuple[str, ...], flags: int, *, create_parents: bool) -> int:
        dirfd = os.open(self.work, os.O_RDONLY | os.O_DIRECTORY)
        try:
            for part in parts[:-1]:
                if create_parents:
                    with contextlib.suppress(FileExistsError):
                        os.mkdir(part, 0o755, dir_fd=dirfd)
                nxt = _openat(part, os.O_RDONLY | os.O_DIRECTORY, dirfd)
                os.close(dirfd)
                dirfd = nxt
            return _openat(parts[-1], flags, dirfd, 0o644)
        finally:
            os.close(dirfd)

    def _walk(self, fd: int, prefix: PurePosixPath, found: list[str]) -> None:
        with os.scandir(fd) as it:
            for entry in sorted(it, key=lambda e: e.name):
                if len(found) >= _MAX_LIST_ENTRIES:
                    return
                rel = prefix / entry.name
                if entry.is_symlink():
                    found.append(f"{rel}@")  # listed, never followed
                elif entry.is_dir(follow_symlinks=False):
                    found.append(f"{rel}/")
                    child = _openat(entry.name, os.O_RDONLY | os.O_DIRECTORY, fd)
                    try:
                        self._walk(child, rel, found)
                    finally:
                        os.close(child)
                else:
                    found.append(str(rel))


def _openat(name: str, flags: int, dir_fd: int, mode: int = 0o644) -> int:
    try:
        return os.open(name, flags | os.O_NOFOLLOW | os.O_CLOEXEC, mode, dir_fd=dir_fd)
    except OSError as exc:
        if exc.errno in (errno.ELOOP, errno.ENOTDIR):
            raise WorkspaceError(f"{name}: symlinks and non-directories in a path are not followed") from exc
        raise


def _git_env(allowed_schemes: Sequence[str]) -> dict[str, str]:
    """A scrubbed environment: no user or system git config, no prompts, only the allowed transports."""
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": "/nonexistent",
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_SYSTEM": "/dev/null",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_LFS_SKIP_SMUDGE": "1",
        "LC_ALL": "C",
    }
    env["GIT_ALLOW_PROTOCOL"] = ":".join(allowed_schemes) if allowed_schemes else "file"
    return env


def _git(args: list[str], env: dict[str, str], timeout_s: float) -> str:
    argv = ["git", *args]
    try:
        proc = subprocess.run(  # noqa: S603  # argv list, no shell; git is resolved from PATH
            argv, env=env, capture_output=True, timeout=timeout_s, check=False
        )
    except subprocess.TimeoutExpired as exc:
        raise WorkspaceError("git timed out") from exc
    if proc.returncode != 0:
        last = proc.stderr.decode("utf-8", "replace").strip().splitlines()[-1:]
        raise WorkspaceError(f"git failed: {last[0] if last else 'no output'}")
    return proc.stdout.decode("utf-8", "replace")
