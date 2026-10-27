"""Executed only with /opt/mace-app/.venv/bin/python, in the shared serial queue."""
import fcntl
import json
import resource
import sys
import time
import traceback
from importlib.metadata import version
from pathlib import Path

from .mace_support import MODEL, MODEL_SHA256, inspect_atoms, sha256
from .store import Store, write_json


def run(store, job):
    import numpy as np
    import torch
    from ase.constraints import FixScaled
    from ase.io import read, write
    from ase.optimize import LBFGS
    from mace.calculators import MACECalculator

    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    req = job["request"]
    folder = store.folder(job["id"])
    lock = Path("/opt/mace-app/mace.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError("另一个命令行 MACE 任务正在运行，请稍后重新提交")
    try:
        if sha256(MODEL) != MODEL_SHA256:
            raise RuntimeError("MACE 模型 SHA256 校验失败")
        store.verify_original(job["id"])
        store.verify_original(req["structure_job"])
        images = read(str(folder / "original.upload"), format=req["format"], index=":")
        if len(images) != 1:
            raise ValueError("每个任务必须只包含一个结构")
        atoms = images[0]
        summary = inspect_atoms(atoms)
        original_positions = atoms.positions.copy()
        original_cell = atoms.cell.array.copy()
        scaled = atoms.get_scaled_positions(wrap=False) if atoms.cell.rank == 3 else None
        fixed = np.array(summary["fully_fixed_indices"], dtype=int)
        t0 = time.monotonic()
        write_json(folder / "progress.json",
                   {"stage": "loading", "step": 0, "max_steps": req["steps"]})
        calc = MACECalculator(model_paths=str(MODEL), device="cpu", default_dtype="float32")
        supported = set(map(int, calc.models[0].atomic_numbers.tolist()))
        if not set(map(int, atoms.numbers)).issubset(supported):
            raise ValueError("结构包含此模型不支持的元素")
        atoms.calc = calc
        history = []
        opt = LBFGS(atoms, maxstep=req["maxstep"], logfile=str(folder / "optimization.log"),
                    trajectory=str(folder / "trajectory.traj"))

        def record():
            if (folder / "cancel.request").exists():
                raise InterruptedError("用户取消了任务")
            energy = float(atoms.get_potential_energy())
            forces = atoms.get_forces()
            if not np.isfinite(energy) or not np.isfinite(forces).all():
                raise RuntimeError("优化中出现非有限能量或受力")
            row = {
                "step": opt.nsteps, "energy_ev": energy,
                "fmax_ev_a": float(np.linalg.norm(forces, axis=1).max()),
                "elapsed_seconds": time.monotonic() - t0,
            }
            history.append(row)
            write_json(folder / "progress.json",
                       {**row, "stage": "optimizing", "max_steps": req["steps"]})
            print(json.dumps(row), flush=True)

        opt.attach(record, interval=1)
        converged = bool(opt.run(fmax=req["fmax"], steps=req["steps"]))
        if (folder / "cancel.request").exists():
            raise InterruptedError("用户取消了任务")
        fixed_shift = float(np.linalg.norm(
            atoms.positions[fixed] - original_positions[fixed], axis=1).max()) if len(fixed) else 0.0
        cell_shift = float(np.abs(atoms.cell.array - original_cell).max())
        if fixed_shift > 1e-9 or cell_shift > 1e-9:
            raise RuntimeError("固定原子或晶胞发生了非预期变化")
        for c in atoms.constraints:
            if isinstance(c, FixScaled) and scaled is not None:
                delta = (atoms.get_scaled_positions(wrap=False) - scaled)[c.get_indices()]
                if np.abs(delta[:, c.mask]).max(initial=0) > 1e-9:
                    raise RuntimeError("部分固定方向发生了非预期变化")
        write(str(folder / "optimized.extxyz"), atoms, format="extxyz")
        files = ["optimized.extxyz", "trajectory.traj", "optimization.log"]
        if atoms.cell.rank == 3:
            write(str(folder / "optimized.vasp"), atoms, format="vasp",
                  direct=True, sort=False, vasp5=True)
            write(str(folder / "optimized.cif"), atoms, format="cif")
            files += ["optimized.vasp", "optimized.cif"]
        store.verify_original(job["id"])
        store.verify_original(req["structure_job"])
        warnings = [
            "MACE 预优化结构是候选结构；运行成功不代表模型精度或实验结构已获验证。",
            "本模型采用其预训练势能面，不等同于用户指定的 VASP 泛函、U、磁性或溶剂设置。",
            "CIF 不保存本次固定原子约束；继续优化请使用 VASP 或 ASE 轨迹。",
            "VASP/CIF 重读通常默认为三维周期；部分周期或非周期结构优先使用 ASE 轨迹保留边界条件。",
        ]
        if not converged:
            warnings.append("达到最大步数，尚未达到本次力阈值；输出为未收敛预优化结构。")
        result = {
            "kind": "mace", **summary, "converged": converged, "steps": opt.nsteps,
            "target_fmax": req["fmax"], "fmax_ev_a": history[-1]["fmax_ev_a"],
            "initial_energy_ev": history[0]["energy_ev"], "final_energy_ev": history[-1]["energy_ev"],
            "elapsed_seconds": time.monotonic() - t0,
            "peak_rss_mib": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024,
            "fixed_max_displacement_a": fixed_shift, "cell_max_change_a": cell_shift,
            "input": json.loads((folder / "upload.json").read_text()),
            "model": {"name": "MACE-MP-0b2-small", "sha256": MODEL_SHA256,
                      "dtype": "float32", "device": "cpu", "threads": 1},
            "versions": {name: version(name) for name in ("torch", "mace-torch", "ase")},
            "history": history, "files": files, "warnings": warnings,
        }
        write_json(folder / "result.json", result)
        write_json(folder / "progress.json",
                   {**history[-1], "stage": "finished", "converged": converged,
                    "max_steps": req["steps"]})
    finally:
        lock.close()


if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_CPU, (1200, 1200))
    resource.setrlimit(resource.RLIMIT_FSIZE, (128 * 1024**2, 128 * 1024**2))
    resource.setrlimit(resource.RLIMIT_AS, (6 * 1024**3, 6 * 1024**3))
    try:
        state = Store(sys.argv[1])
        run(state, state.get(sys.argv[2]))
    except Exception:
        traceback.print_exc()
        sys.exit(1)
