# 实验三实时视图参考布局修正（2026-10-31）

## 本轮范围与原有问题

本轮针对实时指挥展示混入任务配置、地图面积受面板挤压的问题进行修正。参考左侧逐机遥测、中央浅色二维运动场地图、右侧浮动控制面板的布局。保留既有独立任务配置流程、教学步骤与共享运行时；不修改实验一、实验二，不接入真实控制。

原任务指挥台仍负责五种独立任务的配置、资格、编组和显式确认启动。新增的“集群实时视图”入口只打开遥测与飞行操作展示，不创建、不确认、不启动任务。

## 界面与交互

- 左栏：15 张逐机遥测卡片，显示节点 IP、连接、模式、解锁、坐标、高度、姿态、电量与更新时间。共享运行时更新数据；点击卡片定位地图，重复点击同一无人机也能重新定位。
- 中央：独立绘制的浅色二维运动场底图，15 个独立无人机标记，初始 3×5 阵列。支持平移、缩放、自适应、网格与轨迹开关。无人机符号随地图缩放保持可读大小。
- 右侧：半透明浮动操作面板，覆盖在地图上，不缩小地图容器；自适应视野避开面板。显示选中机状态、地图定位、当前执行控制、航点和实际轨迹。
- 实时视图内移除任务类型导航、任务卡片、教学步骤、任务创建/启动入口与占用地图高度的事件栏。
- 资源设置仍通过右上角图标打开独立表格弹窗。修正其“定位 / 详情”默认跳转教学步骤4的问题：现在保持在实时视图并定位。
- 当前任务结束后显示最近一条执行记录的计划航线，保留无人机轨迹。关闭或重新打开视图不停止集群、不重置任务。
- 窄屏默认收起右侧面板，可按需展开；手机地图与遥测列表上下排列。地图按等比例米制坐标显示，避免纵向拉伸；修正手机图例与工具按钮重叠。
- 返回任务工作区后恢复入口焦点。嵌套资源弹窗按 Escape 只关闭该弹窗；实时视图按 Escape 返回原任务工作区。

## 控制与数据边界

页面复用 Zustand store → Service contract → 统一 Mock Runtime，不增加模拟定时器，不从组件生成遥测，不请求真实飞控。

已支持的暂停、继续、确认终止及单机返航调用已有 Store 动作。返航需二次确认，只作用于选中无人机；当前任务暂停时单机仍可安全返航，其他成员保持暂停。任务结束或终止后集群保持运行。

解锁、锁定、独立起飞、手动摇杆、APM/PX4 模式切换尚无对应服务能力，保持禁用并标记未接入。界面始终标记 Mock / 本地模拟，不将这些展示控件或模拟心跳宣称为真实控制或真实连接。

## 本轮文件

新增：

- `src/experiments/collaboration/LiveCommandView.tsx`：独立实时视图。
- `tests/collaboration-live-reference-browser.cjs`：参考布局、共享状态和控制回归。
- 本验收记录与 `docs/ui-verification/collaboration/live-reference-2026-10-31/` 中的截图、测试结果。

迭代已有工作区文件（部分在本轮开始前即为未跟踪文件）：

- `src/experiments/collaboration/TaskWorkspace.tsx`：新增实时视图入口，保留原全屏任务工作区。
- `src/experiments/collaboration/LiveCommand.module.css`：实时视图、浮动面板、窄屏布局。
- `src/experiments/collaboration/components/FleetMap.tsx`：实时展示变体、等比例地图、定位请求、固定符号尺寸及最近航线展示。
- `src/experiments/collaboration/components/SimulationTerrain.tsx`：实时视图二维运动场底图。
- `src/experiments/collaboration/components/LiveTelemetry.tsx`：精简遥测卡片和重复定位回调。
- `tests/collaboration-map-command-browser.cjs`、`tests/collaboration-command-browser.cjs`：将原全屏任务工作区的弹窗名称明确为“独立任务全屏工作区”，避免与实时视图混淆。
- `package.json`：增加 `test:collaboration-live-browser` 命令，无新增依赖。

用户文档、dump 文件、原有未提交修改均保留；未提交或推送。

## 实际验证

使用仓库已有 Node、Playwright Core 和系统 Chrome。开发服务器为 `http://127.0.0.1:5175/experiments/collaboration`，仍为 Mock 模式。

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；仍有已有的大包体积提示 |
| `npm run test:collaboration` | 25/25 通过 |
| `npm run test:collaboration-live-browser` | 通过；参考布局、15架联动、心跳、地图操作、弹窗、暂停/继续、单机返航、确认取消、终止与安全收尾、轨迹保留、关闭重开状态及焦点 |
| `node tests/collaboration-map-command-browser.cjs` | 通过；五种任务逐项配置和独立执行、地图浮层、资源、角色、暂停/继续/终止、返航、结果和历史 |
| `node tests/collaboration-student-browser.cjs` | 通过；完整六步学生流程与异常处置回归 |
| `node tests/collaboration-command-browser.cjs` | 通过；原全屏任务工作区和实时遥测图层回归 |
| `npm test` | 115/120；5项原有实验二连续运动安全间距/返航规划测试失败，与上一轮基线一致 |
| `npm run test:experiment1-map` | 17/19；2项原有相机缩放预期18、实际17.2，与上一轮基线一致 |
| lint | 项目未配置 lint 脚本，未声称运行通过 |
| `git diff --check` | 通过 |

浏览器覆盖 2048×1152、1600×1000、1366×768、768×1024、390×844。实时视图、全屏任务工作区、学生流程测试均未捕获到页面异常或 console.error。检查了横向溢出、15架显示、面板遮挡、地图比例和手机工具栏；发现的问题已在本轮修正。

## 截图

目录：`docs/ui-verification/collaboration/live-reference-2026-10-31/`

- `01-desktop-standby-1600.png`：待命态15架、左右面板与二维地图。
- `02-full-map.png`：收起右侧面板后的地图。
- `03-independent-return-paused.png`：暂停状态下单机返航。
- `04-executing.png`：执行路线、位置与实际轨迹。
- `05-retained-flight.png`：安全结束后保留的航线与轨迹。
- `07-map-2048.png`、`07-map-1366.png`：桌面布局。
- `07-map-768.png`、`07-map-390.png`：窄屏地图与遥测布局。
- `06-controls-768.png`、`06-controls-390.png`：窄屏展开操作面板。
- `result.json`：实时视图自动验收结果。
- `task-regression/`、`student-regression/`、`immersive-regression/`：原任务工作区与教学流程回归截图。

## 明确限制

实际数据仍全部来自 Mock，真实遥测接入及上述未接入飞控命令本轮未开发、未验证。全项目原有7项失败测试没有通过本轮的视觉改动修复，因此不能称为全项目所有检查通过。
