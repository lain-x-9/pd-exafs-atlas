import asyncio
import fcntl
import hmac
import json
import os
import signal
import subprocess
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import ValidationError

from . import __version__
from .models import FeffRequest, FitRequest
from .store import Store
from .mace_support import DOWNLOADS, MACE_PYTHON, capability
from .mace_api import enrich, install as install_mace

BASE = Path(__file__).resolve().parent.parent


class Supervisor:
    def __init__(self, store):
        self.store = store
        self.stop = threading.Event()
        self.process = None
        self.thread = threading.Thread(target=self.loop, daemon=True)

    def loop(self):
        while not self.stop.is_set():
            job_id = self.store.claim()
            if job_id is None:
                self.stop.wait(0.25)
                continue
            folder = self.store.folder(job_id)
            is_mace = self.store.get(job_id)["kind"] == "mace"
            try:
                env = os.environ.copy()
                # The numerical worker does not need the HTTP authentication token.
                env.pop("EXAFS_API_TOKEN", None)
                env.update(MPLBACKEND="Agg", OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1",
                           MKL_NUM_THREADS="1", NUMEXPR_NUM_THREADS="1", PYTHONUNBUFFERED="1")
                with (folder / "worker.log").open("wb") as log:
                    self.process = subprocess.Popen(
                        [str(MACE_PYTHON) if is_mace else sys.executable, "-m",
                         "exafs_compute.mace_worker" if is_mace else "exafs_compute.engine",
                         str(self.store.root), job_id],
                        cwd=BASE, env=env, stdout=log, stderr=subprocess.STDOUT,
                        start_new_session=True,
                    )
                    start = time.monotonic()
                    while self.process.poll() is None:
                        if is_mace and (folder / "cancel.request").exists():
                            raise InterruptedError("用户取消了任务")
                        if is_mace:
                            try:
                                status = Path(f"/proc/{self.process.pid}/status").read_text()
                                rss = next((int(line.split()[1]) for line in status.splitlines()
                                            if line.startswith("VmRSS:")), 0)
                                if rss > 2304 * 1024:
                                    raise MemoryError("MACE 内存超过 2304 MiB 上限，已停止")
                            except FileNotFoundError:
                                pass
                        if self.stop.wait(0.25):
                            raise InterruptedError("服务停止，任务已中断")
                        if time.monotonic() - start > 1200:
                            raise TimeoutError("任务超过 20 分钟上限，已停止")
                        if (folder / "worker.log").stat().st_size > 32 * 1024 * 1024:
                            raise RuntimeError("日志超过 32 MB 上限，已停止")
                    if is_mace and (folder / "cancel.request").exists():
                        raise InterruptedError("用户取消了任务")
                    if self.process.returncode != 0 or not (folder / "result.json").is_file():
                        raise RuntimeError("计算失败；请查看 worker.log")
                self.store.finish(job_id, "succeeded")
            except Exception as exc:
                if self.process and self.process.poll() is None:
                    try:
                        os.killpg(self.process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    self.process.wait()
                state = "interrupted" if isinstance(exc, InterruptedError) else "failed"
                self.store.finish(job_id, state, str(exc))
            finally:
                self.process = None


def create_app(root=None, token=None, run_worker=True):
    root = root or os.environ.get("EXAFS_STATE_DIR", "/opt/exafs-app/compute-private")
    token = token or os.environ.get("EXAFS_API_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("缺少私有访问令牌，请用 scripts/start_local.py 启动")
    store = Store(root)

    @asynccontextmanager
    async def lifespan(app):
        # Multiple API workers would duplicate numerical jobs. Hold one process-wide lock.
        lock = (store.root / "service.lock").open("a")
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            lock.close()
            raise RuntimeError("该状态目录已有一个接口服务在运行")
        supervisor = Supervisor(store)
        store.recover()
        if run_worker:
            supervisor.thread.start()
        try:
            yield
        finally:
            supervisor.stop.set()
            if run_worker:
                await asyncio.to_thread(supervisor.thread.join, 10)
            lock.close()

    async def private(authorization: Annotated[str | None, Header()] = None):
        supplied = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
        if not hmac.compare_digest(supplied.encode(), token.encode()):
            raise HTTPException(401, "需要私有访问令牌", headers={"WWW-Authenticate": "Bearer"})

    app = FastAPI(title="Private EXAFS compute", version=__version__, lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None,
                  dependencies=[Depends(private)])
    app.state.store = store

    @app.get("/health")
    def health():
        return {"ok": True, "version": __version__, "queue": "single_worker", "engine_tested": False, "capabilities": {"mace": capability()},
                "note": "健康检查仅确认接口运行，数值引擎须通过端到端测试"}

    def get_job(job_id):
        try:
            return enrich(store, store.get(job_id))
        except (ValueError, KeyError):
            raise HTTPException(404, "任务不存在")

    def require_parent(job_id, kind):
        try:
            return store.parent(job_id, kind)
        except (ValueError, KeyError) as exc:
            raise HTTPException(422, str(exc))

    async def uploaded(file, limit):
        try:
            value = await file.read(limit + 1)
            if not value:
                raise HTTPException(422, "上传文件为空")
            if len(value) > limit:
                raise HTTPException(413, f"上传文件超过 {limit // 1024 // 1024} MB")
            return value
        finally:
            await file.close()

    def enqueue(kind, request, data=None, filename=None):
        try:
            return store.create(kind, request, data, filename)
        except ValueError as exc:
            raise HTTPException(429, str(exc))

    @app.post("/v1/structures", status_code=202)
    async def structure(file: Annotated[UploadFile, File()],
                        format: Annotated[Literal["cif", "vasp", "xyz"], Form()]):
        name = file.filename
        data = await uploaded(file, 2 * 1024 * 1024)
        return enqueue("structure", {"format": format}, data, name)

    @app.post("/v1/feff", status_code=202)
    def feff(request: FeffRequest):
        parent = require_parent(request.structure_job, "structure")
        if request.absorber_index >= parent["result"]["atom_count"]:
            raise HTTPException(422, "吸收原子序号超出范围；本接口使用从 0 开始的序号")
        return enqueue("feff", request.model_dump())

    @app.post("/v1/fits", status_code=202)
    async def fit(file: Annotated[UploadFile, File()], config: Annotated[str, Form(max_length=40000)]):
        try:
            request = FitRequest.model_validate_json(config)
        except (ValidationError, ValueError) as exc:
            await file.close()
            raise HTTPException(422, str(exc))
        parent = require_parent(request.feff_job, "feff")
        available = {p["filename"]: p for p in parent["result"]["paths"]}
        if request.kmax > parent["request"]["kmax"]:
            raise HTTPException(422, "拟合 k 上限超过该 FEFF 任务设置的 k 上限")
        for p in request.paths:
            if p.filename not in available:
                raise HTTPException(422, f"该 FEFF 任务没有路径 {p.filename}")
            if p.coordination is not None and available[p.filename]["nleg"] != 2:
                raise HTTPException(422, "多重散射路径不能直接按单壳层有效配位数缩放")
        name = file.filename
        data = await uploaded(file, 8 * 1024 * 1024)
        return enqueue("fit", request.model_dump(), data, name)

    @app.get("/v1/jobs/{job_id}")
    def job(job_id: str):
        return get_job(job_id)

    @app.get("/v1/jobs/{job_id}/log", response_class=PlainTextResponse)
    def log(job_id: str):
        get_job(job_id)
        path = store.folder(job_id) / "worker.log"
        if not path.exists():
            return "任务尚未开始\n"
        with path.open("rb") as fh:
            fh.seek(max(0, path.stat().st_size - 128 * 1024))
            return fh.read().decode("utf-8", errors="replace")

    @app.get("/v1/jobs/{job_id}/files/{filename}")
    def download(job_id: str, filename: str):
        get_job(job_id)
        allowed = {"request.json", "result.json", "upload.json", "original.upload", "worker.log",
                   "fit_report.txt", "fit_comparison.png", "curves.dat", "curves.json",
                   "feff.inp", "cluster.json"}
        import re
        if filename not in (allowed | DOWNLOADS) and not re.fullmatch(r"feff[0-9]{4}\.dat", filename):
            raise HTTPException(404, "文件不存在")
        path = store.folder(job_id) / filename
        if not path.is_file():
            raise HTTPException(404, "文件尚未生成")
        return FileResponse(path, filename=filename, headers={"Cache-Control": "no-store"})

    @app.middleware("http")
    async def no_cache(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    install_mace(app, store)
    return app
