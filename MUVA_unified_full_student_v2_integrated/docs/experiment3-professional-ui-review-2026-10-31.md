# 实验三地面站指挥平台 UI/UX 优化验收

日期：2026-10-31  
运行地址：`http://127.0.0.1:5175/experiments/collaboration`

## 范围与边界

本轮基于已有实验三实际运行页面和 CSS Modules 迭代，不替换中央地图、五类任务、顶部业务导航、右侧工具和底部控制区的总体结构。教学步骤五入口与展开指挥平台保持独立，返回教学页后不嵌入压缩版地图。

仅调整实验三的展示、地图编辑交互与相应浏览器断言；继续调用现有 Store 动作、任务生命周期、地图坐标转换和 Mock Runtime。没有修改运行时、服务或五类任务执行逻辑，没有新增依赖，没有接入真实遥测或硬件控制。工作区此前的其他修改均保留。

## 实际修改

### 任务入口与调度

- 新增 `components/TaskOverviewPanel.tsx`：五种任务常驻展示，包含任务状态、参与数量、查看任务和新建任务；侧边把手控制整栏收展，选择任务不会自动收起任务栏。
- 未分配成员、无点位且尚无执行记录的空任务显示“待配置”；其余直接展示已有生命周期，不修改业务状态。
- 上方五类任务、下方独立调度区分层；调度区显示当前任务、进度和归档入口，大屏补充名称、高度、策略、运行记录。
- 在 2048×1152、1600×900、1366×768 三种桌面尺寸，五卡及调度区无需滚动。短屏使用两行紧凑卡，确保人数和两个操作按钮都在卡片边界内；手机保留可滚动抽屉作为响应式退路。

### 地图与绘制

- 调整实验三独立矢量底图的背景、道路与建筑对比色；保留矢量、卫星、坐标网格三种底图及现有坐标配准，不通过放大位图假装提高分辨率。
- 右侧工具补充全机视野、底图面板、图层面板、两点水平测距、经纬度/ENU 拾取。坐标拾取不写入任务点位。
- 图层独立控制区域填充、计划航线、点位、实际/返航轨迹及网格。
- 区域类任务显示半透明填充和水平面积；运输路线不误填为区域。复用现有几何校验反馈。
- 点位支持鼠标拖动、方向键移动 1m、Shift+方向键移动 5m；通过现有 Store 更新点位，执行锁定和历史快照下不允许编辑。配有绘制与编辑提示。
- 保留同一套 ENU/WGS84 相机与米制位置，未在 UI 层生成假遥测。

### 信息层级与覆盖面板

- 顶部按任务规划、执行监控、任务档案分组，避免工具平铺拥挤；全局态势只展示相关监控工具。
- 底部状态区与操作区分层，保留已有配置、执行、完成等状态对应的操作分支。
- 任务参数、编组、点位及地图工具使用覆盖式浮层；地图工具与任务参数浮层互斥，打开面板不改变地图画布尺寸。
- 消息提示浮在底部状态区上方，不再增加底部高度挤压左侧任务栏。
- 统一深蓝/深青面板、青蓝强调色、图标尺寸、间距与按钮样式，降低发光和边框干扰。
- 资源管理继续使用独立大型模态，完整保留 15 架资源表格。

## 三轮审查与修复记录

1. **布局与信息层级**：发现左侧入口被 HUD 和底部高度挤压，原页面需要滚动才能看到全部任务。重排五卡和独立调度区，验证三种桌面尺寸完整可见；大屏任务卡不再无节制拉高。
2. **交互与业务边界**：检查图层、底图、测距、拾取、绘制、顶点拖动、键盘编辑和 15 架资源表。修复工具按钮继承通用 padding 后图标被挤小的问题；检查浮层互斥、Esc 行为及点位锁定，不改执行业务。
3. **边界与回归**：检查教学入口往返、短屏、提示和任务执行生命周期。发现短屏卡片内部元素曾越过卡片边界，改为两行布局并新增子元素边界断言；最终三桌面卡片、调度、提示均无溢出。人工查看原始 2048 和 1366 截图，没有用窄图拉伸模拟宽屏。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；仍有现有大包体积警告 |
| `npm run test:collaboration` | 37/37 通过 |
| `node tests/collaboration-professional-ui-browser.cjs` | 三轮通过；含卡片内部边界、五卡免滚动、画布尺寸不变、地图交互、15 资源行及控制台检查 |
| `node tests/collaboration-entry-browser.cjs` | 通过；步骤五与展开指挥台独立、反复往返及响应式检查 |
| `node tests/collaboration-command-browser.cjs` | 通过；已有执行控制、返航、完成与焦点恢复回归 |
| `node tests/collaboration-map-layout-browser.cjs` | 通过；教学入口及地图面板布局回归 |
| `node tests/collaboration-satellite-browser.cjs` | 通过；16 个真实矢量瓦片响应、16 个真实卫星瓦片响应，坐标配准、运行轨迹、暂停、返航及断网退路 |
| `git diff --check` | 通过 |
| `npm test` | 未全通过：主测试 120 项中 115 通过、5 失败，详见下方 |

新 UI 浏览器报告中的应用 `pageErrors` 和 `consoleErrors` 均为空。卫星断网测试主动屏蔽网络，预期出现地图不可用提示，不将此当成联网成功。

### 全项目现存失败

与此前记录一致，`npm test` 的五个失败均在实验二 `swarm.test.ts`：四个连续运动最小间距用例，以及一个暂停/恢复/提前返航覆盖用例。本轮没有修改实验二代码或降低断言来消除这些失败。由于 npm 脚本使用 `&&`，主测试失败后未进入后续实验一地图测试，不能据此声称全项目测试全部通过。

## 主要文件

- `src/experiments/collaboration/TaskWorkspace.tsx`
- `src/experiments/collaboration/TaskCommand.module.css`
- `src/experiments/collaboration/components/TaskOverviewPanel.tsx`
- `src/experiments/collaboration/components/FleetMap.tsx`
- `src/experiments/collaboration/components/FleetMap.module.css`
- `src/experiments/collaboration/components/TaskLayerContents.tsx`
- `src/domain/collaborationBasemap.ts`
- `tests/collaboration-professional-ui-browser.cjs`（新增）
- 四份既有实验三浏览器回归脚本的 UI 选择器/断言适配。

## 实际截图

目录：`docs/ui-verification/collaboration/professional-ui-2026-10-31/`

- `01-overview-2048.png`：2048×1152 原始桌面全貌。
- `01-overview-1600.png`、`01-overview-1366.png`：较小桌面全貌。
- `02-task-planning.png`：任务规划浮层与业务工具分组。
- `03-map-layers.png`：图层管理。
- `04-distance.png`、`05-coordinate-pick.png`：测距与坐标拾取。
- `06-area-vertex-edit.png`：区域填充、水平面积与顶点编辑。
- `07-resource-table-15.png`：独立模态中的完整 15 架资源表。
- `08-edited-2048.png`、`08-edited-1600.png`、`08-edited-1366.png`：编辑状态多尺寸检查。
- `09-notice-no-catalogue-overflow.png`：提示不挤压任务栏。
- `verification.json`：三轮自动检查摘要。

## 明确限制

- 矢量与卫星地理底图依赖外部瓦片服务和联网条件；离线时可切换坐标网格，核心 Mock 流程不依赖后端。
- 卫星影像原生最高级别仍为 19；过度放大不会产生新的真实影像细节，保留相应提示。
- 当前数据仍为明确标识的 Mock 模拟。本轮验证不是实机联调、飞行安全认证或真实硬件控制验收。
