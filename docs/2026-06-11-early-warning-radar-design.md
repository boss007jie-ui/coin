# 早期预警雷达（Early Warning Radar）设计文档

## 概述

在现有「多平台金融资产看板」中新增一个「预警雷达」功能模块，通过聚合免费公开 API 数据，自动扫描并识别具有 LAB/BEAT/RAVE 类代币特征（低流通、高持仓集中度、协调拉盘）的加密货币，在其暴涨前发出预警通知。

## 方案选择

**方案 A：免费公开 API 聚合 + 评分引擎**

- 零额外成本，全部使用已有的 Etherscan Key + 免费 DexScreener API
- 与现有 server.js 单文件架构完美融合
- 复用现有 fetch/cache 基础设施和 .env 配置模式
- 可渐进增强（未来插入 BubbleMaps/Nansen 等付费 API）

## 架构

### 后端（server.js 扩展）

三层管线架构：

1. **代币发现层** — 从多个数据源发现候选代币
2. **信号分析层** — 对每个候选代币采集 6 个维度的链上/市场数据
3. **评分引擎** — 加权求和计算 0-100 风险评分

定时任务每 5 分钟执行一次扫描，结果缓存在内存中。

### 前端（public/ 扩展）

- topbar 新增「🔔」按钮
- 点击打开 earlyWarningDialog（复用现有 dialog 样式）
- 展示预警卡片列表 + 风险评分 + 信号明细

### 数据持久化

- `data/radar-watchlist.json` — 用户自定义监控列表和配置

## 代币发现层

| 来源 | 端点 | 发现目标 |
|------|------|---------|
| DexScreener Boosted | `GET /token-boosts/top/v1` | 正在被付费推广的代币 |
| DexScreener New Profiles | `GET /token-profiles/latest/v1` | 刚注册 profile 的新代币 |
| Binance 24hr Ticker 异动 | 已有 `getBinanceTickerMap()` | 已上 CEX 但突然放量的小币 |
| 用户自定义监控 | `data/radar-watchlist.json` | 手动添加的合约地址 |

## 评分引擎

### 六维信号模型

| # | 信号维度 | 检测方法 | 权重 | 满分条件 |
|---|---------|---------|------|---------|
| 1 | 持仓集中度 | Etherscan Top Holders API：前10钱包占比 | 30% | ≥85% 得满分，60-85% 线性 |
| 2 | 交易量/市值比 | DexScreener 24h Volume ÷ MarketCap | 20% | ratio ≥ 1.0 得满分 |
| 3 | 价格加速度 | 1h涨幅 > 15% 且 6h涨幅 > 50% | 15% | 同时满足得满分 |
| 4 | 流动性异常 | DexScreener liquidity 变化倍数 | 15% | ≥5x 得满分 |
| 5 | 代币年龄 | 合约部署时间 | 10% | < 30天得满分，30-180天线性 |
| 6 | CEX 上线信号 | Binance/OKX 是否有上线该币 | 10% | 有上线公告得满分 |

### 风险及投资建议等级

- 🔴 **高危 (Score ≥ 70)**：强烈符合拉盘控盘特征，倾销风险极高。
- 🟡 **中危 (Score 50-69)**：存在多个链上和市场波动信号，值得关注。
- 🟢 **低危 (Score < 50)**：常规波动或暂无异动，保持观望。

#### 实操投机状态标注 (UI Card Flags)：
- 💎 **蓄势埋伏期 (控盘完成/尚未拉升)**: 代币评分 $\ge 50$ 且 1h 价格涨幅 $< 15\%$ 且代币年龄 $< 14$ 天。此阶段庄家蓄势待发，但还没有拉升价格，是“提前埋伏”的最佳时间点。
- 🚀 **拉盘爆发期 (正在冲高/谨防接盘)**: 代币评分 $\ge 65$ 且 1h 价格涨幅 $\ge 15\%$。说明爆发动作已经发生，适合平仓获利了结，切忌追高跟进。
- 🔎 **观望分析期**: 正常代币，无特别的筹码集中或拉盘动作。

### 历史验证（RAVE 还原）

持仓集中度 93% → 30/30，量/市值比 1.8 → 20/20，价格加速 +22%/+180% → 15/15，
流动性 4.2x → 12/15，部署 45 天 → 7.5/10，Binance 已上线 → 10/10。
**总分 94.5 → 🔴 高危** ✓

## 前端 UI

### 入口

topbar 按钮区域新增「🔔」图标按钮，与现有 ↻ ＋ ⇩ ⇧ 按钮并排。

### earlyWarningDialog 结构

**顶部统计栏：**
- 高危/中危数量统计
- 上次扫描时间
- [立即扫描] 按钮

**预警卡片列表：**
每个代币一张卡片，包含：
- 风险评分（带颜色标识）+ 代币名称 + 所在链
- 6 个信号维度的进度条和得分
- 价格、市值、发现时间
- 外链按钮（DexScreener、Etherscan）

**底部配置区（可折叠）：**
- 添加/删除自定义监控合约地址
- 扫描频率设置（1/3/5/10 分钟）
- 通知开关

## API 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/radar/scan` | 触发扫描并返回结果（含缓存） |
| GET | `/api/radar/config` | 获取当前配置 |
| POST | `/api/radar/config` | 更新配置（监控列表、扫描频率等） |

## 通知系统

第一版实现：
- 浏览器 Notification API — 新代币进入高危时桌面弹窗
- 页面内 toast — 复用现有 `#toast` 组件
- 可选声音提示 — `AudioContext` 生成 beep 音

后续扩展：Telegram Bot 推送。

## 配置文件格式

`data/radar-watchlist.json`:
```json
{
  "version": 1,
  "scanIntervalMinutes": 5,
  "notificationsEnabled": true,
  "soundEnabled": false,
  "customTokens": [
    {
      "address": "0x...",
      "chain": "ethereum",
      "label": "可疑代币X",
      "addedAt": "2026-06-11T..."
    }
  ],
  "mutedTokens": []
}
```

## 依赖

无新增 npm 依赖。全部使用 Node.js 内置模块 + 现有的 fetch 基础设施。
