"""FDMNES extension for exafs-compute 0.1.0. No shell commands or mutable originals."""
import hashlib
import json
import os
import re
import subprocess
import time
from pathlib import Path

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal

BASE = Path(__file__).resolve().parent.parent
PROTOCOL = 2

class FdmnesRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    structure_job: str = Field(pattern=r'^[0-9a-f]{32}$')
    absorber_index: int = Field(ge=0, le=999)
    edge: Literal['K', 'L1', 'L2', 'L3'] = 'K'
    radius: float = Field(default=4.0, ge=3, le=6)
    method: Literal['finite_difference', 'green'] = 'finite_difference'
    scf: bool = True
    emin: float = Field(default=-20, ge=-200, le=2000)
    emax: float = Field(default=120, ge=-200, le=2000)
    step: float = Field(default=.5, ge=.05, le=10)
    gaussian: float = Field(default=0, ge=0, le=10)
    broadening: Literal['native', 'none'] = 'native'
    gamma_hole: float | None = Field(default=None, gt=0, le=50)
    gamma_max: float | None = Field(default=None, ge=0, le=100)
    ecent: float | None = Field(default=None, gt=0, le=500)
    elarg: float | None = Field(default=None, gt=0, le=500)
    reviewed: Literal[True]

    @model_validator(mode='after')
    def range_and_broadening(self):
        if self.emax <= self.emin:
            raise ValueError('计算能量上限必须大于下限')
        points = int((self.emax - self.emin) / self.step) + 1
        if not 40 <= points <= 6000:
            raise ValueError('计算能量网格需为 40–6000 点，请调整范围或步长')
        if self.broadening == 'none' and (self.gaussian or any(
                v is not None for v in (self.gamma_hole, self.gamma_max, self.ecent, self.elarg))):
            raise ValueError('不展宽模式不能同时指定卷积参数')
        return self

def executable():
    candidate = os.environ.get('FDMNES_BIN')
    pathfile = BASE / 'fdmnes_path.txt'
    if not candidate and pathfile.is_file():
        candidate = pathfile.read_text().strip()
    path = Path(candidate).resolve() if candidate else BASE / 'bin' / 'fdmnes'
    return path if path.is_file() and os.access(path, os.X_OK) else None

def register_fdmnes(app, store):
    @app.get('/v1/fdmnes/capabilities')
    def capabilities():
        path = executable()
        return {'protocol': PROTOCOL, 'engine': 'FDMNES', 'installed': path is not None,
                'engine_tested': False, 'progress': True, 'custom_scan': True,
                'broadening_modes': ['native', 'none'],
                'limits': {'energy_min': -200, 'energy_max': 2000, 'step_min': .05,
                           'step_max': 10, 'points_min': 40, 'points_max': 6000},
                'methods': ['finite_difference', 'green'],
                'note': '可执行文件存在不等于完成数值验证；需提交真实任务检查原生输出。'}

    @app.get('/v1/fdmnes/{job_id}/progress')
    def progress(job_id: str):
        try:
            job = store.get(job_id)
        except (KeyError, ValueError):
            raise HTTPException(404, '任务不存在')
        if job['kind'] != 'fdmnes':
            raise HTTPException(404, '任务不存在')
        folder = store.folder(job_id)
        value = {}
        path = folder / 'fdmnes_progress.json'
        if path.is_file():
            value = json.loads(path.read_text())
        logs = {}
        for name in ('fdmnes.log', 'worker.log'):
            log = folder / name
            if log.is_file():
                with log.open('rb') as stream:
                    stream.seek(max(0, log.stat().st_size - 32768))
                    logs[name] = stream.read().decode('utf-8', errors='replace')
        return {'progress': value, 'logs': logs, 'precise_percent': False}

    @app.post('/v1/fdmnes', status_code=202)
    def enqueue(request: FdmnesRequest):
        if executable() is None:
            raise HTTPException(409, '尚未安装 FDMNES 引擎或未配置路径')
        try:
            parent = store.parent(request.structure_job, 'structure')
        except (ValueError, KeyError) as exc:
            raise HTTPException(422, str(exc))
        if request.absorber_index >= parent['result']['atom_count']:
            raise HTTPException(422, '吸收原子序号超出本次解析结构范围')
        try:
            return store.create('fdmnes', request.model_dump())
        except ValueError as exc:
            raise HTTPException(429, str(exc))

    @app.get('/v1/fdmnes/{job_id}/files/{name}')
    def files(job_id: str, name: str):
        from fastapi.responses import FileResponse
        try:
            job = store.get(job_id)
        except (KeyError, ValueError):
            raise HTTPException(404, '任务不存在')
        allowed = {'fdmnes.inp', 'fdmfile.txt', 'xanes.json', 'fdmnes.log', 'xanes_conv.txt',
                   'xanes_raw.txt', 'xanes_bav.txt', 'xanes_theory.txt', 'fdmnes_progress.json',
                   'result.json', 'request.json', 'structure_source.json'}
        if job['kind'] != 'fdmnes' or name not in allowed:
            raise HTTPException(404, '文件不存在')
        path = store.folder(job_id) / name
        if not path.is_file():
            raise HTTPException(404, '文件尚未生成')
        return FileResponse(path, filename=name, headers={'Cache-Control': 'no-store'})

def input_text(atoms, req):
    import numpy as np
    cell = atoms.cell.cellpar()
    if not atoms.pbc.all() or np.linalg.det(atoms.cell.array) <= 1e-5:
        raise ValueError('首版 FDMNES 接受完整三维周期晶胞；请核对 CIF、真空层与周期设置')
    frac = atoms.get_scaled_positions(wrap=False)
    if not np.isfinite(frac).all():
        raise ValueError('非有限分数坐标')
    lines = ['! Derived from immutable parsed CIF; one explicitly selected absorber.',
             'Filout', 'xanes', 'Range', f'{req.emin:.6f} {req.step:.6f} {req.emax:.6f}',
             'Radius', f'{req.radius:.6f}', 'Edge', req.edge,
             'Absorber', str(req.absorber_index + 1), 'Crystal',
             ' '.join(f'{v:.10f}' for v in cell)]
    lines += [f'{int(z)} '+ ' '.join(f'{v:.12f}' for v in p) for z, p in zip(atoms.numbers, frac)]
    if req.method == 'green':
        lines += ['Green']
    if req.scf:
        lines += ['SCF']
    # Explicit relative-to-Fermi axis (no Energpho), isotropic E1E1 output; convolution follows the explicit request.
    if req.broadening == 'native':
        lines += ['Convolution', 'Estart', f'{req.emin:.6f}']
        if req.gaussian > 0:
            lines += ['Gaussian', f'{req.gaussian:.6f}']
        for keyword, value in [('Gamma_hole', req.gamma_hole), ('Gamma_max', req.gamma_max),
                               ('Ecent', req.ecent), ('Elarg', req.elarg)]:
            if value is not None:
                lines += [keyword, f'{value:.6f}']
    lines += ['Header', 'End', '']
    return '\n'.join(lines)

def parse_output(text):
    import math
    header = None
    rows = []
    for line in text.splitlines():
        fields = line.strip().lstrip('#!').split()
        if fields and fields[0].lower() in {'energy', 'energ', 'e'}:
            columns = [v.strip('<>_').lower() for v in fields]
            if 'xanes' in columns:
                header = (len(fields), columns.index('xanes'))
                rows = []
            continue
        if header is None or not fields:
            continue
        try:
            values = [float(s.replace('D', 'E').replace('d', 'e')) for s in fields]
        except ValueError:
            if rows:
                raise ValueError('FDMNES 数值表内含非数值行；不静默删除')
            continue
        if len(values) != header[0] or not all(math.isfinite(v) for v in values):
            raise ValueError('FDMNES 输出列数或有限值检查失败')
        if rows and values[0] <= rows[-1][0]:
            raise ValueError('FDMNES 输出能量不严格递增')
        rows.append((values[0], values[header[1]]))
    if len(rows) < 40:
        raise ValueError('未发现足够的 Energy / <xanes> 各向同性数值点；禁止用其他列冒充理论谱')
    return {'energy': [r[0] for r in rows], 'mu': [r[1] for r in rows],
            'axis': 'relative_to_fermi_eV', 'signal': 'FDMNES isotropic <xanes>'}

def run_fdmnes(store, job):
    import numpy as np
    from ase.io import read
    from .store import write_json
    from .engine import versions, build_cluster
    req = FdmnesRequest.model_validate(job['request'])
    parent = store.parent(req.structure_job, 'structure')
    store.verify_original(req.structure_job)
    source = store.folder(req.structure_job)
    folder = store.folder(job['id'])
    started = time.monotonic()
    def stage(name, **extra):
        write_json(folder / 'fdmnes_progress.json', {
            'stage': name, 'elapsed_seconds': time.monotonic() - started,
            'updated_at': time.time(), 'precise_percent': False, **extra})
    stage('preparing')
    atoms = read(str(source / 'atoms.json'), format='json')
    if len(atoms) != parent['result']['atom_count']:
        raise ValueError('结构解析结果不一致')
    cluster = build_cluster(atoms, req.absorber_index, req.radius)
    path = executable()
    if path is None:
        raise ValueError('FDMNES 引擎不可执行')
    text = input_text(atoms, req)
    (folder / 'fdmnes.inp').write_text(text, encoding='ascii')
    (folder / 'fdmfile.txt').write_text('1\nfdmnes.inp\n', encoding='ascii')
    write_json(folder / 'structure_source.json', {'structure_job': req.structure_job,
               'input': parent['result']['input'], 'absorber_index': req.absorber_index,
               'input_sha256': hashlib.sha256(text.encode('ascii')).hexdigest()})
    binary_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    environment = os.environ.copy()
    environment.pop('EXAFS_API_TOKEN', None)
    with (folder / 'fdmnes.log').open('wb') as log:
        process = subprocess.Popen([str(path)], cwd=folder, env=environment,
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        native_start = time.monotonic()
        try:
            while process.poll() is None:
                if time.monotonic() - native_start > 1100:
                    raise TimeoutError('FDMNES 超过本次任务时间上限')
                stage('native_running', native_elapsed_seconds=time.monotonic() - native_start,
                      log_bytes=(folder / 'fdmnes.log').stat().st_size)
                time.sleep(1)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
    if process.returncode != 0:
        stage('failed')
        raise ValueError(f'FDMNES 返回 {process.returncode}；请查看 fdmnes.log')
    stage('reading_output')
    suffix = '_conv.txt' if req.broadening == 'native' else '.txt'
    candidates = [folder / f'xanes_{req.absorber_index+1}{suffix}', folder / f'xanes{suffix}']
    conv = next((p for p in candidates if p.is_file()), None)
    if conv is None:
        raise ValueError('引擎未产生选定吸收位点、所选展宽模式的理论谱；请查看日志')
    if conv.stat().st_size > 8*1024*1024:
        raise ValueError('理论谱文件超过8 MB限制')
    spectrum = parse_output(conv.read_text(errors='strict'))
    canonical = 'xanes_conv.txt' if req.broadening == 'native' else 'xanes_raw.txt'
    if conv.name != canonical:
        (folder / canonical).write_bytes(conv.read_bytes())
    (folder / 'xanes_theory.txt').write_bytes(conv.read_bytes())
    for src, dst in [(folder / f'xanes_{req.absorber_index+1}.txt', folder / 'xanes_raw.txt'),
                     (folder / 'xanes.txt', folder / 'xanes_raw.txt'),
                     (folder / f'xanes_{req.absorber_index+1}_bav.txt', folder / 'xanes_bav.txt')]:
        if src.is_file() and not dst.exists():
            dst.write_bytes(src.read_bytes())
    spectrum.update({'source_job': job['id'], 'native_convolution': req.broadening == 'native',
                     'gaussian_parameter_eV': req.gaussian, 'method': req.method})
    write_json(folder / 'xanes.json', spectrum)
    store.verify_original(req.structure_job)
    warnings = ['固定 CIF 的理论谱，不是自动优化配位结构或唯一结构证明。',
                '能量为相对费米能级；与实验的绝对对齐必须另行记录。',
                '单一吸收位点、各向同性谱；未平均其他不等价位点，未处理偏振测量几何。',
                '簇半径、SCF、网格与展宽均为计算起点；需通过收敛与对照检查。']
    if req.broadening == 'none':
        warnings.append('本次输出未展宽理论谱；与实验比较时需明确展宽口径，不能直接以拟合指标判断结构。')
    if req.method == 'green':
        warnings.append('Green 为 muffin-tin 多重散射近似，速度较快；与有限差分方法的势近似不同。')
    if not req.scf:
        warnings.append('本任务未启用 SCF；采用原子势起点。')
    stage('finished', output_points=len(spectrum['energy']))
    return {'kind': 'fdmnes', 'engine': 'FDMNES', 'protocol': PROTOCOL,
            'absorber_element': atoms[req.absorber_index].symbol, 'absorber_index': req.absorber_index,
            'edge': req.edge, 'cluster_atom_count': len(cluster), 'spectrum': spectrum,
            'calculation_settings': req.model_dump(), 'spectrum_file': 'xanes_theory.txt',
            'input': parent['result']['input'], 'binary_sha256': binary_hash, 'versions': versions(),
            'output_header': conv.read_text().splitlines()[:8], 'warnings': warnings,
            'files': [name for name in ['fdmnes.inp', 'fdmfile.txt', 'xanes.json', 'fdmnes.log',
                      'xanes_theory.txt', 'xanes_conv.txt', 'xanes_raw.txt', 'xanes_bav.txt',
                      'fdmnes_progress.json', 'structure_source.json'] if (folder / name).is_file()]}
