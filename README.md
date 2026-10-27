# vinext-starter

A clean full-stack starter running on [vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Portable: Windows, macOS, or Linux; no Bash required
- Managed Linux: managed Linux runtime with Bash, `flock`, `curl`, `sha256sum`, and GNU `timeout`
- Git and `tar` (including Windows `tar.exe`) are required for publishing; portable publication does not require Bash

## Sites Lifecycle

The Sites initializer copies the shared starter and selects managed-linux only when `SITES_MANAGED_LINUX_CONTAINER=1`; otherwise it selects portable. It saves the selection only in ignored `.sites-runtime/execution-profile.json`. Both profiles copy/configure first, then use the plugin's separate `install-dependencies.mjs` step to measure installation independently. Edit source under `app/` and follow the Sites skill for installation, preview, builds, and publishing.

Run `node <plugin-root>/scripts/configure-execution-profile.mjs` only when the profile is unknown for the current checkout and environment. Profile changes do not alter tracked source or require reinstalling otherwise-valid dependencies; restart an existing preview to use the new selection. Do not commit or upload `.sites-runtime/`.

This starter does not use `wrangler.jsonc`.

Publish archives outside the source checkout or under its ignored `outputs/` directory. Local `.env*`, `.dev.vars*`, TypeScript build state, and tool runtime directories are ignored; keep the hosting manifest, migrations, and authored scripts in source control.

`install:ci` runs `npm ci` once against the shared lockfile, disables parent-workspace discovery, and includes required dev/optional dependencies despite production/omit settings. Sharp defaults to prebuilt binaries unless explicitly configured otherwise. Do not overlap installers.

- **Portable:** Preserve host HOME, npm cache, registry, proxy, temporary paths, retry/concurrency settings, and lifecycle-script policy. Use `--prefer-offline --no-audit --no-fund`.
- **Managed Linux:** Use the existing project-local HOME/cache/tmp setup and Linux install lock, tarball preflight, and timeout. Restore the image-seeded npm cache only when its lockfile hash matches; retain network fallback. Builds keep their existing timeout. These helpers are not invoked by the portable profile.

`scripts/sites-env.mjs` preserves the caller's HOME, npm cache, proxy, XDG, and temporary-directory configuration while defaulting Wrangler and Miniflare state to the checkout. If npm reports an unwritable cache, select a writable path with `npm_config_cache` for that install. The `dev` and `start` scripts also keep Wrangler logs inside the checkout. Generated `.sites-runtime/` and `.wrangler/` directories are disposable and ignored by Git.

On portable, `npm run dev` uses `vinext dev` with HMR, starting at port 5173. Vinext records the running server in ignored `.vinext/` state, rejects an ordinary duplicate launch, and recovers stale state after a stopped process; exactly simultaneous starts can race. Pass `--port <port>` or `--hostname <host>` after `npm run dev --` when needed; keep portable previews on loopback.

For browser QA on managed Linux, use `sites-preview start`. The project's dev script runs Vite and accepts the supervisor's `--host 0.0.0.0 --port 4173 --strictPort` arguments. The internal browser uses `http://terminal.local:4173/`; it is not a user-facing URL. The supervisor owns the preview lifecycle. The ignored local profile survives the supervisor's cleared process environment.

The portable profile simulates ChatGPT sign-in only for loopback development requests. Visit `/signin-with-chatgpt?return_to=/` to sign in as `local_seedy` (`seedy@sites.test`, display name `Seedy`) and `/signout-with-chatgpt?return_to=/` to sign out. The development cookie preserves that identity across server restarts. Mock auth is disabled in the managed-linux profile and is not included in production builds; hosted authentication remains dispatch-owned.

The Worker uses `vinext/server/fetch-handler`, including Vinext's config-aware image handling. After building, `npm start` runs that Worker locally through Wrangler on `127.0.0.1`, sharing `.wrangler/state` with dev preview and local D1 migrations; it does not deploy the site or simulate sign-in. Use the URL printed by the server. Pass `npm start -- --port <port>` to select a different built-preview port.

Local previews use Miniflare's placeholder `Request.cf` metadata without a network lookup. Set `CLOUDFLARE_CF_FETCH_ENABLED=true` to opt into fetching preview metadata; this setting does not change hosted request metadata.

Local tool usage metrics are disabled by default. Set `WRANGLER_SEND_METRICS=true` to opt in.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `worker/index.ts` is the production Worker entrypoint and preserves request-scoped connector bindings
- `scripts/vite/` contains the maintained Vite integrations and the vendored Sites plugin license
- `scripts/connector-preview/` contains the local connector preview Worker and session helpers
- the remaining `scripts/` files select execution profiles and run installation, development, and builds; the plugin's helpers orchestrate the Sites lifecycle
- `dist/` contains generated deployment output; `.vinext/`, `.wrangler/`, and `.sites-runtime/` contain ignored local tool state
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `@cloudflare/workers-types` provides Worker types; `cloudflare-env.d.ts` declares optional `DB`/`BUCKET` bindings—update these declarations if binding names change
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Use it as the durable user key; use email and name for display or contact purposes.

SIWC-authenticated workspace sites may also receive `oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty `name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by `oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use the returned `userId` as the stable user key for user-owned records; do not use email as a durable identifier.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send anonymous visitors through Sign in with ChatGPT.
- In a Server Component, start sign-in with `<a href={chatGPTSignInPath(returnTo)} target="_top">`. The auth helper module is server-only; do not import it into a Client Component.
- Do not use `fetch`, XHR, a client-side router, or a framework link that can prefetch the sign-in route. SIWC must start as a top-level navigation.
- Never request the AuthAPI authorization endpoint directly. The dispatch-owned `/signin-with-chatgpt` route must start the SIWC flow.
- Use `chatGPTSignOutPath(returnTo)` for browser sign-out links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the OAuth cookies, and identity header injection. Do not implement app routes for those reserved paths. Routes that do not import and call the helper remain anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the Sites hosting platform's access policy controls for workspace-wide restrictions, or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write actions tied to the current ChatGPT user. Leave public content anonymous.

## Local D1 migrations

For a D1-backed local preview, generate SQL with `npm run db:generate`. Build once through the Sites skill's build entrypoint (or `npm run build` for standalone use) to generate `dist/server/wrangler.json`, rebuilding if bindings change. From the project root, apply each pending migration in order:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_example.sql
```

Replace the filename with the pending migration and `DB` with your D1 binding name if different. Use `.wrangler/state`, not `.wrangler/state/v3`; Wrangler adds the versioned directories. Do not replay migrations already applied locally. This updates only the preview database; publishing applies production migrations separately.

## Diagnostic Commands

- `npm run install:ci`: perform the one locked dependency install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build the deployable Sites artifact
- `npm run start`: preview the built Worker locally with D1/R2 support
- `npm run db:generate`: generate Drizzle migrations after schema changes

When using the Sites plugin, follow its skill instructions for installation, builds, and publishing. These npm commands remain available for standalone use.

The portable build runs Vinext directly without a host `timeout` command. The managed-linux build uses `scripts/build-verified.sh` and its existing `SITES_BUILD_TIMEOUT` setting.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)

## XAFS analysis assistant (2026-10-25)

The retained single-spectrum tool provides four stages: text-spectrum import and QC; browser normalization (or χ(k) diagnostic FT); a data-specific Athena/Artemis action sheet; and rule-based fit-log review. Existing structure records, comparisons and server FEFF/Larch fitting remain available. The interface supports elements/edges beyond Pd; the legacy structure comparison workspace retains its Pd conventions.

- Originals are retained as exact base64 bytes, accompanied by SHA-256 and decoded text. No sorting, deduplication, smoothing, glitch removal, scan rejection, self-absorption correction or merging occurs automatically. Invalid numeric rows block processing.
- Raw μ(E) normalization uses linear pre-edge and order 1/2 post-edge regression, nvict=0, without flattening. Range endpoints follow Larch's lower-at/below and nearest-exclusive upper convention. The edge step is evaluated at the nearest E0 sample. Negative or vanishing edge steps are rejected rather than repaired. On the teaching fixture the maximum difference from installed Larch was 4.82e-14.
- Normalized input is not normalized again. χ(k) input can be transformed using a full-interval Hann window and nonuniform-grid trapezoidal integration. This window differs from Athena/Larch's dk-taper window; the interface explicitly identifies this diagnostic convention. FT peaks are not interpreted as bond lengths.
- The retained single-spectrum normalization tool does **not** run AUTOBK; the new default project engine described below does. An exported Python script was executed with Larch to generate normalized data, χ(k), FT, a review plot and a processing record. It requires a Python environment with xraylarch; it creates a fresh output directory. The old remote backend has no preprocessing endpoint and is not modified by this update.
- Action sheets are deterministic rules, not generative-AI chemical inference. Initial settings and candidate models are distinguished from fitted results. Concrete GDS expressions require the user to supply and verify a single equivalent single-scattering-shell path, degeneracy, Reff and source. S02 assumptions and calibration sources are recorded.
- Analysis sessions are explicitly saved to owner-scoped immutable R2 objects, with an optimistic revision pointer in D1. Original byte hashes are validated server-side. Prior objects are retained as checkpoints. Schema migration 0002 only adds assistant_sessions; the existing workspaces and compute connections/jobs are preserved. Backup JSON export/import supports offline recovery. The initial per-file limit is 1 MB, at most 8 spectra, and at most 6 MB per saved session.

Checks:

```sh
node scripts/check-assistant.mjs
node scripts/check-assistant-worker.mjs
node scripts/check-model.mjs
node scripts/check-compute.mjs
node node_modules/typescript/bin/tsc --noEmit
```

The numerical checks cover source immutability, exact polynomial recovery, keV and transmission conversion, invalid rows, user confirmation, calibration provenance, short XANES, normalized input, a known FT peak, GDS applicability and fit-log flags. Isolated workerd tests cover byte-preserving save/reload, input integrity, user isolation, origin checks and revision conflicts. A managed browser-preview attempt was blocked by the environment's connection-refused routing; this is a browser-verification limit, not a passing UI test.


## Athena project automation (current default)

Drop an Athena `.prj` file to read and automatically process the complete project. Supports gzip/plain Perl-literal Athena projects and JSON Athena projects. The parser accepts data literals only and never evaluates Perl or embedded code. Quoted numeric arrays, Unicode escapes and existing spectrum types are handled. Unsupported derived types and invalid axes are flagged; originals are not sorted, deduplicated or altered.

- Groups are organized by absorber/edge, with foil/oxide/catalyst roles inferred from labels and visibly identified as inferences. Unknown roles remain unresolved. An initial project may already contain processed μ(E): the interface never claims to reconstruct absent detector raw channels.
- E0 is located by persistent positive derivative peaks using five-point local regression solely for detection; exported spectra are not smoothed. Each spectrum retains its own threshold and relative chemical shifts.
- Pre-edge candidates are ranked by normalized line-fit residual and width; relative pre/post windows are shared within an element/edge cohort. Post-edge polynomial order uses pooled BIC with an explicit threshold. An alternate normalization window is computed for sensitivity diagnostics.
- Browser-native AUTOBK adapts xraylarch 2026.3.1's numerical conventions: not-a-knot cubic interpolation, FITPACK-equivalent cubic basis, low-R Fourier residual, endpoint clamps and an analytic-Jacobian damped least-squares solver. It does not invoke the old remote Python API. Rbkg is explicitly identified as a conventional starting value, followed by ±0.2 Å sensitivity calculations in the final common k window.
- k coverage and a fourth-difference MAD noise heuristic propose each spectrum's upper k bound. Completed EXAFS groups then use the intersection for shared Hanning FT (kweight=2, dk=1, kstep=.05, nfft=2048). The heuristic is not a guarantee of signal quality and its assumptions and diagnostic values are shown. Near-edge-only and blocked groups do not silently contaminate the comparison window.
- No extra energy shifts occur by default. Optional foil calibration requires a user confirmation of the shared energy scale, a unique/selected foil and an adopted target energy. A single additive shift is applied to the whole element/edge cohort; separate spectra are not forced onto a common absorption edge. Candidate tabulated edge energies come from the installed XrayDB table and are explicitly described as an adopted convention, not a unique measured foil derivative standard.
- The user receives XANES, weighted χ(k), and magnitude/real/imaginary FT overlays; actual baseline/background plots; a per-parameter rationale table; normalization/Rbkg sensitivity; and unresolved issues. The ZIP includes original bytes, a new Athena project, derived arrays, processing JSON and the rationale report. The new project includes source μ(E) records plus derived χ(k) groups; Larch successfully reopened the teaching export. The original file and numeric arrays remain immutable.
- User-imported projects are automatically saved after processing; teaching demos are not automatically saved and do not replace an existing saved project. Owner-scoped snapshots are saved in R2 with a revision pointer in the new `athena_projects` D1 table. Hash and decoded numeric arrays are checked against the original `.prj` on save; role edits are allowed. Existing single-spectrum sessions, structure workspaces and compute configurations remain separate. Limits: 5 MB input, 20 MB expanded text, 60 groups, 24,000 points per group, 300,000 total points, 16 MB saved snapshot. Source/data backups and ZIP downloads are available.

Validation: `node scripts/check-project.mjs` covers parsing, all-group automation, source immutability, calibration, group isolation, normalized-input behavior, export/reimport, schema, cubic interpolation and report contents. `node scripts/check-project-worker.mjs` covers authenticated storage, source integrity, revision conflicts and cross-user isolation. The generated ZIP passed Python zipfile CRC checks and exact original-byte comparison. On the user's previously supplied seven-group reproduction project, same-parameter normalization differed from Larch by at most 6.5e-15 and χ(k) relative RMS differences were below 5.1e-7. This is implementation consistency on one existing project, not validation of every automatic setting or raw-data provenance. The private experimental project and its derived verification outputs are not committed to source.

Numerical provenance: [Larch AUTOBK documentation](https://xraypy.github.io/xraylarch/xafs_autobk.html), installed Larch source under MIT terms (see `vendor/xraylarch-LICENSE.txt`), and [XrayDB](https://xraypy.github.io/XrayDB/). A browser UI check is recorded separately from numerical/API/build checks; it must not be inferred from them.

Browser acceptance (2026-10-25): the deployed site was opened in the connected Chrome browser. The teaching project ran all four spectra through normalization/AUTOBK/FT, comparison plots rendered, parameter audits displayed calculated values and rationale, sample selection updated the audit, and no console errors were observed. The teaching demo did not auto-save or replace the current saved project. Browser file-picker upload of a user-held project was not performed; compressed parsing and the seven-group supplied project were verified independently with file bytes.

### 实验谱库与 XANES 近边拟合（2026-10-26）

- 左侧“实验谱库”独立保存多个上传文件：原始字节、SHA-256、文件内全部谱组、识别依据、用户核对信息、派生处理记录分别保留。支持 Athena `.prj`、多列/分块数值表格、已有拟合曲线 JSON；无明确列名时先保存为待确认，不按曲线外形猜测 χ(k)。原始探测器 I0/It 通道尚需明确转换，Artemis `.fpj` 请导出曲线和日志。
- 可接入现有已保存 Athena 工程及计算结果。首次打开谱库时自动接入此前保存的真实工程；后续真实工程处理完成也自动接入。谱库追加文件，不覆盖其他工程；同一原文件重复上传沿用既有记录。所选 μ(E) 显式运行现有自动预处理引擎，已归一化和 χ(k) 跳过重复归一化。加权 χ(k) 仅按明确列名或用户确认的权重恢复，k≤0 时停止，输入数组保持不变。
- 检查“已归一化”“已有 χ(k)”“含独立拟合曲线”“含拟合日志”四类证据。拟合日志可关联具体谱并保存原字节及校验值，复用现有报告检查；不凭两列曲线或低 R-factor 宣称结构正确。
- “近边拟合”独立于 FEFF/远程计算服务。目标及1–6个同元素/边、可比归一化的参考可来自不同保存文件。初始窗口为目标导数峰 E0−20 至 E0+60 eV，与共同覆盖取交集。用户核对后执行非负且权重和为1的等权最小二乘；枚举至多63个 simplex active faces，以 KKT 方程求解各面的最小值。参考线性插值到目标完整网格；不外推、不逐谱平移、不增加基线项。
- XANES 每次拟合单独保存目标与参考数组快照、文件 SHA-256/版本、窗口、权重、曲线、残差、R-factor/RMSE及判断限制。权重误差未估计，参考高度相关和边界权重显示提示；权重不是配位数或精确价态比例。报告 JSON、曲线 CSV 和历史恢复均可用。
- EXAFS 结构拟合前可先上传/保存/选择实验谱；统一谱库将选中派生 χ(k) 交给现有服务器协议，并记录源文件、谱组和版本。原服务配置、FEFF 路径与任务历史保留。
- D1/R2 所有谱库与近边记录按所有者隔离；更新采用版本检查，并拒绝覆盖输入数组、文件识别记录和原拟合曲线。新增 schema-only migration `0004_luxuriant_skullbuster.sql`。
- 验证：`node scripts/check-spectra.mjs`、`node scripts/check-spectra-worker.mjs`、既有工程/计算回归检查、TypeScript及生产构建。方法参考：<https://millenia.cars.aps.anl.gov/xraylarch/larix/lincombo.html>。

### FDMNES 结构近边对比（2026-10-26）

左侧“FDMNES 近边对比”默认采用结构模拟路线：选择已保存实验谱→上传CIF→核对具体吸收位点/边→提交FDMNES→自动归一化理论并对照实验。原始实验谱保留，处理参数与理论能量平移逐项展示；可选择有界的单个理论能量偏移精调。原参考谱LCF移到辅助标签。

需要在现有Aliyun计算服务器安装 `public/downloads/fdmnes-extension.zip` 中的扩展与官方引擎；网页发布不等于服务器已安装。安装方法、限制和验证记录见 `server/fdmnes-extension/README.md` 及 `COMPUTE.md`。实际原生FDMNES和真实服务器端到端运行尚未验收。
