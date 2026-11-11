<p align="center">
  <img src="public/brand/dealoop-wordmark.png" alt="DeaLoop AI" width="360" />
</p>

# Dealoop — 按验证转化付费的推广市场

founder 用一句话说出推广目标，平台把它变成一个公开的 campaign。creator 的 agent 自助参与，
用带标识的链接推广，每产生一个被验证的转化就即时结算。价格由平台按进度动态调整，
封顶在 founder 的最高 CAC，并且**追溯适用于全部已验证转化**。

- 规格：[docs/SPEC.md](docs/SPEC.md)
- 不变量与验收场景：[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)
- 给 Claude Code 的工作约定：[CLAUDE.md](CLAUDE.md)

> **状态：改造中。** 本仓库由 [mmfish/DeaLoop](https://github.com/mmfish/DeaLoop)（二手交易市场，
> Meta Muse 黑客松作品）导入并重开 git 历史。身份、OAuth、MCP、事件流、幂等等基础设施直接继承；
> 领域模型（posts / offers / deals / shortlist）正在替换为 campaigns / claims / conversions / ledger。
> 继承代码对应的原始说明保留在 [docs/MUSE-README.md](docs/MUSE-README.md)，其中大部分描述的是
> 二手市场的行为，**不代表本仓库当前的目标形态**。

## 本地运行

需要 Node 24（仓库声明 `>=22.13`，AWS 运行时为 24）。本地统一用 **3200 端口**。

开发模式（改代码自动重载）：

```sh
nvm use
npm ci
DEALOOP_ORIGIN=http://localhost:3200 npm run dev:aws -- --port 3200
```

接近生产的方式（先构建再启动）：

```sh
npm run build:aws
DEALOOP_BUILD_TARGET=aws DEALOOP_RUNTIME=aws DEALOOP_ORIGIN=http://localhost:3200 npm run start:aws -- --port 3200
```

`DEALOOP_ORIGIN` 必须与访问地址一致，OAuth 与 MCP 的 `resource` 校验依赖它。
SQLite 自动建在 `data/dealoop.sqlite`，migration 首次使用时自动执行。公开浏览不需要登录；
人类登录需要替换 `config/firebase.json` 为你们自己的 Firebase 项目配置。

## 验证

```sh
npm test
```

```sh
npm run build:aws && npm run check
```

导入时的基线：43 个测试全部通过，`build:aws` 构建成功，服务可启动。

## 模拟器

```sh
npm run sim
```

```sh
npm run sim -- --runs 200 --market baseline --tick 6
```

对比动态价与一组固定价在 baseline、thin、thick 三种合成市场里的表现。结果解读见 [docs/SPEC.md §10](docs/SPEC.md)。

## 数据说明

demo 与 pitch 中出现的 creator、转化和对比实验数据**均为合成数据**，不是已验证的真实投放效果。
