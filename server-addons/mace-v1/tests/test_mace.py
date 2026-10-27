import importlib.util
import io
import json
import shutil
import sys
import threading
import time
import types
from pathlib import Path

import numpy as np
import pytest
from ase.build import bulk
from ase.constraints import FixAtoms, FixScaled
from ase.io import read, write
from fastapi.testclient import TestClient

from exafs_compute.api import Supervisor, create_app
from exafs_compute.engine import parse_structure
from exafs_compute.mace_support import inspect_atoms
from exafs_compute.store import Store, write_json

TOKEN = "mace-contract-test-" + "x" * 40
AUTH = {"Authorization": "Bearer " + TOKEN}


def parent(store):
    atoms = bulk("Cu", "fcc", a=3.61, cubic=True)
    atoms.rattle(stdev=.04, seed=2026)
    atoms.set_constraint(FixAtoms(indices=[0, 1]))
    stream = io.StringIO()
    write(stream, atoms, format="vasp", direct=True)
    original = stream.getvalue().encode()
    job = store.create("structure", {"format": "vasp"}, original, "POSCAR")
    result = parse_structure(store, job)
    write_json(store.folder(job["id"]) / "result.json", result)
    store.finish(job["id"], "succeeded")
    return store.get(job["id"]), original


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr("exafs_compute.mace_api.capability", lambda: {"available": True})
    with TestClient(create_app(tmp_path, TOKEN, run_worker=False)) as c:
        yield c


def test_auth_preview_submission_and_original_copy(client):
    store = client.app.state.store
    p, original = parent(store)
    assert client.get("/v1/mace/capabilities").status_code == 401
    summary = client.get("/v1/mace/structures/" + p["id"], headers=AUTH).json()
    assert summary["atom_count"] == 4 and summary["fixed_count"] == 2
    response = client.post("/v1/mace", headers=AUTH, json={"structure_job": p["id"], "steps": 10})
    assert response.status_code == 202
    job = response.json()
    assert job["kind"] == "mace" and job["state"] == "queued"
    assert (store.folder(job["id"]) / "original.upload").read_bytes() == original
    assert store.claim() == job["id"]
    for config in (
        {"steps": 301}, {"steps": True}, {"fmax": float("inf")},
        {"fixed_cell": False}, {"preserve_constraints": False},
        {"command": "anything"}, {"model": "/tmp/untrusted"},
    ):
        # HTTP JSON cannot represent Infinity; use a string and check validation.
        if config.get("fmax") == float("inf"):
            config["fmax"] = "Infinity"
        invalid = client.post("/v1/mace", headers=AUTH,
                              json={"structure_job": p["id"], **config})
        assert invalid.status_code == 422


def test_cancel_and_progress_do_not_change_other_jobs(client):
    store = client.app.state.store
    p, _ = parent(store)
    queued = store.create("mace", {"structure_job": p["id"]})
    response = client.post("/v1/mace/jobs/" + queued["id"] + "/cancel", headers=AUTH)
    assert response.json()["state"] == "interrupted"
    other = store.create("feff", {})
    running = store.create("mace", {})
    assert store.claim() == other["id"]
    store.finish(other["id"], "succeeded")
    assert store.claim() == running["id"]
    write_json(store.folder(running["id"]) / "progress.json", {"stage": "optimizing", "step": 3})
    response = client.post("/v1/mace/jobs/" + running["id"] + "/cancel", headers=AUTH)
    assert response.json()["cancel_requested"]
    polled = client.get("/v1/jobs/" + running["id"], headers=AUTH).json()
    assert polled["progress"]["step"] == 3
    assert store.get(other["id"])["state"] == "succeeded"
    assert client.post("/v1/mace/jobs/" + p["id"] + "/cancel", headers=AUTH).status_code == 404
    assert client.get("/v1/jobs/" + running["id"] + "/files/private.env", headers=AUTH).status_code == 404


def test_limits_and_scaled_constraints():
    atoms = bulk("Cu", "fcc", a=3.61, cubic=True)
    atoms.set_constraint(FixScaled(0, mask=[True, False, True]))
    summary = inspect_atoms(atoms)
    assert summary["partial_count"] == 1 and summary["fixed_count"] == 0
    atoms.set_constraint(FixAtoms(indices=range(4)))
    with pytest.raises(ValueError, match="全部"):
        inspect_atoms(atoms)
    with pytest.raises(ValueError, match="200"):
        inspect_atoms(bulk("Cu").repeat((6, 6, 6)))


def test_worker_io_constraints_and_unconverged_result(tmp_path, monkeypatch):
    # ASE EMT is used here solely to test worker control flow and file invariants.
    # This is not a MACE accuracy or numerical-model benchmark.
    from ase.calculators.emt import EMT
    import exafs_compute.mace_worker as worker

    store = Store(tmp_path / "state")
    p, original = parent(store)
    job = store.create("mace", {"structure_job": p["id"], "format": "vasp",
        "steps": 1, "fmax": .03, "maxstep": .01}, original, "POSCAR")
    monkeypatch.setitem(sys.modules, "torch",
                        types.SimpleNamespace(set_num_threads=lambda n: None,
                                              set_num_interop_threads=lambda n: None))

    def calculator(**kwargs):
        assert kwargs["device"] == "cpu" and kwargs["default_dtype"] == "float32"
        calc = EMT()
        calc.models = [types.SimpleNamespace(atomic_numbers=np.array([29]))]
        return calc

    monkeypatch.setitem(sys.modules, "mace", types.ModuleType("mace"))
    module = types.ModuleType("mace.calculators")
    module.MACECalculator = calculator
    monkeypatch.setitem(sys.modules, "mace.calculators", module)
    model = tmp_path / "model"
    model.write_bytes(b"trusted-test-model")
    monkeypatch.setattr(worker, "MODEL", model)
    monkeypatch.setattr(worker, "MODEL_SHA256", worker.sha256(model))
    monkeypatch.setattr(worker, "version", lambda name: "test")
    lock_path = tmp_path / "mace.lock"
    monkeypatch.setattr(worker, "Path", lambda path: lock_path)
    worker.run(store, job)
    folder = store.folder(job["id"])
    result = json.loads((folder / "result.json").read_text())
    assert result["converged"] is False
    assert result["fixed_max_displacement_a"] == 0
    assert result["cell_max_change_a"] == 0
    optimized = read(folder / "optimized.vasp", format="vasp")
    assert optimized.constraints[0].get_indices().tolist() == [0, 1]
    assert (folder / "original.upload").read_bytes() == original
    assert len(result["history"]) == 2
    assert json.loads((folder / "progress.json").read_text())["stage"] == "finished"
    # Modified originals must abort even when a previous output exists.
    (folder / "original.upload").chmod(0o600)
    (folder / "original.upload").write_bytes(original + b"\n")
    with pytest.raises(ValueError, match="校验"):
        worker.run(store, job)


def test_supervisor_serial_queue_and_running_cancel(tmp_path, monkeypatch):
    import subprocess
    import exafs_compute.api as api
    store = Store(tmp_path / "state")
    first = store.create("mace", {})
    second = store.create("feff", {})
    script = tmp_path / "fake_worker.py"
    script.write_text(
        "import sys,time,json\nfrom pathlib import Path\n"
        "folder=Path(sys.argv[1])/'jobs'/sys.argv[2]\n"
        "if sys.argv[3]=='mace': time.sleep(20)\n"
        "(folder/'result.json').write_text(json.dumps({'kind':sys.argv[3]}))\n")
    real_popen = subprocess.Popen
    processes = []

    def popen(command, **kwargs):
        assert not any(p.poll() is None for p in processes)
        assert "EXAFS_API_TOKEN" not in kwargs["env"]
        kind = "mace" if command[2] == "exafs_compute.mace_worker" else "feff"
        process = real_popen([sys.executable, str(script), command[3], command[4], kind], **kwargs)
        processes.append(process)
        return process

    monkeypatch.setenv("EXAFS_API_TOKEN", TOKEN)
    monkeypatch.setattr(api.subprocess, "Popen", popen)
    supervisor = Supervisor(store)
    supervisor.thread.start()
    try:
        deadline = time.monotonic() + 5
        while store.get(first["id"])["state"] != "running" and time.monotonic() < deadline:
            time.sleep(.02)
        assert store.get(second["id"])["state"] == "queued"
        write_json(store.folder(first["id"]) / "cancel.request", {"requested": True})
        while store.get(second["id"])["state"] == "queued" and time.monotonic() < deadline:
            time.sleep(.02)
        while store.get(second["id"])["state"] == "running" and time.monotonic() < deadline:
            time.sleep(.02)
        assert store.get(first["id"])["state"] == "interrupted"
        assert store.get(second["id"])["state"] == "succeeded"
        assert len(processes) == 2
    finally:
        supervisor.stop.set()
        supervisor.thread.join(5)
