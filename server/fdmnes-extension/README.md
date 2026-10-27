# FDMNES 结构近边扩展 v2

为 `/opt/exafs-app/exafs-compute-v1` 添加或升级 FDMNES 任务。保留 FEFF/Larch、MACE 接入、令牌、原始文件和任务目录。网页部署不会自动升级服务器。

## 升级现有扩展

先等待排队和运行任务全部结束，把 ZIP 上传至 `/opt/exafs-app`，执行：

```bash
cd /opt/exafs-app
python3 -m zipfile -e fdmnes-extension-v2.zip .
cd fdmnes-extension
/opt/exafs-app/.venv/bin/python install.py --restart
```

安装程序复用 `FDMNES_BIN` 或既有 `fdmnes_path.txt` 指向的可执行文件，不重复下载引擎。它核对现有接口 PID、检查空闲队列、备份代码、加载扩展，再验证鉴权后的能力接口协议为 2。Cloudflare 隧道无需重启。不会安装或升级 Python 依赖。备份目录会打印出来；没有自动回滚。

首次安装时，明确选择已有官方引擎：

```bash
/opt/exafs-app/.venv/bin/python install.py --engine /绝对路径/fdmnes --restart
```

或将上面的 `--engine ...` 替换为 `--download-engine`，从官方地址下载。缺少动态库或没有明确引擎时会停止。FDMNES 由官方分发，本包不包含原生可执行文件：<https://fdmnes.neel.cnrs.fr/download/>。若官方更换下载链接，手动下载并使用 `--engine`。

## v2 行为

- 均匀能量网格由用户设置，单位为相对费米能级 eV：下限、上限、步长；资源边界为 −200…2000 eV、步长 0.05…10 eV、40…6000 点。
- `native`：FDMNES 原生寿命展宽，可指定 Gaussian、Gamma_hole、Gamma_max、Ecent、Elarg；空值沿用引擎默认。Gaussian 是额外展宽。
- `none`：不写 Convolution，输出未卷积理论谱；不能同时指定卷积参数。
- 成功结果记录实际参数和 `xanes_theory.txt`；保留输入、原生输出、日志、结构来源。不会改写原始实验谱或原始 CIF。
- `/v1/fdmnes/{id}/progress` 返回准备、原生运行、输出校验等阶段、耗时和最近日志。没有可靠的总完成百分比，不生成虚假百分比；原生程序缓冲输出时日志可能暂时不变。
- 网站“任务中心”显示网页登记的任务。终端直接提交而未登记的网站任务不会自动出现。旧版扩展仍显示基本状态及 worker 日志；完整自定义参数及原生阶段日志需要 v2。

## 范围与验收

流程为 CIF → ASE 解析与占位检查 → 选择吸收原子/边 → P1 完整晶胞输入 → 原生 FDMNES → 校验 Energy/<xanes> 数值输出 → 可选实验对比。

目前是单吸收位点各向同性计算，不自动优化 CIF、不平均不等价位点，不自动处理部分占位和偏振。簇半径、SCF、方法、网格与展宽需要收敛检查。每个任务仍有 20 分钟上限。

自动化检查使用模拟可执行文件，验证参数传递、受保护接口、阶段日志、输出解析与下载边界。未在此构建环境运行真实 FDMNES；升级后须提交一个真实结构，检查输入参数、原生日志及数值输出后完成验收。
