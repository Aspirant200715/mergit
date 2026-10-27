from __future__ import annotations

import os
from pathlib import Path

import pytest

from mergit_worker.workspace import (
    GitLimits,
    Workspace,
    WorkspaceError,
    relative_parts,
    validate_ref,
    validate_repo_url,
)
from tests.support import LOCAL_GIT, ProcessSandbox


def test_clone_records_head_and_checks_out_files(sandbox: ProcessSandbox):
    assert len(sandbox.workspace.head) == 40
    assert (sandbox.workspace.work / "payments" / "refund.py").exists()
    assert not (sandbox.workspace.work / ".git").exists()  # git metadata is outside the mount


@pytest.mark.parametrize(
    "url", ["", "-oProxyCommand=x", "ext::sh -c id", "git@github.com:a/b.git", "http://a/b", "https://a b/c"]
)
def test_repo_url_rejected(url: str):
    with pytest.raises(WorkspaceError):
        validate_repo_url(url, ("https",))


def test_https_url_accepted():
    validate_repo_url("https://github.com/mergit-io/mergit.git", ("https",))


@pytest.mark.parametrize("ref", ["", "--upload-pack=x", "-x", "a..b", "a b", "a;b", "$(id)"])
def test_ref_rejected(ref: str):
    with pytest.raises(WorkspaceError):
        validate_ref(ref)


@pytest.mark.parametrize("ref", ["main", "feature/x-1", "v1.2.3", "a" * 40])
def test_ref_accepted(ref: str):
    validate_ref(ref)


@pytest.mark.parametrize("rel", ["/etc/passwd", "../x", "a/../../x", "a\x00b"])
def test_path_escape_rejected(rel: str):
    with pytest.raises(WorkspaceError):
        relative_parts(rel)


def test_clone_failure_leaves_nothing_behind(tmp_path: Path, repo_url: str):
    root = tmp_path / "ws"
    with pytest.raises(WorkspaceError):
        Workspace.clone(repo_url, "no-such-branch", root, LOCAL_GIT)
    assert list(root.iterdir()) == []


def test_scheme_not_in_allowlist_is_refused(tmp_path: Path, repo_url: str):
    with pytest.raises(WorkspaceError, match="scheme"):
        Workspace.clone(repo_url, "main", tmp_path / "ws", GitLimits(("https",), 30))


def test_changed_paths_covers_modified_added_deleted_sorted(sandbox: ProcessSandbox):
    ws = sandbox.workspace
    ws.write_file("payments/refund.py", b"changed\n")
    ws.write_file("new/dir/file.txt", b"x")
    (ws.work / "docs" / "notes.md").unlink()
    assert ws.changed_paths() == ["docs/notes.md", "new/dir/file.txt", "payments/refund.py"]


def test_changed_paths_empty_when_untouched(sandbox: ProcessSandbox):
    assert sandbox.workspace.changed_paths() == []


def test_changed_paths_respects_gitignore(sandbox: ProcessSandbox):
    sandbox.workspace.write_file("__pycache__/x.pyc", b"\x00")
    assert sandbox.workspace.changed_paths() == []


def test_planted_git_file_and_config_are_never_read(sandbox: ProcessSandbox, tmp_path: Path):
    """The container could write a `.git` that points at a hostile git dir with a code-running config."""
    ws = sandbox.workspace
    hostile = tmp_path / "hostile-gitdir"
    hostile.mkdir()
    marker = tmp_path / "pwned"
    (hostile / "config").write_text(f"[core]\n\tfsmonitor = touch {marker}\n")
    (ws.work / ".git").write_text(f"gitdir: {hostile}\n")
    ws.write_file("payments/refund.py", b"changed\n")
    assert ws.changed_paths()[-1] == "payments/refund.py"
    assert not marker.exists()


def test_read_through_symlink_is_refused(sandbox: ProcessSandbox, tmp_path: Path):
    secret = tmp_path / "secret.txt"
    secret.write_text("host secret")
    os.symlink(secret, sandbox.workspace.work / "link")
    with pytest.raises(WorkspaceError, match="symlink"):
        sandbox.workspace.read_file("link", 100)


def test_write_through_symlink_is_refused(sandbox: ProcessSandbox, tmp_path: Path):
    target = tmp_path / "victim.txt"
    target.write_text("original")
    os.symlink(target, sandbox.workspace.work / "link")
    with pytest.raises(WorkspaceError, match="symlink"):
        sandbox.workspace.write_file("link", b"overwritten")
    assert target.read_text() == "original"


def test_symlinked_directory_in_path_is_refused(sandbox: ProcessSandbox, tmp_path: Path):
    outside = tmp_path / "outside"
    outside.mkdir()
    os.symlink(outside, sandbox.workspace.work / "escape")
    with pytest.raises(WorkspaceError, match="symlink"):
        sandbox.workspace.write_file("escape/pwn.txt", b"x")
    assert list(outside.iterdir()) == []
    with pytest.raises(WorkspaceError):
        sandbox.workspace.list_files("escape")


def test_list_files_shows_symlinks_without_following(sandbox: ProcessSandbox, tmp_path: Path):
    os.symlink(tmp_path, sandbox.workspace.work / "docs" / "outside")
    listing = sandbox.workspace.list_files(".")
    assert "docs/outside@" in listing
    assert not any(p.startswith("docs/outside/") for p in listing)


def test_read_reports_truncation_by_returning_one_extra_byte(sandbox: ProcessSandbox):
    sandbox.workspace.write_file("big.txt", b"a" * 50)
    assert len(sandbox.workspace.read_file("big.txt", 10)) == 11


def test_read_missing_and_directory(sandbox: ProcessSandbox):
    with pytest.raises(FileNotFoundError):
        sandbox.workspace.read_file("nope.txt", 10)
    with pytest.raises(WorkspaceError):
        sandbox.workspace.read_file("docs", 10)


def test_file_hash_absent_and_present(sandbox: ProcessSandbox):
    import mergit_receipt

    assert sandbox.workspace.file_hash("missing", 100) is None
    sandbox.workspace.write_file("a.txt", b"hello")
    assert sandbox.workspace.file_hash("a.txt", 100) == mergit_receipt.keccak_hex(b"hello")
    with pytest.raises(WorkspaceError, match="larger"):
        sandbox.workspace.file_hash("a.txt", 2)


def test_diff_includes_new_files(sandbox: ProcessSandbox):
    sandbox.workspace.write_file("payments/refund.py", b"def refund(a, f):\n    return a - f\n")
    sandbox.workspace.write_file("payments/new.py", b"x = 1\n")
    diff = sandbox.workspace.diff_from_head()
    assert "payments/new.py" in diff
    assert "return a - f" in diff
