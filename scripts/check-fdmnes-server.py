"""Adapter tests use an explicitly fake executable; do not imply native FDMNES verification."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from unittest.mock import patch

import numpy as np
from ase import Atoms
from ase.io import write
from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.testclient import TestClient

ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
    tmp=Path(tmp);package=tmp/'fixture_fdmnes';package.mkdir()
    (package/'__init__.py').write_text('')
    shutil.copy2(ROOT/'server/fdmnes-extension/fdmnes.py',package/'fdmnes.py')
    (package/'store.py').write_text("import json\ndef write_json(path,value): path.write_text(json.dumps(value))\n")
    (package/'engine.py').write_text("def versions(): return {'test':'fixture'}\ndef build_cluster(atoms,index,radius): return [1,2,3]\n")
    sys.path.insert(0,str(tmp));from fixture_fdmnes import fdmnes as f
    atoms=Atoms('Cu4',scaled_positions=[[0,0,0],[.5,.5,0],[.5,0,.5],[0,.5,.5]],cell=[3.61]*3,pbc=True)
    config={'structure_job':'a'*32,'absorber_index':2,'edge':'K','radius':4,'method':'finite_difference','scf':True,'emin':-20,'emax':120,'step':.5,'gaussian':0,'reviewed':True}
    req=f.FdmnesRequest(**config);text=f.input_text(atoms,req)
    assert 'Absorber\n3\n' in text and 'Crystal\n' in text and 'Convolution\n' in text
    assert '\nGreen\n' not in text and '\nSCF\n' in text and 'Energpho' not in text
    green=f.input_text(atoms,f.FdmnesRequest(**{**config,'method':'green','scf':False,'gaussian':1.2}))
    custom=f.input_text(atoms,f.FdmnesRequest(**{**config,'emin':-60,'emax':240,'step':.2,'gamma_hole':2.5,'gamma_max':12,'ecent':35,'elarg':20}))
    assert 'Range\n-60.000000 0.200000 240.000000' in custom
    assert 'Gamma_hole\n2.500000' in custom and 'Gamma_max\n12.000000' in custom and 'Ecent\n35.000000' in custom and 'Elarg\n20.000000' in custom
    raw=f.input_text(atoms,f.FdmnesRequest(**{**config,'broadening':'none'}))
    assert 'Convolution' not in raw and 'Gamma_hole' not in raw
    for change in [{'emin':120}, {'step':0}, {'emax':2000,'step':.05}, {'broadening':'none','gamma_hole':2}, {'emin':float('nan')}]:
        try:f.FdmnesRequest(**{**config,**change})
        except ValueError:pass
        else:raise AssertionError('invalid parameters accepted')
    assert '\nGreen\n' in green and '\nGaussian\n1.200000' in green and '\nSCF\n' not in green
    spectrum='Header fixture\nEnergy <xanes> other\n'+'\n'.join(f'{-20+i*.5} {1/(1+np.exp(-(-20+i*.5)/2))} 0' for i in range(281))+'\n'
    parsed=f.parse_output(spectrum);assert len(parsed['energy'])==281
    try: f.parse_output(spectrum.replace('Energy <xanes> other','Energy xx yy'))
    except ValueError: pass
    else: raise AssertionError('ambiguous columns accepted')
    for bad in [spectrum.replace('-19.5','-20.0'),spectrum.replace('0.0 0.5','0.0 NaN')]:
        try:f.parse_output(bad)
        except ValueError:pass
        else:raise AssertionError('bad output accepted')
    fake=tmp/'fake-fdmnes';fake.write_text('#!/usr/bin/env python3\nfrom pathlib import Path\nimport time\ntime.sleep(.1)\nprint("mock native log",flush=True)\nPath("xanes_conv.txt").write_text('+repr(spectrum)+')\nPath("xanes.txt").write_text('+repr(spectrum)+')\n');fake.chmod(0o755)
    class Store:
        def __init__(self):self.jobs={};self.root=tmp/'jobs';self.root.mkdir();self.source=self.root/('a'*32);self.source.mkdir();write(self.source/'atoms.json',atoms,format='json')
        def folder(self,id):return self.root/id
        def parent(self,id,kind):
            if id!='a'*32 or kind!='structure':raise KeyError(id)
            return {'result':{'atom_count':4,'input':{'original_filename':'fixture.cif','sha256':'b'*64,'size_bytes':123}}}
        def verify_original(self,id):assert id=='a'*32
        def create(self,kind,request):
            id='c'*32;(self.root/id).mkdir(exist_ok=True);j={'id':id,'kind':kind,'state':'queued','request':request};self.jobs[id]=j;return j
        def get(self,id):
            if id not in self.jobs:raise KeyError(id)
            return self.jobs[id]
    store=Store()
    def private(authorization: str|None=Header(None)):
        if authorization!='Bearer test-only-secret':raise HTTPException(401)
    app=FastAPI(dependencies=[Depends(private)]);f.register_fdmnes(app,store)
    with patch.dict(os.environ,{'FDMNES_BIN':str(fake)}):
        with TestClient(app) as client:
            assert client.get('/v1/fdmnes/capabilities').status_code==401
            headers={'Authorization':'Bearer test-only-secret'}
            cap=client.get('/v1/fdmnes/capabilities',headers=headers).json();assert cap['installed'] is True and cap['protocol']==2 and cap['progress']
            assert client.get('/v1/fdmnes/'+'c'*32+'/progress').status_code==401
            assert client.post('/v1/fdmnes',headers=headers,json={**config,'absorber_index':10}).status_code==422
            job=client.post('/v1/fdmnes',headers=headers,json=config);assert job.status_code==202
            result=f.run_fdmnes(store,job.json());assert result['kind']=='fdmnes' and len(result['spectrum']['energy'])==281
            assert result['spectrum']['native_convolution'] is True and result['spectrum_file']=='xanes_theory.txt'
            detail=client.get('/v1/fdmnes/'+'c'*32+'/progress',headers=headers).json()
            assert detail['progress']['stage']=='finished' and detail['precise_percent'] is False
            assert 'mock native log' in detail['logs']['fdmnes.log']
            folder=store.folder('c'*32);(folder/'worker.log').write_text('x'*40000)
            assert len(client.get('/v1/fdmnes/'+'c'*32+'/progress',headers=headers).json()['logs']['worker.log'])==32768
            rawjob={**job.json(),'request':{**config,'broadening':'none'}}
            rawresult=f.run_fdmnes(store,rawjob)
            assert rawresult['spectrum']['native_convolution'] is False
            assert rawresult['calculation_settings']['broadening']=='none'
            assert 'Convolution' not in (folder/'fdmnes.inp').read_text()
            store.jobs['d'*32]={'kind':'mace'}
            assert client.get('/v1/fdmnes/'+'d'*32+'/progress',headers=headers).status_code==404
            assert result['binary_sha256'] and (store.folder('c'*32)/'fdmnes.inp').is_file()
            assert client.get('/v1/fdmnes/'+'c'*32+'/files/xanes.json',headers=headers).status_code==200
            assert client.get('/v1/fdmnes/'+'c'*32+'/files/private.env',headers=headers).status_code==404
    print('FDMNES adapter checks passed with MOCK executable: CIF-derived input, absorber indexing, SCF/Green/convolution, strict output parser, protected routes, job checks, subprocess execution and file allowlist. Native FDMNES NOT run.')
