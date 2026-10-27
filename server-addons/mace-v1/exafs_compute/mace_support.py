"""MACE deployment constants and structure inspection; no torch import in the API."""
import hashlib
from pathlib import Path

ADDON_VERSION = "1.0.0"
MACE_PYTHON = Path("/opt/mace-app/.venv/bin/python")
MODEL = Path("/opt/mace-app/models/mace-mp-0b2-small.model")
MODEL_SHA256 = "d5773bf9440e96d6eb8c598f84bd0e6369fcfa432f626a87f890e07da3c651c9"
MAX_ATOMS = 200
DOWNLOADS = {
    "optimized.vasp", "optimized.extxyz", "optimized.cif",
    "trajectory.traj", "optimization.log", "progress.json",
}


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def capability():
    return {
        "version": ADDON_VERSION,
        "available": MACE_PYTHON.is_file() and MODEL.is_file(),
        "model": "MACE-MP-0b2-small",
        "max_atoms": MAX_ATOMS,
        "max_steps": 300,
        "threads": 1,
        "fixed_cell": True,
        "preserve_constraints": True,
    }


def inspect_atoms(atoms):
    import numpy as np
    from ase.constraints import FixAtoms, FixScaled

    if not 1 <= len(atoms) <= MAX_ATOMS:
        raise ValueError(f"当前服务器支持 1–{MAX_ATOMS} 原子的 MACE 任务")
    if not np.isfinite(atoms.positions).all() or not np.isfinite(atoms.cell.array).all():
        raise ValueError("坐标或晶胞包含非有限值")
    if atoms.pbc.any() and abs(np.linalg.det(atoms.cell.array)) < 1e-5:
        raise ValueError("周期结构需要有效晶胞")
    occupancy = atoms.info.get("occupancy", {})
    if any(len(v) != 1 or any(abs(float(x) - 1) > 1e-6 for x in v.values())
           for v in occupancy.values()):
        raise ValueError("请先明确 CIF 的部分占位或混合占位")
    fixed, partial = set(), set()
    for constraint in atoms.constraints:
        indices = set(map(int, constraint.get_indices()))
        if isinstance(constraint, FixAtoms):
            fixed.update(indices)
        elif isinstance(constraint, FixScaled):
            if constraint.mask.all():
                fixed.update(indices)
            elif constraint.mask.any():
                partial.update(indices)
        else:
            raise ValueError("当前版本仅支持 FixAtoms 和 FixScaled 约束")
    if len(fixed) == len(atoms):
        raise ValueError("全部原子均已固定，没有可优化的原子")
    return {
        "atom_count": len(atoms), "formula": atoms.get_chemical_formula(),
        "fixed_count": len(fixed), "partial_count": len(partial - fixed),
        "movable_count": len(atoms) - len(fixed),
        "pbc": atoms.pbc.tolist(), "cell": atoms.cell.array.tolist(),
        "fully_fixed_indices": sorted(fixed),
        "constraints": [str(c) for c in atoms.constraints],
    }


def inspect_parent(store, job_id):
    from ase.io import read
    parent = store.parent(job_id, "structure")
    store.verify_original(job_id)
    atoms = read(str(store.folder(job_id) / "atoms.json"), format="json")
    return parent, inspect_atoms(atoms)
