# Dealoop MVP 规格（一页版）

版本：2026-11-11 · 目标：11/19 黑客松提交

## 1. 它是什么

一个按验证转化付费的推广市场。founder 用一句话说出目标，平台把它变成一个公开的
campaign；creator 的 agent 自助参与，用带标识的链接推广；每产生一个被验证的转化，
平台即时结算。

MVP 只验证一件事：**在最高 CAC 以内把预算花完，并且比固定价格拿到更多用户。**

## 2. 为什么需要 agent

单笔交易金额极小（$5 量级），数量极多（几十到几百个 creator）。人类平台因此只能做
标准化大颗粒的交易，长尾的小额推广根本不会发生。agent 把单笔交易成本降到接近零，
这些交易才存在。

agent 负责判断，不负责记账。见 §7。

## 3. 角色

| 角色 | 谁控制 | 能做什么 |
|---|---|---|
| founder agent | founder | 把一句话目标转成 campaign；按进度建议调价 |
| creator agent | creator | 评估是否参与；获取推广链接；头部可发起议价 |
| 平台 | 确定性代码 | 归因、预算、结算、状态机、不变量 |

## 4. 核心流程

1. founder 说："帮我的 app 拉新 100 个注册用户，越多越好。预算 $1000，CAC 不超过 $10。"
2. founder agent 解析成 campaign。**deadline 为必填**，缺失时必须追问，不得猜测。
3. campaign 以起始价进入公开池。
4. creator agent 看到当前单价、剩余预算、截止日，自行决定参与，领取带标识的链接。
5. 用户通过链接完成注册 → 产生一条 pending 转化。
6. 验证通过 → 转化变为 verified，立即按**当前公开价**计入应付。
7. 每个 tick（1 天）重算价格；价格只升不降，升价**追溯适用于全部已验证转化**。
8. 截止日或预算用尽时 campaign 关闭，按最终价统一结算。

## 5. 数据模型

```
Campaign:  id, founder_id, goal_count, budget_cents, max_cac_cents,
           deadline, current_price_cents, status
Creator:   id, name, joined_at, verified_conversion_total
Link:      id, campaign_id, creator_id, token
Conversion: id, link_id, external_user_id, created_at,
            status (pending|verified|rejected), verified_at, seq
Deal:      id, campaign_id, creator_id, price_cents, terms  # 私下议价通道
LedgerEntry: id, campaign_id, conversion_id, creator_id, amount_cents, kind
```

`Conversion.seq` 是全局递增序号，**结算顺序以它为准**。

## 6. 定价算法（MVP 的核心）

常量（可配置）：

- `start_price = round(0.3 × max_cac)`
- `step = round(0.1 × max_cac)`
- `tick = 1 天`

每个 tick：

1. 估计在价格 p、剩余天数 d 下还能拿到的转化数 `supply(p, d)`。**这一步由 agent 做**，
   输入是历史转化曲线和当前参与的 creator 数，输出是一个区间估计。
2. 计算两种选择下的预期最终用户数：

   ```
   projected(p) = min(current_count + supply(p, d),  budget / p)
   ```

3. 仅当 `projected(p + step) > projected(p)` 时升价。
4. 升价前必须通过预算守恒检查：

   ```
   (verified_count + pending_count) × (p + step) ≤ budget
   ```

   不通过则不升价。

5. 价格永远 `≤ max_cac`，且**单调不降**。

**为什么要追溯统一价**：价格只升不降且人人同价，早期参与的 creator 不会因为先下注而
吃亏，也就没有"等涨价再参与"的动机。代价是升价要消耗已发生转化的预算，所以第 4 步
的守恒检查不可省略。

## 7. agent 与账本的分界

| 交给 Claude | 交给确定性代码 |
|---|---|
| 一句话 → campaign 字段 | 归因（链接 → creator） |
| `supply(p, d)` 的估计 | 升价与否的最终判定（§6 第 3、4 步） |
| creator 侧"要不要参，值不值"的判断 | 预算占用与结算 |
| 议价中的让步策略与话术 | deal 的合法性校验与落库 |

**agent 永远不写账本。** 它只产生 proposal，由代码校验后执行；校验失败就拒绝，
并记录拒绝原因（demo 里要展示这个）。

## 8. 待验证转化如何占用预算

pending 转化按**当前价**占用预算额度，和 verified 一样参与 §6 第 4 步的检查。

- pending → verified：占用转为应付。
- pending → rejected：释放额度。

这样可以防止"验证期内超发"导致结算时超支。

## 9. 私下议价通道（P0-lite，可降级为 P1）

`verified_conversion_total ≥ 50` 的 creator，其 agent 可以发起议价：

- 议题：单价、保底量、截止日、阶梯奖励
- 回合上限 2 轮，双方各带 mandate（creator 的最低到手价、founder 的价格弹性，互相不可见）
- 成交价 `≤ max_cac`，落成一条 `Deal`，该 creator 之后按 deal 价结算，不影响公开价
- 不得泄露对方的私有约束（有对应测试）

## 10. 模拟器与对比实验

一组合成的 creator，每个带隐藏的最低接单价和产能上限。同一组数据跑两种策略：

| 策略 | 用户数 | 平均 CAC | 预算使用率 |
|---|---|---|---|
| 固定 $10 | | | |
| 动态追溯统一价 | | | |

这一页是 pitch 的核心证据。**必须标明数据为合成数据**，不得表述为已验证的真实效果。

## 11. demo：两幕

**第一幕 · 规模（模拟器）。** 无头 Claude agent 驱动约 30 个合成 creator，时间轴压缩，
几分钟跑完 14 天。大盘展示用户数、平均 CAC、预算使用率，以及与"固定 $10"的对比（§10）。
论点：交易成本趋近于零，长尾小额交易才成立。

**第二幕 · 真人在环的议价（Claude 窗口）。** 沿用 Muse 版 demo 的形式：几个 Claude
窗口（founder、头部 creator），主人用自然语言授权，agent 在 mandate 内自主，**超出
mandate 就回头问主人**（例如"对方要 $7，高于你的最低价，要接受吗？"），确认后落成 `Deal`（§9）。
这一幕通过 Claude.ai / Claude Desktop 的自定义连接器接入平台的 MCP，接入要求见 §15。

- 种子 campaign 就是**推广 Dealoop 自己**（顺便回答冷启动问题）
- 约 30 个 creator agent，其中 1 个满足议价门槛
- 第二幕的 founder 与 creator 是两个独立的 Claude 会话，各自连接各自的账号

## 12. 前置条件（pitch 里要明说）

- 平台已解决冷启动，供需两侧都有足够参与者
- 转化验证的反作弊能力已存在
- 结算与合规（资金、税务、广告披露）已存在

## 13. Out of scope

明确不做，但在 pitch 里作为扩展方向提及：

- 批次 / 预留 / 配额认领
- 转介绍与派单 override（其正确位置是**平台自己的增长 campaign**，不是 founder campaign）
- 盈余分配、质量奖金
- 平台费模型（MVP 写死为 0）
- 有数量上限的 founder 分支（MVP 一律按"越多越好"处理）
- 黑名单、违规处理、争议仲裁
- 真实社交平台 API 接入（roster 用假数据）
- 真实支付与打款

## 14. 仍未决

- 黑客松的提交要求与评审标准
- 第二幕的公网地址方案（隧道还是部署），决定 `DEALOOP_ORIGIN` 的取值

## 15. Claude 接入要求（第二幕）

以下来自 Claude 官方文档 [Authentication for connectors](https://claude.com/docs/connectors/building/authentication)，
查证日期 2026-11-11：

| 要求 | 现状（继承自 Muse） |
|---|---|
| 回调 `https://claude.ai/api/mcp/auth_callback`（web、Desktop、mobile 共用）；文档提示将来可能改为 `https://claude.com/api/mcp/auth_callback`，两个都放行 | **不满足**：`backend/oauth.ts` 只接受写死的 Muse 回调，注册时 `redirect_uris` 必须恰好等于它 |
| 支持动态客户端注册（DCR）或 CIMD | 有 DCR（`/oauth/register`），但绑定了上一条 |
| PKCE S256，token 端点接受 `application/x-www-form-urlencoded` | 有 S256；测试里 `/oauth/token` 用 form 编码调用，满足 |
| 授权请求带 `resource`，且必须与用户填入的 MCP 地址完全一致（含路径） | 有资源绑定 |
| 未授权请求返回 `401` 且带 `WWW-Authenticate: Bearer resource_metadata=...` | 满足（已在运行中的服务上验证）：未授权的 `/mcp` 返回 `401` 与 `WWW-Authenticate: Bearer resource_metadata=...`，元数据里 `resource` 即 `/mcp` 地址 |
| 刷新令牌轮换，失效时返回 `invalid_grant` | 有轮换与 `invalid_grant` |
| 发现、注册、token 端点 10 秒内响应，刷新 30 秒 | 本地 SQLite，预计满足 |
| 服务必须是**公网 HTTPS**，不能重定向到别的主机或解析到内网地址 | **不满足**：目前只在 localhost 运行 |
| 若做 IP 白名单，Anthropic 出口网段为 `160.79.104.0/21` | 暂不需要 |
| Claude Code 用回环回调（`http://localhost:<port>/callback`），端口任意 | 非第二幕必需，顺手兼容即可 |

`DEALOOP_ORIGIN` 必须等于用户在 Claude 里填的那个公网地址，否则 `resource` 校验会失败。
