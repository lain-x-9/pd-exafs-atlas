# EXAFS compute integration

The existing owner-private Site now includes a compute workspace. The numerical service is the separately installed `exafs-compute-v1` FastAPI / FEFF8L / Larch application on the user's Aliyun host; native FEFF and Python are not run inside Cloudflare Workers.

## Data flow

Authenticated browser → same-origin Site API → authenticated HTTPS numerical service. The Site backend stores the selected compute origin and an AES-GCM encrypted service token in D1. The encryption key is the secret runtime variable `COMPUTE_CONFIG_KEY` (64 hex characters), set through Sites. User identity is authenticated with the existing ChatGPT integration. Tokens are bound to that identity through AES additional data, never returned to clients, and never stored in browser localStorage.

The initial transport accepts only origins of the form `https://<hostname>.trycloudflare.com`. Paths, query strings, credentials, custom ports, redirects, localhost and unrelated destinations are rejected. This is a temporary integration route, not a permanent hostname or uptime guarantee. Production deployment of this Site does not establish or keep the user's tunnel running.

Connection setup checks `/health` with the supplied service token before saving. The native service must report version `0.1.0`. Uploaded structure / χ(k) bytes are forwarded to the numerical service. That service retains immutable originals, SHA-256, parameters and logs. The Site records user-owned job IDs, labels and status/result snapshots, without copying original files to D1. User ownership is checked again for polling, dependencies and file downloads. File names are allowlisted; no generic forwarding route is exposed. Generated reports, PNGs and curves stream through the authenticated Site route with `Cache-Control: no-store`.

## User workflow

1. Connect the HTTPS service in **结构与谱线拟合 → 连接设置**. Use the `EXAFS_API_TOKEN` value in `/opt/exafs-app/exafs-compute-v1/private.env`; enter it only in the password field, not in chat or a URL.
2. Select **进入服务器计算** and upload CIF, POSCAR/CONTCAR or XYZ. Review crystal cell, PBC and atom coordinates. Select the absorber explicitly; displayed labels start at 1 and engine indices start at 0.
3. Set edge, cluster/path radius and FEFF k maximum. Inspect native warnings and choose paths explicitly. Changing the absorber or FEFF configuration clears downstream selections; completed jobs remain in history.
4. Upload unweighted, two-column χ(k). Explicitly mark it as experimental derived data or synthetic test data. Choose fit windows, weighting, variable/fixed parameters and bounds, provide provenance and S0² justification, and acknowledge the reviewed paths/warnings before submission.
5. Inspect k-space, R-space magnitude/real part and residual, parameter errors/correlations, fitted distances and effective N versus fixed geometric degeneracy. Download reports, curves, plots or parameter JSON. Previous tasks remain selectable after refresh. Failed/interrupted tasks expose their log.

The backend supports single-scattering effective N via S0² × N / degeneracy, and rejects freely varying both S0² and N. This version does not infer chemical model choices, preprocess μ(E), create CIF from spectra, or automatically merge multiple paths into one coordination shell. The FEFF radius warning observed in the Cu test is preserved and displayed; it is not declared resolved.

## Demo provenance

`public/demo/` contains only ideal Cu FCC a=3.61 Å synthetic fixtures produced in an independent test. The native FEFF calculation and Larch fit ran successfully; they are not Pd experimental data. Demo buttons replay those stored results and explicitly do not recompute after changing controls. Demo changes never create cloud compute jobs or write research records. The two downloadable synthetic inputs can be used for an actual server-side UI test after connectivity is configured.

## Verification

- `node node_modules/typescript/bin/tsc --noEmit`
- `node --experimental-strip-types scripts/check-model.mjs`
- `node --experimental-strip-types scripts/check-compute.mjs`
- `node --experimental-strip-types scripts/check-compute-server.mjs`
- `node scripts/check-compute-worker.mjs` runs the actual outbound function under workerd, with isolated mock origins. Authenticated health requests and explicit rejection of 301/302/303/307/308 responses are covered.
- Browser QA passed for demo structure/absorber/path selection, parameter identifiability warning, results, distances, plots and display weighting. Download links were displayed and clicked; automated browser download-event confirmation timed out, so the Site download round trip still needs verification after HTTPS connectivity. The independent native-service download test passed.
- Native service HTTP → FEFF → Larch → files smoke test has passed both in the independent environment and, based on the user's returned log, on the Aliyun host.

The actual production Site → user's HTTPS tunnel → numerical service round trip remains pending until that host starts the tunnel and the owner supplies connection settings. No real Pd structure or experimental χ(k) has been provided or fitted in this task. Stable transport, unattended startup and production recovery on the user's host still require a follow-up deployment step. Existing workspaces and their migrations are preserved; the two new compute tables are introduced by an appended schema migration.

## 2026-10-25 connection fix

The first deployed outbound request used `redirect: 'error'`, which Workers rejects during request construction. Production connection attempts returned 502 in 4–9 ms before network I/O. The same Request-construction failure was reproduced locally in workerd. Outbound requests now use `manual`, explicitly reject all 3xx responses, and retain the existing no-redirect credential policy. Transport errors are logged with token redaction; timeouts have a specific user message. Node server checks, workerd regression and TypeScript checks passed. The owner must retry connection verification after the fix is deployed; this change does not assert that the real tunnel, API token or end-to-end fit has already been verified.

## 2026-10-26 FDMNES fixed-CIF XANES workflow

The primary near-edge workflow is now CIF → explicitly selected absorber/edge → native FDMNES → theory normalization → experimental comparison. Reference-spectrum LCF remains an optional secondary tool. The Site does not run native binaries: the additive server extension is under `server/fdmnes-extension`, with a downloadable ZIP under `public/downloads`. It extends the existing authenticated single-worker queue and native-service version0.1.0 without replacing FEFF/Larch or changing stored credentials.

The installer requires an empty queue before a requested restart, verifies the API PID, backs up existing source, adds the router and engine dispatch, and uses the current official FDMNES Linux download or a specified executable. Experimental originals and jobs are untouched. It does not upgrade Python packages. Binary dynamic-library failures or unknown legacy source layouts stop installation. The actual Aliyun host has **not** been modified or inspected from this environment.

`/api/fdmnes` checks engine capability, verifies owned completed structure jobs, forwards bounded FDMNES settings, polls owned jobs and exposes only allowlisted numerical output. Native output must contain a valid increasing `Energy / <xanes>` table; success is not inferred solely from an exit code. Input includes full expanded P1 crystal and a 1-based explicitly selected Absorber. A single isotropic site is calculated. Defaults are finite-difference, SCF,4Å,−20…120eV relative to Fermi level,0.5eV step, native lifetime convolution and no extra Gaussian. These are initial settings requiring convergence tests. Green mode is a distinct muffin-tin approximation. The inherited20-minute per-job budget remains.

Theory normalization uses the existing nvict0,linear pre/post,unflattened engine. With E0 from a sustained derivative peak: pre1=−min(18,0.85×before),pre2=−min(5,0.25×before),norm1=max(20,0.45×after),norm2=0.9×after. Insufficient coverage stops. Already normalized experiment is reused; raw μ(E) receives a separately saved processing result before submission/comparison. Comparison initially adds one recorded offset to the **theory** energy so the derivative peaks coincide; it does not treat relative-Fermi energy as absolute experimental photon energy. An optional bounded energy-only search uses ~0.1eV steps. There is no free intensity scaling, baseline addition, hidden broadening search or experimental shift. The window lies in common coverage for all candidate offsets; no extrapolation occurs.

Every comparison stores experimental source SHA/revision/arrays, complete theory job/configuration/binary SHA/header, normalized and raw theory, normalization windows, total alignment, fit window, residuals,RMSE/R-factor in per-owner D1/R2 snapshots. History is independent of reference-spectrum LCF. Changing the CIF geometry automatically is out of scope; the result tests a fixed candidate and does not prove a unique local environment.

Verification: TypeScript, production build, `check-fdmnes.mjs` known-shift/normalization/immutability checks, `check-fdmnes-worker.mjs` workerd ownership/origin/version/storage with a mock upstream, and `check-fdmnes-server.py` protected native-service adapter with a mock executable. **No real FDMNES engine was run here; installation and a real end-to-end CIF job on the owner's server remain required.** Browser extension remained disconnected, and managed preview was previously unavailable. Do not describe these tests as native numerical validation.

Official references: <https://fdmnes.neel.cnrs.fr/download/>; English manual linked there (retrieved2026-10-26), sections Crystal/Absorber,Range/Energpho,Green/Edge,Convolution/SCF.


## 2026-10-26 MACE single-structure preoptimization

The compute workspace now includes an optional MACE panel after structure upload.
It uses the existing authenticated connection, owner-scoped job snapshots and file proxy.
The additive server installer and validation client are in server-addons/mace-v1;
the corresponding downloadable archive is public/downloads/exafs-mace-addon-v1.zip.
Installation preserves the existing token and tunnel, checks source/model hashes and the idle queue,
backs up changed files, and attempts rollback if the restarted health check fails.
The exact additive FDMNES registration is preserved in either installation order.

MACE runs with its existing separate Python environment in the same numerical job queue.
It preserves FixAtoms/FixScaled and the cell; one CPU thread, 200-atom/300-step limits,
20-minute supervisor timeout and 2304-MiB resident-memory stop.
Queued and running cancellation, progress polling, convergence status and derived downloads are supported.
Explicitly choosing an optimized structure creates a new structure parse and clears current FEFF/fit choices.
Boundary conditions or constraints that the import format cannot preserve disable direct reuse.
Existing FDMNES/XANES features and migrations are retained.

Validation: 11 backend contract/control-flow tests plus 3 installer tests passed.
The worker I/O test uses ASE EMT as a test double; it is not a MACE accuracy test.
The user's prior real MACE CLI benchmark (148 atoms, 10 steps) passed before this API patch.
The new real-server API round trip remains pending until the user installs the addon and runs check_mace.py.
Managed preview reported running, but the cloud browser returned connection refused; browser QA is unverified.
TypeScript, worker transport and existing compute checks are tracked separately from that browser limitation.


## Connection error reporting repair (2026-10-26)

Production connection-save requests returned generic 503 responses in about 2 ms.
The old generic handler discarded untyped exceptions; in particular allowedComputeUrl
throws plain Error, so invalid URL inputs incorrectly appeared as service outages.
The exact cause of the user's latest failing input was not observable in the old logs.
URL validation now maps to an explicit 400, malformed input/token values have actionable errors,
and a successful non-JSON health body maps to an explicit 502. Corrupt stored ciphertext
is classified as a connection setting error. Unexpected failures report the operation phase
and a diagnostic code; logs retain only that code, fixed phase, operation and error class,
never raw request bodies, error messages or credentials. Existing encryption and redirect
restrictions are preserved.

The new connection route regression covers invalid URL/token/JSON, encrypted save,
HTML/null health responses, upstream HTTP 530, failed database writes, corrupt saved
settings and secret-safe diagnostics. Existing server checks and TypeScript passed.
The real owner's save/connection round trip must be retried after publication.

## 配位数自动搜索（网站端首版）

入口：EXAFS 页，在核对 FEFF 路径与拟合设置之后，使用“指定配位元素 · 自动搜索”。支持已完成的 Pd K 边 FEFF 任务，目标是一个等价单散射壳层路径；其他选中贡献保留。同元素多条目标路径暂不支持，避免把总配位数重复分配给多条路径。目标 N 在 0 与用户指定上限之间连续拟合，扫描步长 0.5 或 1；不假定配位数必为整数。

算法：三组连续 N 初值；每个固定 N 用两组初值重新优化其余自由参数；N=0 时固定目标路径的距离及无序参数，避免零振幅下的不可辨识；可选 S₀² 上/下扰动，各两组初值；提高 kmin 0.5、降低 kmax 0.5 的窗口检查，各两组初值。每次优化复用既有 `/v1/fits`，不重新运行 FEFF。最多 80 次，实际范围上限限制下不超过 77 次。搜索前对所有子试验执行独立点数及参数检查。σ²/配位数非负，固定正的 S₀²，非目标壳层不自由拟合配位数。

数据库 `coordination_searches` 首次访问时幂等创建；输入派生 χ(k) 单独存入 R2，记录 SHA-256。搜索记录保存创建时的模型/来源/参数/计划、每次任务 ID 和诊断，支持 JSON 导出。只允许一个正在进行的搜索；每次推进用数据库条件更新取得互斥锁。网络轮询失败可恢复；提交结果未知时中断并禁止自动重发，避免重复计算。暂停/结束只停止后续推进，已经提交的拟合继续运行。

当前由已打开网页每 2.5 秒请求推进，关闭页面后暂停后续提交；恢复时从已保存记录继续。不承诺无人值守的整批执行。无需升级已有计算服务器。搜索不改变输入谱，不自动校正自吸收、不平滑、不删点。标样标定/假定 S₀² 必须明确记录；±扰动是敏感性检查，不自动解释为标定误差。

拟合比较保持同一处理、窗口及模型；跨窗口 R-factor 不排名。未收敛或失败结果保留，但不作为扫描较优结果。报告边界、强相关、假定振幅及遗漏极小值迹象。扫描图不提供统计置信区间，也不把误差最低的 N 当作唯一结构或元素存在性证明。优化器条件标准误差未包括全部系统误差。当前没有新增通用 FEFF 路径库。

验证：`node scripts/check-coordination-search.mjs` 覆盖参数/模型、N=0、输入不可变、多初值、失败排除，以及实际路由在 SQLite+R2/计算服务测试替身上的所有权、完整串行执行、并发互斥、轮询恢复和不确定提交保护。该测试没有拟合真实实验谱。标样回收、真实 Pd 样品、噪声与错误模型的计算验收仍需在连接的计算服务器上进行。

## 无结构的 Quick First Shell 入口

EXAFS 页在配位数搜索上方增加“无 CIF / 无现成路径 · 快速第一壳层”。用户指定散射元素、名义最近邻距离并确认第一壳层假设；首版吸收中心固定 Pd K 边，距离输入范围 1.3–3.0 Å 是功能范围，不是对任意元素对的化学合理性保证。距离必须有化学依据，不直接取未相位校正的 FT 峰位。

原理依据 Artemis 0.9.26 官方 QFS 文档：https://bruceravel.github.io/demeter/documents/Artemis/extended/qfs.html 。在后台生成常规岩盐晶胞（晶格常数为名义距离的两倍），通过现有结构解析与 FEFF 接口计算，只保留元素、距离与几何简并度均核验通过的唯一最近邻单散射路径。此实现复用现有 non-SCF 引擎，尚未证明与 Artemis 在所有势设置下数值等同。后台仍使用 FEFF，用户无需现成路径或真实 CIF。不会生成或宣称预测出了真实样品结构。

与 Artemis 导入路径时将简并度设为 1 的界面约定不同，本程序保留原 FEFF 文件几何简并度 6，并沿用现有有效 N 替代机制（振幅为 S₀²×N），不把 N 再乘 6。需在真实服务器上核验这一归一化约定的数值结果。

`quick_shell_jobs` 保存流水线与中断状态，结构解析结束后自动提交 FEFF；服务器端互斥锁防止多页重复提交，提交不明时中断。生成的结构及路径有 `quickShellSource` 来源记录；QFS 人工计算簇从正常结构优化/近边结构选择中排除，MACE/FDMNES 接口也拒绝把它当作样品结构。最近邻路径核验完成后自动接入现有配位数搜索，S₀²、窗口与配位数扫描仍需核对。原始实验数据保持独立。

此工具只用于第一壳层近似。远壳层/多重散射不能使用相同生成规则；该限制由语义确认与范围说明表达，不凭固定距离阈值宣称已识别真实壳层。第二壳层应使用合适参考结构/散射势方案。

`node scripts/check-quick-shell.mjs` 验证人工晶胞的周期最近邻、同元素情况、路径筛选、简并度归一化等价式及实际路由的串行/互斥/所有权/提交不明处理。使用测试替身，不代表真实 FEFF 或实验谱验收通过。

## 任务导向的实验 / 理论 / 验证流程

首页与导航有三个主入口：我有实验谱、我有候选结构、实验谱 + 多个模型。原有谱库、预处理、计算和参数记录工具保留。三个任务表单在切换工具时保留内存状态，保存后可跨会话恢复；未保存编辑不承诺刷新后恢复。

分析任务存入私有 `research_cases` 索引与版本化 R2 快照。任务关联一个可选实验目标、多个真实候选结构、对应 XANES 预测或 EXAFS 拟合；真实计算任务均验证所有权和父模型关系。QFS 人工计算簇不作为真实模型。实验来源冻结谱组数值、处理结果、源校验值和谱库版本；保存时拒绝新关联过期版本，已有任务可保留历史快照。工具接收已保存目标/模型时重新核对当前谱库版本，变化时要求显式更新，避免静默替换。修改采用任务 revision 乐观并发校验，冲突拒绝覆盖。原始实验文件不变。

从实验谱出发时，EXAFS 默认展示快速第一壳层；结构解析/FEFF 手动步骤在“已有结构 / 路径”分支。窗口、S₀² 等拟合设置共用。结构预测时 FDMNES 默认不自动对比、隐藏实验选择，直接显示并导出预测谱，标明未经实验拟合。也可显式切换“与实验谱比较”。理论原生输出和计算参数独立保留，MACE 优化可选。

保存验证任务时，对已关联结果生成比较快照：XANES 检查元素/边、不同父结构、计算半径/方法/网格/展宽一致，使用同一冻结实验目标与共同窗口，分别按理论导数峰生成有记录的初始能量平移，不精调、不给实验能量平移，不比较不同处理条件的指标。EXAFS 检查完成/收敛、χ(k) 输入 SHA-256、k/R 窗口/权重/窗函数/dk、固定 S₀² 一致，以及变量数与独立信息量；与任务实验目标的关联目前另需操作者核对确认。条件不一致时不展示可用于比较的 R-factor 数值。模型复杂度与误差模型仍需人工检查，R-factor 表不自动排序。

任务默认判断是“目前无法区分 / 未形成判断”。用户人工选择支持模型时必须选择关联模型并提供证据与限制，预测任务不能给出实验支持结论。归一化、χ(k)、输入含拟合曲线、报告已关联分别展示，均不自动等同于拟合通过。JSON 导出包含任务、全部源快照、关联参数和比较曲线。

验证：`node scripts/check-research-workflow.mjs` 用合成谱检验共同窗口数值比较、条件不一致拦截、来源不可变与实际路由的 SQLite/R2 所有权/版本/关联检查；`node scripts/check-workflow-render.mjs` 对真实 React 组件做静态渲染，覆盖三种入口、预测不要求实验谱、实验不要求结构与 QFS 排序。均不等同于浏览器交互或真实服务器数值引擎验收。
