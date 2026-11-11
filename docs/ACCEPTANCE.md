# 不变量与验收场景

每条不变量对应至少一个测试。**先写这些测试，再写实现。**

## A. 账本不变量（任何操作序列后都必须成立）

| # | 不变量 | 测试要点 |
|---|---|---|
| A1 | 一个 campaign 的总支付 ≤ `budget_cents` | 随机生成上千次转化与调价序列后断言 |
| A2 | 公开通道的每笔支付金额 = 该 campaign 的最终价 | 升价后旧转化也必须等于新价 |
| A3 | 有 `Deal` 的 creator，其每笔支付 = deal 价 | |
| A4 | 任何支付单价 ≤ `max_cac_cents` | 公开价与 deal 价都适用 |
| A5 | 一条 conversion 只被支付一次 | 重复验证、重复结算都不得加钱 |
| A6 | 只有 `verified` 的转化会被支付 | pending / rejected 支付额为 0 |
| A7 | `current_price` 单调不降，且永不超过 `max_cac` | |
| A8 | pending 转化占用的额度在 rejected 后被释放 | 释放后总占用回到原值 |
| A9 | agent 产生的任何 proposal，经校验失败后对账本零影响 | 注入恶意 proposal（超预算、超 CAC、改他人余额） |
| A10 | 结算顺序严格按 `Conversion.seq` | |

## B. 定价不变量

| # | 不变量 |
|---|---|
| B1 | 只有当 `projected(p+step) > projected(p)` 时才升价 |
| B2 | 升价后 `(verified + pending) × new_price ≤ budget`，否则不升价 |
| B3 | `supply()` 的估计值无论多离谱，都不能让 A1–A4 被破坏 |

## C. 议价不变量

| # | 不变量 |
|---|---|
| C1 | 回合数 ≤ 2 |
| C2 | 成交价在双方 mandate 的可接受区间内 |
| C3 | 任何一方 agent 的输出都不包含对方的私有约束（最低到手价 / 价格弹性） |
| C4 | 未达成交易时，该 creator 回落到公开价，无副作用 |
| C5 | 只有 `verified_conversion_total ≥ 50` 的 creator 能发起议价 |

---

## 验收场景

### S1 · 一句话建 campaign
**Given** founder 说"帮我的 app 拉新 100 个注册用户，越多越好。预算 $1000，CAC 不超过 $10"
**When** founder agent 解析
**Then** 生成 `goal_count=100, budget=100000, max_cac=1000, start_price=300`，
并且**因为缺少 deadline 而向 founder 追问**，在得到答复前不创建 campaign。

### S2 · 超额完成（主线 demo）
**Given** 30 个合成 creator，隐藏接单价分布在 $3–$12
**When** 跑完 14 天
**Then** 最终用户数 > 100，平均 CAC < $10，预算使用率 > 95%，且 A1–A7 全部成立。

### S3 · 对比基线
**Given** 同一组 creator 数据
**When** 分别跑"固定 $10"和"动态追溯统一价"
**Then** 后者的用户数严格更多，且两者花费都 ≤ $1000。

### S4 · 升价被预算守恒挡住
**Given** 预算 $1000，已验证 95 个转化，当前价 $10（= max_cac）
**When** 进度落后，agent 建议升价
**Then** 升价被拒绝，`current_price` 不变，拒绝原因可在 UI 上看到。

### S5 · 追溯结算
**Given** creator X 在价格 $4 时产生 10 个转化，之后价格升到 $6
**When** campaign 结算
**Then** X 的这 10 个转化每个都按 $6 支付。

### S6 · 待验证转化不得超发
**Given** 剩余额度只够 5 个转化，但有 12 个 pending
**When** 12 个全部通过验证
**Then** 按 `seq` 顺序支付到预算用尽为止，其余标记为 `unfunded`，总支付仍 ≤ budget。
*（注：这是 MVP 的简化处理。真实产品应在 pending 阶段就拒绝超发，列为 out of scope。）*

### S7 · 恶意 proposal 被拒
**Given** 一个被篡改的 agent 输出，要求以 $50 结算
**When** 提交给核心
**Then** 校验失败，账本零变化，拒绝记录可见。

### S8 · 头部 creator 议价
**Given** creator Y 的 `verified_conversion_total = 200`，当前公开价 $5
**When** Y 的 agent 发起议价，2 轮内达成 $7 + 保底 50 个
**Then** 生成 `Deal`，Y 按 $7 结算，公开价仍为 $5，且 C1–C4 成立。

### S9 · 议价失败
**Given** creator Y 的最低到手价 $12 > `max_cac` $10
**When** 议价 2 轮
**Then** 无 deal，Y 回落到公开价，可以选择不参与，campaign 不受影响。

### S10 · 私有约束不泄露
**Given** 议价全过程的 agent 输出
**When** 检查文本
**Then** 不包含对方的最低到手价或价格弹性数值。
