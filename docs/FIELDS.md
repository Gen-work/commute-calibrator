# FIELDS.md｜字段词典

临时记录器与正式版共用这一份、共用一个 `schemaVersion`。只写定义，不含数据。站名一律用脱敏代号，真实站名只在私有规格书里。和 [`SPEC.md`](SPEC.md) 的数据模型冲突时，以本词典为准。

## 改动记录

| schemaVersion | 改动 | 决定者 |
|---|---|---|
| 2 | 临时记录器 v2 上线（`observedAt` 等） | owner |
| 3（草稿） | `observedAt` 改名 `tappedAt`；新增 `reportedAt`／`reportedPrecision`／`reportedSource`／`inferredAt`*／`recordedBy`／`placeFree`／`serviceStatusCorrected`／`correctionSource`／`correctedBy`／`correctedAt`／`updatedAt`／`rev`；新增事件 `CHECK_IN`；`direction` 改用 `outbound`／`inbound` | owner |

\* 只预留，不实现。

## 规则

1. **原值不动**：当时按下或写下的值永不改写；更正与推断一律写进别的字段，并带来源。
2. **含义变了就换名**：旧名不复用；改含义就升 `schemaVersion`，并在上表记一行。
3. **同类备注出现三次就升格成字段**；同类自定义节点出现三次就升格进核心事件。
4. **回填带来源**：凡是从备注解析、口述补记或推断得来的值，都写明来源。
5. **运行状况**：`serviceStatus` 保留原值；更正写进 `serviceStatusCorrected`。祝日更正当天全部行（`correctionSource=calendar`）；延误从记下延误的那一行起更正（`self-report`）；官方延误（遅延証明書等）另存为 `ServiceNotice`（`observer=official`，`publishedAt`），不更正本人的行。

## CheckpointEvent（本人观测，一行一个事件）

| 字段 | 类型 | v2 | v3 | 定义 |
|---|---|---|---|---|
| id | string | ✓ | ✓ | `sessionId-写入毫秒`。尾部毫秒是写入时刻（补记行同样是写入时刻） |
| schemaVersion | int | 2 | 3 | 本行写入时的版本 |
| sessionId | string | ✓ | ✓ | 一程，形如 `YYYYMMDD-AM-HHMM` |
| direction | enum | AM／PM | outbound／inbound | v2 存 AM（去公司）／PM（回家）；导入时转换 |
| event | enum | ✓ | ✓ | 核心事件，见下表 |
| place | string | ✓ | ✓ | 站点代号。表外站：`place` 留最近的表内站，同时写 `placeFree` |
| placeFree | string | — | ✓ | 表外站的手输文字 |
| car | string | ✓ | ✓ | 车厢／门，自由文字 |
| context | string[] | 中文标签 | slug | 情境标签，见下表 |
| note | string | ✓ | ✓ | 自由备注，原样保存 |
| observer | enum | self | self | 谁观测的。本人＝self |
| recordedBy | string | — | ✓ | 谁写进数据库的：self 或代写的 agent 名。口述补记时 observer=self、recordedBy=写入者 |
| tappedAt | ISO 时刻／null | （observedAt） | ✓ | 按键时刻，系统时钟。v2 的 observedAt 读时映射到这里；补记行见下方映射 |
| reportedAt | ISO 时刻 | — | ✓ | 本人自报的时刻（备注里的「0743」、口述的「0906」） |
| reportedPrecision | enum | — | ✓ | exact／approx／estimated ＝ 精确／约／推定 |
| reportedSource | enum | — | ✓ | tap-adjust（补时按钮）／note（备注解析）／oral-report（口述补记） |
| inferredAt | ISO 时刻 | — | 预留 | 传感器拟合时刻；另带 inferredMethod、confidence |
| serviceStatus | enum | ✓ | ✓ | normal／disrupted／holiday，按下时的原值，永不改写 |
| serviceStatusCorrected | enum | — | ✓ | 更正后的运行状况，取值同上 |
| correctionSource | enum | — | ✓ | self-report／calendar／delay-certificate（可扩展）。只用于运行状况更正 |
| correctedBy／correctedAt | string／ISO 时刻 | — | ✓ | 谁、何时做的更正 |
| updatedAt | ISO 时刻 | — | ✓ | 最后修改时刻 |
| rev | int | — | ✓ | 修订号，从 1 起 |

有效时刻（引擎用）：inferredAt（置信度达到阈值时）＞ reportedAt ＞ tappedAt，精度越低权重越低。

### 核心事件（10 个）

| event | 去程显示 | 回程显示 |
|---|---|---|
| DEPART | 出门 | 离开公司 |
| GATE_IN | 进改札 | 进改札 |
| PLATFORM | 到站台 | 到站台 |
| QUEUE_START | 开始排队 | 开始排队 |
| BOARD | 上车 | 上车 |
| SEATED | 坐下 | 坐下 |
| ALIGHT | 下车 | 下车 |
| GATE_OUT | 出改札 | 出改札 |
| ARRIVE | 到公司 | 到家 |
| CHECK_IN | 签到（办公室签到，迟到判定点） | — |

自定义节点挂在两个核心事件之间（`RouteConfig.customCheckpoints.between`），引擎只认核心层。

### 情境标签

| v2 中文 | slug | 含义 |
|---|---|---|
| 独自 | alone | 一个人通勤 |
| 同行 | accompanied | 和人一起 |
| 便利店 | convenience-store | 中途进便利店 |
| 回消息 | replying-messages | 途中停下回消息 |
| 满员没上去 | missed-full-train | 车太满没挤上 |
| 身体不适 | unwell | 状态不好 |
| 忘东西折返 | returned-for-item | 出门后回去拿东西 |

## v2 → v3 读时映射

| v2 情况 | tappedAt | reportedAt | reportedPrecision | reportedSource | recordedBy |
|---|---|---|---|---|---|
| 普通按键行 | observedAt | 备注里能解析出时刻就填 | 按备注：纯数字 exact，「左右」「大概」approx | note | self |
| 备注以「事后补记」开头，且 id 尾部毫秒 ≠ observedAt | id 尾部毫秒 | observedAt | 备注写「分精度」→ exact；「时刻约」→ approx | oral-report | 备注写「雨会代记」→ 雨会，否则 self |
| 备注以「事后补记」开头，且 id 尾部毫秒 ＝ observedAt（合成 id） | null | observedAt | 同上 | oral-report | 未知（null） |

### 备注里的时刻怎么认（普通按键行）

- 认：「0743」「743」「7:43」「18:41:48」；带「左右」「大概」「约」的记 approx，否则 exact
- 认：「—40s」「-40s」＝实际比按键早 40 秒，记 exact
- 不认：两位数字；「11号车」；后面跟「的车」「发」「発」的车次时刻（如「1948的车」）
- 合理范围：解析出的时刻最多比按键早 90 分、晚 5 分，超出就当作不是自报时刻
- 日期取按键时刻在当地时区（+09:00）的那一天
- 带时区写法的 observedAt（如 `+09:00`）读时统一成 UTC 的 `Z` 形式

## 打卡器 v7 新增（草稿，schemaVersion 待定）

临时记录器 v7 已经开始写这些字段；正式版先原样保留、读时不报错，定稿后再升版本并写迁移。

| 字段 | 类型 | 定义 |
|---|---|---|
| seat | enum | 坐没坐到：`seated`（坐到了）／`none`（没座）／`midway`（中途坐下，通常先有一行 none）。主要在 SEATED 行；一程结束自查时补的写在 BOARD 行上 |
| reportedOffsetSec | int | 补时：实际时刻比按键早（负）或晚（正）多少秒。有它时 reportedAt ＝ tappedAt ＋ 这个值 |
| reportedSource | enum | 新增取值：manual-edit（点行改时刻）、self-check（一程结束自查时补） |
| placeSource | enum | 站名从哪来：fixed（路线上必然是这一站）／same-as-prev（和上一行同站）／history（按历史猜）／gps／manual／self-check |
| placeGuessed | bool | 站名是猜的，界面上标「猜的」 |
| geo | object | 定位只存精度、到最近站的距离、最近站代号，**不存坐标** |
| transfer | bool | 这次上车是换乘 |
| uiVersion | string | 写这一行时的记录器版本，如 `v7` |
| autoTrigger | string | 快捷指令自动打点的来源，如 `auto-leave-home` |
| observer | enum | 新增取值：device（快捷指令等设备自动观测）；这时 recordedBy 写快捷指令 |
| reviewNote／reviewSource／reviewedBy／reviewedAt | string／enum／string／ISO 时刻 | 事后复核：复核意见、依据、谁、何时。原值不动 |
| contextAdded | string[] | 按完之后补的情境标签（slug）。`context` 只存按下之前点的，两者分开，事后补的可以打折看。读的时候取两者的并集。正式版（app-0.1）起有 |

复核字段的取值：

- `reviewSource`：`self-check`（一程结束后的自查卡，本人回答）／`oral-report`（事后问本人、由 agent 代记）
- `reviewedBy`：`self`（自查）或代记的 agent 名
- `reviewNote`：自由文字。自查卡的固定写法有「自查：这几条是一起补按的」「自查：不是补按」「自查：坐没坐到不记得」「自查：站名不记得」「自查：终点不记得」

