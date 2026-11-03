# 实验三：网页地面指挥平台两轮 UI/UX 审查

日期：2026-10-31

## 范围

基于当前实际运行页面，而不是重新制作概念图。保留全宽网页地面站、中央地图、五种独立任务、共享任务状态和 Mock Runtime。步骤 5 教学入口仍与展开后的独立指挥台分离；不修改实验一、实验二或任务执行业务。

## 第一轮：先审查不足，再修改

基准截图：`ui-verification/collaboration/navigation-review-2026-10-31/00-before-command.png`、`00-before-live.png`。

| 发现的不足 | 修改 |
| --- | --- |
| 实时视图中无人机只剩小点/航向提示，完整四旋翼不可辨识 | 修复地图 SVG 被上层样式取消描边的问题，明确固定 30px SVG、32px 地理锚点，保持四旋翼轮廓、状态色、独立编号和航向；选中态改为圆形描边，不再是方框 |
| 右侧十多个自定义图标挤在一列，地图导航和业务工具混杂 | 放大、缩小、指南针使用真正的 MapLibre `NavigationControl` 及其原生图标；定位、全机和工具保留简短文字入口，底图/图层/测距/坐标拾取放进覆盖式工具面板 |
| 旧缩放使用狭窄倍率限制，点击后缺少地图相机动画 | 改由地图引擎相机驱动，一次点击变化一级，滚轮按增量平滑缩放，保留鼠标地理锚点，动画逐帧同步飞机、航线和轨迹 |
| 地图信息条横贯底部，重复占据地图宽度 | 改为紧凑 HUD，保留坐标系、比例尺、数据源和底图选择，不改变地图主体尺寸 |

第一轮截图：`01-round1-command.png`、`01-round1-live.png`。

## 第二轮：复查边界，再修正

| 复查发现 | 修改 |
| --- | --- |
| 未接入的摇杆和模式按钮大面积展开，弱化真正可用的飞控状态与执行操作 | 收入默认关闭的“扩展飞控指令”区域，原禁用状态和说明不变；模拟返航、暂停、继续、终止仍保留 |
| 缩放后影像提示/HUD 高度变化可能触发适配，让相机跳回 | 区分用户主动操作相机和自动适配；用户已缩放或拖动后，提示高度变化不重置视野；显式全机视野仍可恢复适配 |
| 原生指南针支持拖动旋转，但当前 ENU 叠加层按正北绘制，存在配准风险 | 二维视图固定 bearing/pitch/roll 为 0，指南针保留正北反馈，避免底图旋转而飞机/航线不旋转 |
| 地图工具面板与实时飞行操作面板可能叠加遮挡 | 打开地图管理时关闭飞行操作浮层，保持工具互斥，不压缩地图 |

最终截图：`02-final-command-2048.png`、`07-final-live-2048.png`。另保存 1600px、1366px 桌面与 390px 兼容截图。

## 缩放的真实边界与原生控件边界

- 去掉旧的 0.1–5 倍人为限制，地图设置 `minZoom: 0`、`maxZoom: 24`。实际最小值还受地图视口与引擎约束；到边界由原生按钮禁用。不声称无限缩放。
- 卫星源没有更多细节时，继续放大只会放大现有影像，不伪造高清纹理；二维矢量、卫星、坐标网格继续可切换。
- MapLibre 标准导航提供缩放和指南针，不提供本项目特定的“定位无人机”“全机视野”业务。业务工具保留真实原功能，不冒充原生控件，也不把设备定位冒充无人机定位。
- 所有遥测和控制仍明确为教学模拟；未接入指令没有变成可执行按钮。

## 本轮主要文件

- `src/experiments/collaboration/components/SatelliteBasemap.tsx`：原生导航生命周期、动画相机同步、固定二维朝向。
- `src/experiments/collaboration/components/FleetMap.tsx`：引擎相机接入、覆盖式工具分组、用户视野保护。
- `src/experiments/collaboration/components/FleetMap.module.css`：四旋翼显示、原生导航容器、紧凑 HUD 和工具面板样式。
- `src/experiments/collaboration/LiveCommandView.tsx`、`LiveCommand.module.css`：未接入指令折叠和信息层级。
- `tests/collaboration-navigation-review-browser.cjs`：两轮专项自动化浏览器验收。
- `tests/collaboration-live-reference-browser.cjs`：按当前独立指挥台入口进入实时视图，并检查原生导航与折叠指令；旋转后的四旋翼用 CSS 布局尺寸验证固定大小，而不是把旋转后的轴对齐外接框误当成图标尺寸。

## 实际验证

使用本地 Vite `http://127.0.0.1:5175` 与真实无头 Chrome。环境的 Node/npm 位于 `/home/vip/muva/.tools/node/bin`。本机 `.env.local` 显式配置了 API 数据源，验收时以 `VITE_DATA_SOURCE=mock npm run dev -- --host 127.0.0.1 --port 5175` 启动，避免调用本机后端；未改用户环境文件。

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；现有大包体积警告仍在 |
| `npm run test:collaboration` | 37/37 通过 |
| `node tests/collaboration-navigation-review-browser.cjs` | 通过：原生图标、逐级动画、缩放边界、滚轮锚点、卫星模式视野不跳回、正北朝向、15 个四旋翼、五张任务卡无滚动、任务状态未被地图操作修改、桌面/窄屏无横向溢出、控制台及页面错误均为 0 |
| `node tests/collaboration-entry-browser.cjs` | 通过：步骤 5 与全屏指挥台分离、面板、HUD、往返及响应式 |
| `node tests/collaboration-command-browser.cjs` | 通过：共享状态、任务确认/控制、单机返航、安全完成、焦点恢复和布局 |
| `node tests/collaboration-live-reference-browser.cjs` | 通过：15 架实时状态、资源模态框、禁用指令、缩放/拖动、暂停/继续、单机返航确认、终止安全收尾、保留航线轨迹、焦点恢复及 2048/1366/768/390 布局 |
| `npm test` | 未全通过：120 项中 115 通过、5 失败，均位于本轮未修改的实验二 `swarm.test.ts`，涉及连续运动最小间距与提前返航覆盖缺口；未降低断言或改动其他实验来隐藏失败 |

原始地图专项结果：`ui-verification/collaboration/navigation-review-2026-10-31/verification.json`；全项目测试失败日志：同目录 `npm-test.log`。
