"""Install the additive FDMNES adapter; backups before code edits, no experimental data edits."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
import zipfile

OFFICIAL = 'https://hub.neel.cnrs.fr/index.php/s/tyYAf2QN5nnsDRs/download'

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--base', default='/opt/exafs-app/exafs-compute-v1')
    p.add_argument('--engine', help='Existing official Linux FDMNES executable')
    p.add_argument('--download-engine', action='store_true')
    p.add_argument('--restart', action='store_true', help='Restart only an identified idle exafs API PID')
    args = p.parse_args()
    base = Path(args.base).resolve()
    module = base / 'exafs_compute'
    api = module / 'api.py'
    engine = module / 'engine.py'
    if not api.is_file() or not engine.is_file():
        raise SystemExit('未找到现有 exafs-compute-v1；请核对 --base')
    import fastapi, ase, uvicorn
    pidfile = base / 'api.pid'
    oldpid = int(pidfile.read_text()) if pidfile.exists() else None
    if args.restart and oldpid and Path(f'/proc/{oldpid}/cmdline').exists():
        cmd = Path(f'/proc/{oldpid}/cmdline').read_bytes()
        if b'uvicorn' not in cmd or b'exafs_compute.api:create_app' not in cmd:
            raise SystemExit('PID 不属于预期接口；不会停止它')
        state = base.parent / 'compute-private'
        for line in (base / 'private.env').read_text().splitlines():
            if line.startswith('EXAFS_STATE_DIR='):
                state = Path(line.split('=',1)[1])
        if (state / 'queue.sqlite3').is_file():
            import sqlite3
            with sqlite3.connect(state / 'queue.sqlite3') as db:
                if db.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','running')").fetchone()[0]:
                    raise SystemExit('仍有排队/运行任务，未安装或重启；等待完成后重试')
    existing_path = base / 'fdmnes_path.txt'
    existing_binary = os.environ.get('FDMNES_BIN') or (existing_path.read_text().strip() if existing_path.is_file() else '')
    binary = Path(args.engine or existing_binary).resolve() if (args.engine or existing_binary) else None
    if args.download_engine:
        target = base / 'fdmnes-engine'
        target.mkdir(exist_ok=True)
        archive = target / 'official-linux.zip'
        print('从 FDMNES 官方发布地址下载 Linux 版本；不会改写实验文件。', flush=True)
        with urllib.request.urlopen(OFFICIAL, timeout=90) as src, archive.open('wb') as dst:
            shutil.copyfileobj(src, dst)
        with zipfile.ZipFile(archive) as z:
            candidates = [n for n in z.namelist() if Path(n).name.lower() in {'fdmnes_linux', 'fdmnes', 'fdmnes_linux64'} and not n.endswith('/')]
            if len(candidates) != 1:
                raise SystemExit('官方包中可执行文件名称不唯一；请解压后用 --engine 明确指定')
            binary = target / 'fdmnes'
            with z.open(candidates[0]) as src, binary.open('wb') as dst:
                shutil.copyfileobj(src, dst)
        binary.chmod(0o755)
    if not binary or not binary.is_file() or not os.access(binary, os.X_OK):
        raise SystemExit('未找到既有 FDMNES 引擎。已有引擎请用 --engine /绝对路径/fdmnes；首次安装可加 --download-engine。尚未修改后台。')
    check = subprocess.run(['ldd', str(binary)], capture_output=True, text=True)
    if 'not found' in check.stdout:
        print(check.stdout)
        raise SystemExit('缺少引擎动态库；补齐后重试，尚未修改接口')
    a = api.read_text(); e = engine.read_text()
    insert_api = '    from .fdmnes import register_fdmnes\n    register_fdmnes(app, store)\n\n'
    if 'register_fdmnes(app, store)' not in a:
        if a.count('    return app') != 1:
            raise SystemExit('API 版本不匹配；不会猜测代码插入位置')
        a = a.replace('    return app', insert_api+'    return app')
    needle = '    if job["kind"] not in routines:'
    if 'routines["fdmnes"]' not in e:
        if e.count(needle) != 1:
            raise SystemExit('Engine 版本不匹配；不会猜测插入位置')
        e = e.replace(needle, '    from .fdmnes import run_fdmnes\n    routines["fdmnes"] = run_fdmnes\n'+needle)
    compile(a, str(api), 'exec'); compile(e, str(engine), 'exec')
    backup = base / ('fdmnes-code-backup-'+time.strftime('%Y%m%dT%H%M%S'))
    backup.mkdir(exist_ok=False)
    for original in [api,engine]:
        shutil.copy2(original, backup/original.name)
    if (module/'fdmnes.py').exists(): shutil.copy2(module/'fdmnes.py',backup/'fdmnes.py')
    shutil.copy2(Path(__file__).with_name('fdmnes.py'), module/'fdmnes.py')
    api.write_text(a); engine.write_text(e)
    (base/'fdmnes_path.txt').write_text(str(binary)+'\n')
    print('扩展已安装；原接口代码备份：', backup)
    print('FDMNES 可执行文件 SHA-256：', hashlib.sha256(binary.read_bytes()).hexdigest())
    print('FDMNES 扩展 v2 已写入：自定义能量网格、展宽和原生阶段日志。')
    print('原生 FDMNES 仍需使用真实任务验收，安装成功不等于数值验证。')
    if args.restart:
        if oldpid and Path(f'/proc/{oldpid}/cmdline').exists():
            os.kill(oldpid, signal.SIGTERM)
            for _ in range(40):
                if not Path(f'/proc/{oldpid}/cmdline').exists() or not Path(f'/proc/{oldpid}/cmdline').read_bytes(): break
                time.sleep(.25)
            else: raise SystemExit('旧服务未停止，未强制结束；请检查日志')
        try:
            subprocess.run([sys.executable,str(base/'scripts/start_local.py')],cwd=base,check=True)
            import json
            settings = dict(line.split('=',1) for line in (base/'private.env').read_text().splitlines() if '=' in line)
            request = urllib.request.Request('http://127.0.0.1:8001/v1/fdmnes/capabilities', headers={'Authorization':'Bearer '+settings['EXAFS_API_TOKEN']})
            with urllib.request.urlopen(request,timeout=10) as response:
                info = json.load(response)
            if info.get('protocol') != 2:
                raise RuntimeError('重启后扩展协议不是 v2')
            print('FDMNES 扩展 v2 接口检查通过；原密钥和隧道保持不变。')
        except Exception:
            print('扩展重启检查失败，原文件备份位于：', backup)
            raise
    else: print('请在没有任务运行时重新启动现有计算接口，以加载扩展。')

if __name__=='__main__': main()
