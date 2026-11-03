# 实验三：独立实时指挥视图验收（2026-10-30）

本轮仅扩展步骤5，在原有页面顶部新增「打开实时指挥视图」按钮。实验一、实验二、实验三步骤1/2及六步教学导航均未调整。未修改运行时、服务适配器或任务业务模型，未提交或推送代码，未清理用户文档和 dump 文件。

## 界面与操作

- 使用原生全屏 `dialog` 和 React Portal，提供类似独立页面的操作空间；支持关闭按钮、Escape、模态焦点约束与关闭后入口焦点恢复。
- 原工作区与全屏视图复用同一份任务配置、任务确认、控制栏、资源管理和执行结果 JSX；不会产生第二套任务状态或遥测定时器。
- 左侧：15架无人机遥测卡片，可滚动；选中无人机后列表滚动到对应卡片，卡片选择联动地图。显示来源、通信状态、模式、解锁、电量、位置、高度、姿态、任务角色、遥测时间、心跳时间。
- 中央：大面积本地2D模拟地图，支持平移、缩放、自动适配、区域/航点编辑、计划路线、实际轨迹、返航轨迹、当前任务成员筛选。新视图图标采用与实验二相同的四旋翼轮廓，原视图图标保持原样。
- 右侧：单机详情、单机模拟返航、当前任务专属参数、无人机选择和角色配置；可新建任务、查看历史。资源弹窗和地图的详情操作在全屏视图内完成。
- 底部：复用开始前摘要确认、暂停、继续、终止、异常处置与事件记录。事件按最近优先展示，遥测按共享运行时快照持续刷新。
- 修复地图悬停信息框固定在左上方时盖住图标、影响点击的问题：根据信息框和图标位置选择邻侧展示。
- 桌面使用三栏，窄屏改为地图、详情、遥测纵向排列，各自保持可读性；窄屏工具栏不悬浮遮挡地图和表单。

任务规则仍是：统一15架资源池、五种独立任务入口、一次只运行一个任务。打开/关闭新视图不启动、暂停或结束任务。完成/终止后保留轨迹与结果，集群继续运行。

## 文件

修改现有实现（包含上一轮未跟踪文件）：

- `src/experiments/collaboration/TaskWorkspace.tsx`：新增全屏入口与模态生命周期，同一份工作区按展示模式组合。
- `src/experiments/collaboration/components/FleetMap.tsx`：可选四旋翼图标、详情回调、信息框避让。
- `src/experiments/collaboration/components/ResourceManager.tsx`：可选详情回调，保持默认入口行为。

新增：

- `src/experiments/collaboration/LiveCommand.module.css`：仅作用于新视图的三栏、遥测、地图和响应式样式。
- `src/experiments/collaboration/components/LiveTelemetry.tsx`：实时卡片及选中无人机详情，纯共享状态展示。
- `src/experiments/collaboration/components/AircraftIcon.tsx`：与实验二轮廓一致的四旋翼SVG。
- `tests/collaboration-command-browser.cjs`：新视图的浏览器验收。
- 本文及 `docs/ui-verification/collaboration/command-view-2026-10-30/` 截图。

## 数据边界

当前数据仍来自已有 CollaborationMockRuntime → Zustand Store。界面明确标注「MOCK 教学模拟」「非真实飞控数据」，没有额外网络连接、飞控指令、SSH 或进程启动。

只读调查确认现有后端有 `/ws/telemetry`、实验二 `/ws/swarm` 等遥测能力，但这些能力不等于实验三15台树莓派已经接入；本轮没有接通这些接口，也没有声称收到15架真实飞控数据。真实接入需后续在适配层完成映射、时效和指令确认。

## 验证

开发地址：`http://127.0.0.1:5175/experiments/collaboration`

启动：

```bash
export PATH=/home/vip/muva/.tools/node/bin:$PATH
VITE_DATA_SOURCE=mock npm run dev -- --host 127.0.0.1 --port 5175
```

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过，保留既有大包体提示 |
| `npm run test:collaboration` | 22/22通过 |
| `npm run lint` | 项目无 lint 脚本，未声称通过 |
| `npm test` | 115/120，实验二既有5项失败：89–92连续运动间距、104提前返航；主测试失败后脚本未继续执行实验一地图测试。本轮未改动相关模块 |
| `node tests/collaboration-command-browser.cjs` | 通过；浏览器无控制台错误/页面异常 |
| 原 `tests/collaboration-browser.cjs` | 通过；使用临时副本仅更换截图目录，原文件与历史截图未覆盖 |
| `git diff --check` | 通过 |

浏览器验证实际通过UI完成：启动集群后无任务；打开/关闭视图；15架卡片和标记；列表/地图双向选中；资源资格编辑；巡逻区域绘制；任务摘要、Escape取消确认、明确启动；遥测时间和位置变化；暂停位置和进度冻结；继续；取消/确认单机返航；返航轨迹和其他无人机继续；关闭后后台任务仍更新；重新打开状态保留；任务自然完成、再次执行、取消/确认终止、安全收尾、结果与集群保留。

原六步回归还覆盖五种独立任务、运输起点/交付点、任务历史、评价、异常降级、停止确认。

视口：1600×1000、1920×1080、1366×768、768×1024、390×844；校验页面/对话框无横向溢出，地图高度可用，窄屏详情与遥测可滚动访问。

关键截图：

- `command-view-2026-10-30/01-existing-workspace.png`：原工作区新增入口。
- `command-view-2026-10-30/02-global-desktop.png`：15架初始阵列与实时遥测。
- `command-view-2026-10-30/03-paused-desktop.png`：任务运行轨迹与暂停控制。
- `command-view-2026-10-30/04-single-return.png`：单机返航。
- `command-view-2026-10-30/05-responsive-1366.png`、`05-responsive-390.png`：桌面与窄屏地图。
- `command-view-2026-10-30/05-narrow-details.png`、`05-narrow-telemetry.png`：窄屏单机操作与卡片。
- `command-view-2026-10-30/06-result-desktop.png`：任务结果与保留轨迹。

上述截图相对 `docs/ui-verification/collaboration/`。六步回归截图另存 `command-view-regression-2026-10-30/`。

## 步骤4

新视图在任务执行时已经覆盖机队遥测与单机操作需求。按本轮「保持整体不动」保留步骤4，作为任务前的集群检查教学入口，不增加第二份运行数据。后续如果精简教学步骤，可合并展示入口；本轮没有删除或重新编号教学导航。
