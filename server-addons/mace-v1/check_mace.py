"""Run an authenticated local HTTP → shared queue → MACE → download check."""
import argparse
import hashlib
import json
import secrets
import time
import urllib.error
import urllib.request
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--format", choices=["vasp", "cif", "xyz"], default="vasp")
    parser.add_argument("--steps", type=int, default=10)
    args = parser.parse_args()
    root = Path("/opt/exafs-app/exafs-compute-v1")
    config = dict(line.split("=", 1) for line in (root / "private.env").read_text().splitlines() if "=" in line)
    token = config["EXAFS_API_TOKEN"]
    original = Path(args.input).read_bytes()

    def call(path, data=None, content_type=None):
        headers = {"Authorization": "Bearer " + token}
        if content_type:
            headers["Content-Type"] = content_type
        request = urllib.request.Request("http://127.0.0.1:8001" + path, data=data, headers=headers)
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.read()

    def wait(job):
        deadline = time.monotonic() + 1250
        previous = None
        while time.monotonic() < deadline:
            value = json.loads(call("/v1/jobs/" + job["id"]))
            progress = value.get("progress", {})
            marker = (value["state"], progress.get("stage"), progress.get("step"))
            if marker != previous:
                print(value["kind"], value["state"], progress, flush=True)
                previous = marker
            if value["state"] == "succeeded":
                return value
            if value["state"] in {"failed", "interrupted"}:
                log = call("/v1/jobs/" + job["id"] + "/log").decode(errors="replace")
                print(log[-6000:])
                raise RuntimeError(value.get("error") or "任务失败")
            time.sleep(1)
        raise TimeoutError("本地检查等待超时，请查看网页任务记录")

    info = json.loads(call("/health"))
    if info.get("capabilities", {}).get("mace", {}).get("version") != "1.0.0":
        raise RuntimeError("MACE 接入未就绪")
    boundary = "macecheck" + secrets.token_hex(16)
    body = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="format"\r\n\r\n'
        f'{args.format}\r\n--{boundary}\r\n'
        'Content-Disposition: form-data; name="file"; filename="validation-input"\r\n'
        'Content-Type: application/octet-stream\r\n\r\n'
    ).encode() + original + f"\r\n--{boundary}--\r\n".encode()
    parsed = wait(json.loads(call("/v1/structures", body, "multipart/form-data; boundary=" + boundary)))
    summary = json.loads(call("/v1/mace/structures/" + parsed["id"]))
    print("结构检查：", summary, flush=True)
    job = json.loads(call("/v1/mace", json.dumps({
        "structure_job": parsed["id"], "steps": args.steps, "fmax": .05, "maxstep": .05,
        "fixed_cell": True, "preserve_constraints": True,
    }).encode(), "application/json"))
    result_job = wait(job)
    saved = call("/v1/jobs/" + job["id"] + "/files/original.upload")
    if hashlib.sha256(saved).digest() != hashlib.sha256(original).digest():
        raise RuntimeError("下载原文件与输入不一致")
    result = result_job["result"]
    for name in result["files"]:
        if not call("/v1/jobs/" + job["id"] + "/files/" + name):
            raise RuntimeError("结果文件下载为空：" + name)
    if Path(args.input).read_bytes() != original:
        raise RuntimeError("原路径输入文件发生改变")
    print("本地接口 → 队列 → 独立 MACE → 结果下载：通过")
    print("MACE任务编号：", job["id"])
    print("达到力阈值：", result["converged"])
    print("最终最大力 / eV/Å：", result["fmax_ev_a"])
    print("峰值内存 / MiB：", result["peak_rss_mib"])
    print("固定原子位移 / Å：", result["fixed_max_displacement_a"])
    print("此检查不代表网页 HTTPS 通道或模型精度已验证")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as exc:
        print("接口检查失败：HTTP", exc.code)
        print(exc.read().decode(errors="replace")[:1500])
        raise SystemExit(1)
