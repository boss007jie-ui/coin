# Watchdog SPEC Template

Use this template when Mission Watchdog returns `Yellow` or `Red`.

Save the completed file under:

```text
docs/superpowers/specs/YYYY-MM-DD-watchdog-<short-topic>-spec.md
```

## Template

```markdown
# Watchdog SPEC: <问题标题>

## Watchdog Verdict

- Level: Yellow / Red
- Date: YYYY-MM-DD
- Reviewer: Mission Watchdog

## Problem

用实战交易语言描述问题。说明它为什么会让项目偏离赚钱、风控、执行、复盘或未来自动化交易。

## Evidence

- `文件路径:行号`：证据说明
- `文件路径:行号`：证据说明

## Trading Risk

说明这个偏移如果不修，会带来什么交易风险，例如：

- 错误开仓
- 无法及时止损
- 复盘失真
- 资金暴露过大
- 页面复杂但不能执行
- 指标变多但不能提高盈亏质量

## Desired Behavior

描述修正后的行为。必须落到交易动作、风控动作、复盘动作或提醒动作。

## Proposed Solution

给出解决方案，但不要写代码实现。可以包括：

- 需要新增或修改的模块
- 需要新增的测试
- 需要新增的 Telegram 通知
- 需要新增的风控校验
- 需要新增的复盘字段

## Acceptance Criteria

- [ ] 条件 1
- [ ] 条件 2
- [ ] 条件 3

## Non-Goals

- 不做什么
- 明确哪些范围不属于本次修正

## Implementation Notes for Builder Agent

给后续实现 agent 的提醒。必须强调：

- 不降低逐仓、移动止损、杠杆上限等风控标准
- 不引入实盘下单
- 不触碰密钥
- 不为了页面好看牺牲交易执行
```

