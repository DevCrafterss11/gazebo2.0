# 实验三步骤五：独立任务地图指挥台交付记录

日期：2026-10-31。范围为实验三步骤五的任务指挥交互与视觉迭代，沿用现有统一 Store、服务契约及 Mock Runtime。实验一、实验二及步骤一、二未在本轮修改。现有工作区其他改动与用户文档均保留；未执行提交、推送或清理。

## 业务与操作链路

- 统一资源池保持 15 架无人机；集群启动后待命、不默认分配任务。
- 五种任务独立配置和执行；同一时刻一个任务运行，任务内部支持多机协同。
- 右上角设置 → 编辑资源启用、候选任务类型和地图显示；这些设置不等于实际任务分配。
- 左侧任务卡片「新建任务」→ 专属参数 → 地图绘制区域/目标/航点/运输起终点 → 无人机编组与角色 → 底部「开始当前任务」→ 弹窗确认。
- 不新增教学步骤或五组统一启动流程。确认属于当前任务的安全操作；保存、切换和编辑均不启动任务。
- 执行时底部操作切换为暂停、继续、终止，以及需要时的模拟人工确认；查看单机遥测、实际轨迹及独立返航。
- 切换到其他任务可查看配置，并通过「返回执行任务」回到运行任务。
- 完成/终止后先安全返航降落，保留记录、轨迹和类型专属评价；留在当前任务，可查看结果、返回配置/再次执行或新建任务。集群保持运行。
- 六步教学导航和步骤四保留。步骤五可展开为全屏指挥台，再返回教学页面；切换页面不会重建运行时。

## 地图与图层

地图铺满工作区，左侧任务入口、右侧配置与遥测、顶部状态、底部操作栏覆盖在地图上。打开图层不会缩小地图。面板可收起和滚动；窄屏任务入口可折叠。

地图为实验三自有离线 SVG 二维模拟训练场，含道路、水域、建筑、训练区及 Home 机位，明确标注本地模拟坐标/米。支持平移、缩放、网格、计划路线、实际轨迹、选中无人机及图上编辑。没有导入实验二地图或状态，也不依赖在线底图。Home 机位取自无人机资源中的 homePosition。

配置、无人机编组、点位编辑、历史、结果、遥测、事件作为独立浮层；资源管理为表格弹窗。沿用 MUVA 字体、设计变量和深青面板，五种任务用有限的色条和图标区分。

修复了旧无人机操作面板遮挡绘图点击，以及嵌套弹窗 Escape 同时退出全屏的问题。Escape 优先关闭当前确认/资源弹窗和浮层。

## 本轮文件

新增：

- src/experiments/collaboration/TaskCommand.module.css
- src/experiments/collaboration/components/TaskLayerContents.tsx
- src/experiments/collaboration/components/SimulationTerrain.tsx
- tests/collaboration-map-command-browser.cjs
- 本交付记录及 map-command-2026-10-31 下的验收截图与 result.json

在上一轮已有文件上迭代（部分文件此前即未跟踪，仍保留在工作区）：

- src/experiments/collaboration/TaskWorkspace.tsx：指挥台与任务操作链路。
- src/experiments/collaboration/components/FleetMap.tsx：外部绘图工具、指挥图标和底图、切换时清理弹层。
- src/experiments/collaboration/components/ResourceManager.tsx：嵌套弹窗 Escape 行为。
- src/experiments/collaboration/TaskSettings.tsx：任务操作提示。
- tests/collaboration-browser.cjs：六步回归适配新图层。
- tests/collaboration-command-browser.cjs：全屏、焦点和取消操作回归。
- package.json：增加 test:collaboration-map-browser 命令。

保留复用：TaskSettings、ResourceManager、LiveTelemetry、SelectedDroneTelemetry、TaskResult，以及既有资源模型、任务校验、Zustand Store 和 CollaborationMockRuntime。没有新增第二套运行时。

## 实际验证

环境：本地 Node，Google Chrome，Playwright；开发服务器 http://127.0.0.1:5175。

| 命令 | 实际结果 |
| --- | --- |
| npm run typecheck | 通过 |
| npm run build | 通过；仍有大包体积警告 |
| npm run test:collaboration | 22/22 通过 |
| npm run test:collaboration-map-browser | 通过，五类任务分别执行和产生结果 |
| node tests/collaboration-browser.cjs | 通过，六步流程回归 |
| node tests/collaboration-command-browser.cjs | 通过，全屏/焦点/遥测/取消操作回归 |
| npm test | 115/120 通过，5 项失败在实验二测试；后续 && 串联的实验一地图测试未执行 |
| npm run lint | 无 lint 脚本，无法执行；没有新增忽略规则 |
| git diff --check | 通过 |

全项目失败为实验二的 4 项连续运动安全间距用例（测试 89–92）和 1 项提前返航覆盖缺口用例（104）；本轮未修改实验二代码，未通过删测试或放宽断言处理这些失败。

浏览器验收覆盖：资源多任务资格、无默认分配、五种专属表单、区域/点位编辑、起终点、图层不改变地图尺寸、只启动当前任务、任务类型路线差异、暂停不移动、继续恢复、单机返航、切换后返回执行任务、终止、安全收尾、人工签收、结果与历史、重新配置、地图平移缩放、网格轨迹开关、全屏返回及状态保持。页面错误和控制台错误记录为空。

截图宽度覆盖 1920、1600、1366、768、390；已实际查看桌面同时打开任务入口与配置层，以及窄屏编组层截图，无页面横向溢出。

主要证据目录：

- docs/ui-verification/collaboration/map-command-2026-10-31/
- docs/ui-verification/collaboration/map-command-regression-2026-10-31/
- docs/ui-verification/collaboration/map-command-focus-2026-10-31/

推荐查看：01b-map-with-task-layer.png、02-resource-layer.png、04-1-execution.png、05-1-result.png、09-narrow-layer.png。自动验收结果在 map-command-2026-10-31/result.json。

## 运行与边界

启动：VITE_DATA_SOURCE=mock npm run dev -- --host 127.0.0.1 --port 5175。

访问：http://127.0.0.1:5175/experiments/collaboration，进入步骤五，可点「展开指挥台」。

当前遥测、心跳、任务和返航均为统一 Mock Runtime 驱动的教学模拟。未接入真实飞控遥测或控制；Gazebo、SITL、树莓派和 Hardware 接入均不属于本轮交付。二维训练场不是卫星地图或真实地理坐标。不会将模拟数据显示为真实硬件成功。
