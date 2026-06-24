# Live Adapter Refusal Gates SPEC

日期: 2026-06-24

## 背景

项目目标是交易实战，但当前阶段必须停留在模拟盘和规则验证。未来如果接入 Aster、Binance、OKX、Bybit 或其他合约交易所 API，live adapter 不能只是把模拟信号翻译成实盘订单。它必须先做拒单校验，把风险约束放在捕捉机会之前。

本 SPEC 只定义未来 live adapter 的拒单边界、反馈闭环和验收标准，不引入实盘下单能力，不包含任何密钥、Telegram token、VPS 密码或交易所凭证。

## 不可突破原则

- `needsReview` 只能让系统更保守，不能被未来自动化绕过。
- 模拟盘分组结果必须继续反哺规则，不能只作为报表展示。
- 逐仓、移动止损、5x 以下杠杆上限、风险仓位必须保持硬约束。
- 日亏 `5%`、本金 `500 USDT` 防线必须优先于捕捉机会。
- 策略版本变更后必须继续使用 `1000 USDT` 新本金重启模拟盘，避免旧账本污染新策略评估。
- 不能为了提高开仓数量降低多角度证据门槛。
- 不能把 `needsReview` 当作页面提示而不是交易阻断。
- 不能在本 SPEC 中引入实盘下单。

## 设计目标

未来 live adapter 应该接收一个交易意图对象，但在生成任何交易所请求之前先返回明确的 allow/reject 决策。拒单结果必须可审计，包含拒绝原因、触发的风险门、关联的模拟反馈、策略版本和时间戳。

### 输入

live adapter 的输入应来自已通过模拟盘逻辑的 order intent，而不是直接来自 radar token。order intent 至少包含:

- `symbol`
- `side`
- `entryIntent`
- `marginMode`
- `stopLossMode`
- `stopLossPct` 或等价移动止损参数
- `leverage`
- `riskPct`
- `notionalUsdt`
- `strategyVersion`
- `entryEvidence`
- `paperFeedback` 或 setup-level feedback key
- `dailyLossGuard`
- `accountGuard`

### 输出

adapter 必须先返回一个安全决策:

```json
{
  "action": "reject",
  "reason": "needs-review-block",
  "hardGate": true,
  "symbol": "LABUSDT",
  "side": "long",
  "strategyVersion": "2026-06-23-multi-evidence-reset-v1",
  "checkedAt": "2026-06-24T10:00:00.000Z",
  "details": {
    "setupKey": "baseline|long|watch-long|continuation|acceleration"
  }
}
```

V1 只需要定义并测试 `allow/reject` 结果，不发送真实交易所请求。

## 硬拒单条件

这些条件一旦命中，live adapter 必须拒单。拒单优先级高于任何 attention score、行情机会、人工偏好或自动化开仓数量目标。

| 优先级 | 拒单条件 | 拒绝原因 | 说明 |
| --- | --- | --- | --- |
| 1 | 当日已实现亏损达到或超过 `5%` | `daily-loss-limit` | 使用北京交易日。触发后当天不允许新开仓，已有仓位只能继续按止损和退出逻辑处理。 |
| 2 | 模拟或实盘权益低于 `500 USDT` | `capital-stop` | 必须先复盘并切换/确认防守策略，不能继续捕捉机会。 |
| 3 | setup 被 `needsReview` 标记 | `needs-review-block` | 只要同类 setup 仍在需复盘状态，自动化一律拒单。 |
| 4 | `marginMode` 不是 `isolated` | `isolated-margin-required` | 合约必须逐仓；全仓或未知模式拒单。 |
| 5 | 缺少移动止损 | `trailing-stop-required` | 固定止损或无止损都不能通过未来实盘适配。 |
| 6 | 杠杆大于 `5x` 或不是有效正数 | `leverage-cap-exceeded` | 5x 是绝对上限；策略可以更低，不能更高。 |
| 7 | 风险仓位缺失、非正数或超过策略上限 | `risk-size-invalid` | 必须来自账户风险预算，不允许固定每笔 1000 USDT 或任意放大。 |
| 8 | 多角度证据未达当前策略门槛 | `insufficient-entry-evidence` | 不能为了开仓数量降低证据门槛。 |
| 9 | 同名币、锚价分歧、Funding/溢价过热等强否决出现 | `entry-veto` | 与现有 entry evidence veto 保持一致。 |
| 10 | 策略版本不匹配或模拟账本未重置 | `strategy-version-mismatch` | 未来实盘只能消费当前策略版本下的模拟反馈。 |

## needsReview 反馈闭环

`needsReview` 不是通知标签，而是交易阻断状态。

### 进入 needsReview

沿用现有 paper feedback 的 setup-level 统计。当同类 setup 样本达到门槛且出现负收益、低胜率、连续亏损或风险实现差时，标记 `needsReview`。该标记应被 paper trading、future live adapter 和 Mission Watchdog 同时视为风险输入。

### 阻断范围

阻断键至少包含:

- experiment group
- side
- action setup
- review label
- phase

如果后续添加更细粒度字段，例如 evidence profile、market regime 或 exchange venue，阻断键可以扩展，但不能缩小到绕过原有 setup 风险。

### 解除或降权

如果 `needsReview` 积累过多但无人处理，需要新增复盘流程，而不是忽略阻断。解除必须满足以下条件之一:

- 人工复盘后明确记录调整结论，并生成新的策略版本。
- 规则降权后重启 `1000 USDT` 模拟盘，新的策略版本取得足够样本且不再触发原 review 条件。
- 明确将该 setup 永久列入禁用名单。

解除动作必须留下审计记录，包含复盘时间、原因、处理人、旧策略版本、新策略版本和影响范围。

## 策略版本和模拟盘重置

当前机制中，策略版本变更会归档旧模拟账本并用 `1000 USDT` 新本金重启模拟盘。未来 live adapter 必须依赖这一机制:

- 只能读取当前 `strategyVersion` 的模拟结果。
- 不允许用旧策略账本的盈利样本证明新策略可实盘。
- 不允许用旧策略账本的亏损状态长期压制新策略，但旧亏损必须保留在归档中用于复盘。
- 每次策略修改后都应先观察新模拟盘，而不是直接打开 live adapter。

## Live Adapter 边界

V1 live adapter 只能做 dry-run 风控评估:

1. 接收 order intent。
2. 读取当前 paper feedback、strategy state、daily loss guard、account guard。
3. 运行硬拒单条件。
4. 返回 `allow` 或 `reject` 决策。
5. 记录审计日志。

V1 不做以下事情:

- 不连接交易所私有 API。
- 不创建真实订单。
- 不读取或保存密钥。
- 不发送可被交易所执行的 payload。
- 不提供一键实盘开关。

## 审计和可观察性

每次拒单都应记录:

- symbol、side、intent id
- strategyVersion
- refusal reason
- hardGate 是否为 true
- needsReview setup key
- risk parameters: leverage、marginMode、stopLossMode、riskPct
- entryEvidence angle count 和 vetoes
- checkedAt

Telegram 或 UI 可以显示拒单摘要，但显示层不能改变拒单结果。

## 测试要求

实现 live adapter dry-run 时必须先写测试，至少覆盖:

- 无逐仓时拒单。
- 无移动止损时拒单。
- 杠杆超过 `5x` 时拒单。
- `needsReview` 命中时拒单。
- 日亏 `5%` 命中时拒单。
- 本金低于 `500 USDT` 时拒单。
- 多角度证据不足时拒单。
- 策略版本不匹配时拒单。
- 所有硬约束满足时才返回 `allow`。
- 拒单记录包含可审计 reason 和 details。

## 验收标准

- live adapter dry-run 没有任何真实下单能力。
- 所有硬拒单条件都有独立测试。
- `needsReview` 不能被参数、UI、自动扫描或 live adapter 配置绕过。
- 日亏 `5%` 和本金 `500 USDT` 防线优先于开仓。
- 逐仓、移动止损、杠杆上限和风险仓位在 adapter 层重复校验，而不是只相信上游。
- 策略版本变更后的 `1000 USDT` 模拟重启机制保持有效。
- 文档、测试和代码都明确禁止为了提高开仓数量降低证据门槛。
