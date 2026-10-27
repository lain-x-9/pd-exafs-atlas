import importlib.util
import sys
from pathlib import Path

import pytest


def installer():
    path = Path(__file__).resolve().parents[1] / "install.py"
    spec = importlib.util.spec_from_file_location("mace_addon_installer", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_installer_rejects_unrecognized_api_before_changes(tmp_path):
    module = installer()
    (tmp_path / "exafs_compute").mkdir()
    api = tmp_path / "exafs_compute/api.py"
    api.write_text("unexpected modified source")
    with pytest.raises(RuntimeError, match="版本不同"):
        module.preflight(tmp_path, Path(module.__file__).parent)
    assert api.read_text() == "unexpected modified source"


def test_exact_fdmnes_registration_is_preserved_during_install(tmp_path, monkeypatch):
    module = installer()
    root = tmp_path / "server"
    (root / "exafs_compute").mkdir(parents=True)
    api = root / "exafs_compute/api.py"
    payload_api = (Path(module.__file__).parent / "exafs_compute/api.py").read_text()
    api.write_text(payload_api.replace("    return app\n", module.FD_API + "    return app\n"))
    assert module.normalized_bytes(api, "exafs_compute/api.py") == payload_api.encode()
    monkeypatch.setattr(module, "preflight", lambda *args: None)
    monkeypatch.setattr(module, "settings", lambda *args: {})
    monkeypatch.setattr(module, "idle", lambda *args: None)
    monkeypatch.setattr(module, "stop", lambda *args: None)
    monkeypatch.setattr(module, "start", lambda *args: None)
    monkeypatch.setattr(module, "health", lambda *args: {
        "version": "0.1.0", "capabilities": {"mace": {"version": "1.0.0"}}})
    monkeypatch.setattr(sys, "argv", ["install.py", "--root", str(root), "--apply"])
    module.main()
    assert api.read_text().count(module.FD_API) == 1
    assert "install_mace(app, store)" in api.read_text()


def test_failed_restart_restores_old_api_and_removes_new_files(tmp_path, monkeypatch):
    module = installer()
    root = tmp_path / "server"
    (root / "exafs_compute").mkdir(parents=True)
    api = root / "exafs_compute/api.py"
    api.write_text("previous valid source")
    monkeypatch.setattr(module, "preflight", lambda *args: None)
    monkeypatch.setattr(module, "settings", lambda *args: {})
    monkeypatch.setattr(module, "idle", lambda *args: None)
    monkeypatch.setattr(module, "stop", lambda *args: None)
    starts = []

    def start(*args):
        starts.append(True)
        if len(starts) == 1:
            raise RuntimeError("simulated restart failure")

    monkeypatch.setattr(module, "start", start)
    monkeypatch.setattr(sys, "argv", ["install.py", "--root", str(root), "--apply"])
    with pytest.raises(RuntimeError, match="restart failure"):
        module.main()
    assert api.read_text() == "previous valid source"
    assert not (root / "exafs_compute/mace_worker.py").exists()
    assert len(starts) == 2
