"""Authenticated routes inherit the application's existing private dependency."""
import json
import time
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .mace_support import capability, inspect_parent
from .store import write_json


class MaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    structure_job: str = Field(pattern=r"^[0-9a-f]{32}$")
    steps: int = Field(default=100, ge=1, le=300, strict=True)
    fmax: float = Field(default=0.05, ge=0.03, le=0.2)
    maxstep: float = Field(default=0.05, ge=0.01, le=0.1)
    fixed_cell: Literal[True] = True
    preserve_constraints: Literal[True] = True


def enrich(store, job):
    if job["kind"] == "mace":
        folder = store.folder(job["id"])
        progress = folder / "progress.json"
        if progress.is_file():
            job["progress"] = json.loads(progress.read_text())
        job["cancel_requested"] = (folder / "cancel.request").is_file()
    return job


def install(app, store):
    def mace_job(job_id):
        try:
            job = store.get(job_id)
            if job["kind"] != "mace":
                raise KeyError(job_id)
            return job
        except (ValueError, KeyError):
            raise HTTPException(404, "MACE 任务不存在")

    @app.get("/v1/mace/capabilities")
    def capabilities():
        return capability()

    @app.get("/v1/mace/structures/{job_id}")
    def preview(job_id: str):
        try:
            _, summary = inspect_parent(store, job_id)
            return summary
        except (ValueError, KeyError) as exc:
            raise HTTPException(422, str(exc))

    @app.post("/v1/mace", status_code=202)
    def submit(request: MaceRequest):
        if not capability()["available"]:
            raise HTTPException(503, "MACE 独立环境或模型尚未安装")
        try:
            parent, summary = inspect_parent(store, request.structure_job)
            folder = store.folder(parent["id"])
            upload = json.loads((folder / "upload.json").read_text())
            config = request.model_dump()
            config.update(format=parent["request"]["format"], structure_summary=summary)
            return store.create("mace", config, (folder / "original.upload").read_bytes(),
                                upload["original_filename"])
        except (ValueError, KeyError) as exc:
            raise HTTPException(422, str(exc))

    @app.post("/v1/mace/jobs/{job_id}/cancel")
    def cancel(job_id: str):
        mace_job(job_id)
        with store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT state FROM jobs WHERE id=?", (job_id,)).fetchone()
            if row["state"] == "queued":
                db.execute("UPDATE jobs SET state='interrupted',finished=?,error=? WHERE id=?",
                           (time.time(), "用户取消了排队任务", job_id))
            elif row["state"] == "running":
                write_json(store.folder(job_id) / "cancel.request", {"requested": time.time()})
        return enrich(store, store.get(job_id))
