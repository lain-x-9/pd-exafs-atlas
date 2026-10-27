"""Install the additive MACE bridge into the verified EXAFS 0.1.0 backend."""
import argparse
import hashlib
import json
import os
import py_compile
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

BASELINE = {
    "exafs_compute/api.py": "3989bc33c92360922e50f9eba5b6448fbb841dbdb9b8f674f9cbd4279252e1fa",
    "exafs_compute/store.py": "1932df02900ba66cca4c041b9472ffa613085fe86826df254a7d7abbf6b64507",
    "exafs_compute/engine.py": "b2f36468c9f1b2e36e1664ed8a520d3e9ca875a7389d233b3029193c7fb80d91",
    "scripts/start_local.py": "ef2666410889848a78c9610a2be038b871f166c5a86ea0f91b978888febccea7",
}
PAYLOAD = (
    "exafs_compute/api.py", "exafs_compute/mace_api.py",
    "exafs_compute/mace_support.py", "exafs_compute/mace_worker.py",
)
MODEL_SHA = "d5773bf9440e96d6eb8c598f84bd0e6369fcfa432f626a87f890e07da3c651c9"
FD_API = "    from .fdmnes import register_fdmnes\n    register_fdmnes(app, store)\n\n"
FD_ENGINE = '    from .fdmnes import run_fdmnes\n    routines["fdmnes"] = run_fdmnes\n'


def normalized_bytes(path, name):
    value = Path(path).read_bytes()
    # Recognize only the exact additive adapter delivered by the same Site.
    # Any other source modification still fails the baseline check.
    if name == "exafs_compute/api.py":
        value = value.replace(FD_API.encode(), b"")
    elif name == "exafs_compute/engine.py":
        value = value.replace(FD_ENGINE.encode(), b"")
    return value


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def settings(root):
    values = {}
    for line in (root / "private.env").read_text().splitlines():
        if line and "=" in line:
            k, v = line.split("=", 1)
            values[k] = v
    if len(values.get("EXAFS_API_TOKEN", "")) < 32:
        raise RuntimeError("缺少既有接口密钥；安装程序不会创建或更换密钥")
    return values


def health(config):
    req = urllib.request.Request("http://127.0.0.1:8001/health",
        headers={"Authorization": "Bearer " + config["EXAFS_API_TOKEN"]})
    try:
        with urllib.request.urlopen(req, timeout=3) as response:
            return json.load(response)
    except urllib.error.HTTPError:
        raise RuntimeError("8001 端口已有其他服务或密钥不匹配")
    except urllib.error.URLError:
        return None


def idle(config):
    db_path = Path(config["EXAFS_STATE_DIR"]) / "queue.sqlite3"
    if db_path.exists():
        with sqlite3.connect(db_path.resolve().as_uri() + "?mode=ro", uri=True) as db:
            count = db.execute(
                "SELECT COUNT(*) FROM jobs WHERE state IN ('queued','running')").fetchone()[0]
        if count:
            raise RuntimeError("仍有排队或运行任务；请待任务结束后重新安装")


def stop(root, config):
    if health(config) is None:
        return
    pid = int((root / "api.pid").read_text().strip())
    proc = Path(f"/proc/{pid}")
    command = (proc / "cmdline").read_bytes().split(b"\0")
    if b"exafs_compute.api:create_app" not in command or (proc / "cwd").resolve() != root:
        raise RuntimeError("PID 文件与现有接口进程不匹配，未停止任何进程")
    idle(config)
    os.kill(pid, signal.SIGTERM)
    for _ in range(80):
        if not proc.exists():
            break
        time.sleep(0.25)
    else:
        raise RuntimeError("原接口尚未退出，未覆盖文件")
    if health(config) is not None:
        raise RuntimeError("原接口端口仍被占用")


def start(root):
    env = os.environ.copy()
    env.update(MPLBACKEND="Agg", OMP_NUM_THREADS="1",
               OPENBLAS_NUM_THREADS="1", MKL_NUM_THREADS="1")
    completed = subprocess.run(
        [sys.executable, str(root / "scripts/start_local.py")],
        cwd=root, env=env, capture_output=True, text=True, timeout=60)
    if completed.returncode:
        raise RuntimeError("接口启动失败，请查看原 api.log")


def preflight(root, payload):
    for name, expected in BASELINE.items():
        actual = hashlib.sha256(normalized_bytes(root / name, name)).hexdigest()
        replacement = payload / name
        if actual != expected and not (
            name in PAYLOAD and replacement.exists() and actual == digest(replacement)
        ):
            raise RuntimeError(f"文件与已核对版本不同，停止覆盖：{name}")
    for name in PAYLOAD:
        target = root / name
        if name not in BASELINE and target.exists() and digest(target) != digest(payload / name):
            raise RuntimeError(f"存在不同版本的接入文件，停止覆盖：{name}")
        py_compile.compile(str(payload / name), doraise=True)
    model = Path("/opt/mace-app/models/mace-mp-0b2-small.model")
    python = Path("/opt/mace-app/.venv/bin/python")
    if not python.is_file() or not model.is_file() or digest(model) != MODEL_SHA:
        raise RuntimeError("独立 MACE 环境或模型不存在，或模型校验失败")
    checked = subprocess.run(
        [str(python), "-c", "import torch,ase; from mace.calculators import MACECalculator"],
        env={**os.environ, "OMP_NUM_THREADS": "1", "OPENBLAS_NUM_THREADS": "1"},
        capture_output=True, timeout=60)
    if checked.returncode:
        raise RuntimeError("独立 MACE 环境导入检查失败；未修改后台")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/opt/exafs-app/exafs-compute-v1")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    payload = Path(__file__).resolve().parent
    preflight(root, payload)
    config = settings(root)
    idle(config)
    print("源代码、MACE 环境、模型和空闲队列检查通过")
    if not args.apply:
        print("只读检查完成；未修改后台")
        return
    backups = root / "_mace_patch_backups"
    backups.mkdir(exist_ok=True, mode=0o700)
    backup = Path(tempfile.mkdtemp(prefix="install_", dir=backups))
    existed = {}
    for name in PAYLOAD:
        target = root / name
        existed[name] = target.exists()
        if target.exists():
            copy = backup / name
            copy.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, copy)
    stopped = False
    try:
        stop(root, config)
        stopped = True
        for name in PAYLOAD:
            target = root / name
            tmp = target.with_suffix(".mace-install-tmp")
            if name == "exafs_compute/api.py" and FD_API in target.read_text():
                value = (payload / name).read_text()
                tmp.write_text(value.replace("    return app\n", FD_API + "    return app\n"))
            else:
                shutil.copy2(payload / name, tmp)
            os.replace(tmp, target)
        start(root)
        info = health(config)
        if not info or info.get("capabilities", {}).get("mace", {}).get("version") != "1.0.0":
            raise RuntimeError("新版接口健康检查失败")
    except Exception:
        if stopped:
            stop(root, config)
            for name in PAYLOAD:
                target = root / name
                if existed[name]:
                    shutil.copy2(backup / name, target)
                else:
                    target.unlink(missing_ok=True)
            start(root)
            print("更新失败，已恢复原代码并启动原接口")
        raise
    print("MACE 接入安装成功")
    print("接口版本：", info["version"])
    print("MACE 接入版本：", info["capabilities"]["mace"]["version"])
    print("原代码备份：", backup)
    print("原密钥、状态目录和隧道进程均保留；网页继续使用原连接设置")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("安装停止：", str(exc), file=sys.stderr)
        sys.exit(1)
