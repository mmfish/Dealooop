# Dealoop

按验证转化付费的推广市场。founder 一句话发目标，creator 的 agent 自助参与，
每个被验证的转化即时结算。黑客松项目，提交日 2026-11-19。

规格见 [docs/SPEC.md](docs/SPEC.md)。不变量与验收场景见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。

## 不可违反的规则

1. **agent 不写账本。** 归因、预算占用、调价判定、结算全部是确定性代码。
   Claude 只产生 proposal，由核心校验后执行，校验失败即拒绝并记录原因。
2. **先写测试。** ACCEPTANCE.md 里的 A/B/C 系列不变量要先变成测试，再写实现。
   每次改动后全部跑一遍。
3. **金额一律用整数分（`*_cents`）。** 不允许浮点。
4. **价格单调不降，且永不超过 `max_cac`。**
5. **所有合成数据必须在 UI 和 README 上标注为合成数据。**
6. 超出 SPEC.md §13 范围的功能不要实现，先问。

## 这个仓库是从哪来的

由 [mmfish/DeaLoop](https://github.com/mmfish/DeaLoop) 导入并重开 git 历史。原项目是二手交易
市场（Meta Muse 黑客松），**它本身不包含任何模型调用** —— agent 的智能完全在 Muse 那一侧，
在仓库之外。所以"换成 Claude"不是替换一个 SDK，而是要新建一个此前不存在的 agent 层。

导入基线（已验证）：Node 24、`npm ci` 成功、43 个测试全过、`build:aws` 成功、服务可启动。

| 继承自 Muse | 处置 |
|---|---|
| `backend/auth.ts` `backend/oauth.ts` `backend/oauth-scopes.ts` `backend/grants.ts` | 复用；scope 名称随新领域调整 |
| `backend/mcp.ts` | 框架复用，工具定义全部重写 |
| `backend/event-stream.ts` `backend/contracts.ts` `backend/policy.ts` | 复用 |
| `backend/negotiation.ts` `backend/negotiation-spec.ts` | **复用为私下议价通道**（SPEC §9） |
| `backend/shortlist*.ts` `backend/media.ts` 及对应页面 | 删除 |
| `db/schema.ts` 的 posts / offers / deals | 替换为 campaigns / claims / conversions / ledger |
| Sites/Cloudflare 部署脚手架（`worker/` `vite.config.ts` `scripts/` 里的 install/sites 系列、`lib/connector*`） | **已删除**（commit 见 git log） |
| D1 形状的数据库接口（`runtime/sqlite.ts` 模拟、`cloudflare-env.d.ts` 的 `Env` 类型、`@cloudflare/workers-types`）与 Miniflare | **保留**：后端全部按 D1 的 `prepare/bind/batch` 写，5 个测试文件（api、api-key、auth、negotiation、security）用 Miniflare D1 做测试库。删掉它们等于重写测试，不属于清理 |
| `public/images/*`（二手商品图） | 删除 |

**`backend/oauth.ts` 里写死了 Muse 的回调 `https://agent.meta.ai/api/hatch/oauth/callback`，
而且只接受这一个 redirect_uri。** 改为 Claude 接入时，`tests/mcp.test.ts` 和
`tests/oauth-refresh.test.ts` 会一起要改。

## 目录

```
docs/          规格、验收场景、原项目说明
app/           Next.js 页面与路由（含 /mcp、/api/v1）
backend/       服务端：认证、OAuth、MCP、REST、议价、事件
core/          【新建】确定性核心：账本、归因、定价规则、状态机
agents/        【新建】Claude 调用层：解析、supply 估计、参与判断、议价策略
sim/           【新建】模拟器与对比实验
db/ drizzle/   schema、migration、repository
tests/         不变量测试与场景测试
runtime/       运行时适配（只保留 AWS/SQLite）
```

## 开发顺序

1. 清理：删掉上表里标记为删除的部分，`npm test` 保持全绿
2. `db/` 新 schema 与 migration（campaigns / claims / conversions / ledger）
3. `core/` + `tests/` 的 A、B 系列不变量 —— 没有它就没有可信的 demo
4. `sim/` + 对比实验（S2、S3）—— pitch 的核心证据
5. `agents/` 接入 Claude（解析、supply 估计、creator 判断）
6. 议价通道改造（C 系列，S8–S10）—— 可降级为 P1
7. UI 与种子数据

## 术语

- **公开价 / current_price**：campaign 当前的统一单价，所有公开通道的 creator 同价
- **追溯统一价**：升价后，此前已验证的转化也按新价结算
- **pending**：已产生但未通过验证的转化，按当前价占用预算额度
- **deal**：头部 creator 单独议定的私下条款，不影响公开价
- **mandate**：agent 可以自主决策的边界（预算、最高 CAC、最低到手价）
- **supply(p, d)**：在价格 p、剩余 d 天下还能拿到多少转化的估计，由 agent 产出

## 排期（11/11–11/19）

| 日期 | 内容 | 检查点 |
|---|---|---|
| 11/11 | 规格定稿、项目骨架、技术栈定 | |
| 11/12–11/13 | `core` + A/B 不变量测试 | **11/13：测试全绿，否则议价降级为 P1** |
| 11/14 | `sim` + 对比实验，产出 S2/S3 的数字 | |
| 11/15 | `agents` 接入 Claude | **11/15：agent 跑通，否则砍自然语言策略** |
| 11/16 | 议价通道（若未降级） | |
| 11/17 | demo UI + 种子数据，**功能冻结** | |
| 11/18 | 打磨、录 demo video、README | |
| 11/19 | 缓冲、提交 | |

砍单规则：11/13 核心未绿 → 议价降 P1；11/15 agent 未跑通 → 只保留解析这一处
Claude 调用；11/17 之后不加任何新功能。
