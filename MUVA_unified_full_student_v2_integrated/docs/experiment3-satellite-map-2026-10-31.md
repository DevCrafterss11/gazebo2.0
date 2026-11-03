# 实验三：二维卫星地图与运行时坐标对齐

日期：2026-10-31。范围：仅迭代实验三地图，保持六步教学导航、独立任务模型、全屏指挥台和实时遥测布局；不接入真实飞控指令。

## 本次完成

- 用 MapLibre 的真实二维卫星瓦片替代实验三原来的示意地形。复用实验二使用的公共 `geographicMapStyle` 与现有依赖，但未复用或修改实验二的页面、地图组件、状态、飞行逻辑。
- 15 个无人机标记直接读取统一运行时的 `Drone.position`，移除为了排列图标而增加的显示偏移。坐标重合时如实重合，不为美观伪造位置。
- 无人机、区域、航点、计划路线、实际轨迹及返航轨迹使用同一场景坐标基准。地图点击逆变换与标记正变换一致；横纵方向均为等比例米制，不再按屏幕宽高分别拉伸。
- 支持二维地图平移、鼠标指针中心缩放、缩放按钮、自适应视野、列表定位、单机信息面板、卫星/网格切换、轨迹开关、动态比例尺与北向标识。
- 弹出信息显示 WGS84 经纬度、ENU 米制坐标与数据来源。历史记录保存当次坐标基准，避免切换场景后历史路线错位。
- 卫星瓦片加载失败时给出错误、重试和网格切换提示；位置及任务编辑仍可操作。网格是用户可切换的模式，并非离线卫星缓存。
- 保留原有深青色叠加面板、独立任务入口及底部操作栏；调整比例尺、图例、地图控件及署名位置，避免与任务栏遮挡。

## 坐标与真实 Gazebo 边界（重要）

统一模型新增 `Mission.mapReference`（原点经纬度、ENU 轴约定）和 `dataSource`。`collaborationMapFrame` 统一实现本地米制坐标、WGS84 与 MapLibre 相机之间的转换。当前是校园尺度、原点纬度修正的 Mercator 局部米制投影。

**目前仍是 Mock，不是已经接收到 Gazebo 的真实位置。** 当前教学场景原点 `[108.8289653, 34.1251589]` 对应实验二教学区域，仅用于教学底图，不代表自动识别了实际 Gazebo World 的地理原点。

调查现有代码发现，8002 的 `/api/swarm/*` 和 `mavlink-gateway/muva_gateway/swarm_sitl.py` 有实验二场景与遥测能力；但实验三尚无完整的 uav101–uav115 后端实例映射及遥测适配器。因此没有把实验二实例遥测冒充成实验三十五机位置，也没有新增猜测 API。

后续真实适配器需要：
1. 提供当前 Gazebo World 的实际地理参考原点。
2. 将 Gazebo 本地轴或飞控 NED 坐标归一为场景 ENU 米制；若来源是 GPS，则转换到同一参考系。
3. 按无人机 ID 更新现有资源池的 `position`、姿态、时间戳与准确的数据来源（SITL、Raspberry Pi Relay 或 Hardware）。

上述数据进入统一运行时后，现有地图将按所提供的位置绘制，不需要再重写图标、任务路线或地图相机。尚未实现真实数据接收和真实控制，本次没有声称其可用。

## 文件范围

新增：
- `src/domain/collaborationMap.ts`：实验三坐标与相机换算。
- `src/experiments/collaboration/components/SatelliteBasemap.tsx` 及 `.module.css`：独立实验三卫星图层、加载/错误/清理机制。
- `tests/collaboration-satellite-browser.cjs`：真实瓦片与投影对齐验收。
- 本报告与 `docs/ui-verification/collaboration/satellite-map-2026-10-31/` 截图。

在已有实验三文件上迭代（部分在本次开始时已经是未跟踪文件）：
- `components/FleetMap.tsx`：直接位置渲染、坐标统一、地图交互。
- `TaskWorkspace.tsx`、`LiveCommandView.tsx`：明确地图/数据源文案。
- `Collaboration.module.css`、`TaskCommand.module.css`、`LiveCommand.module.css`：地图与控件布局。
- `src/types/collaboration.ts`、`src/services/collaborationContract.ts`：数据源及场景坐标契约。
- `src/services/mock/CollaborationMockRuntime.ts`、`src/stores/collaborationStore.ts`：保留运行时/历史场景参考。
- `tests/collaboration.test.ts`：新增坐标及历史场景回归测试。
- `package.json`：新增卫星地图浏览器测试命令；未新增依赖。

本轮未修改实验一、实验二、TopHeader 或 MainLayout；保留工作区原有未提交内容，未清理用户文件、未提交代码。

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过；现有大包体积警告仍在 |
| `npm run test:collaboration` | 32/32 通过 |
| `npm run test:collaboration-satellite-browser` | 通过；真实卫星瓦片 HTTP 200，未使用假瓦片或假时钟 |
| `node tests/collaboration-map-command-browser.cjs` | 通过；五种独立任务、浮动图层、绘制、执行控制、单机返航与结果保留 |
| `node tests/collaboration-live-reference-browser.cjs` | 通过；实时遥测、控制、独立返航及桌面/窄屏 |
| `git diff --check` | 通过 |
| `npm test` | 未全通过：115/120；实验二既有 4 项连续运动安全间距、1 项暂停/返航覆盖问题，未为通过检查而修改实验二 |
| `npm run test:experiment1-map` | 未全通过：17/19；既有两项地图 zoom 预期 18 与实际 17.2 不一致 |
| `npm run lint` | 无此脚本（Missing script: lint），不能声称 lint 通过 |

浏览器独立用 Web Mercator 公式计算瓦片像素与标记中心，检查误差小于 1 px；覆盖任意运行时位置（不只默认阵列）、缩放、平移、列表/地图选中、运输点位、实际飞行轨迹、暂停冻结、独立返航、终止后集群仍运行。分辨率 1600×1000、1366×768、390×844；检查页面无横向溢出。正常联网流程没有应用 pageerror 或 console error；离线测试主动屏蔽瓦片请求，预期出现网络错误和不可用提示。

## 截图

目录：`docs/ui-verification/collaboration/satellite-map-2026-10-31/`

- `00-experiment2-map-reference.png`：实验二现有地图对比（仅浏览器操作，无代码改动）。
- `01-satellite-command-desktop.png`：实验三卫星指挥台、15 机。
- `02-transport-geographic-points.png`：运输起点/交付点。
- `02b-satellite-flight-tracks.png`：任务执行与实际轨迹。
- `03-command-1366.png`、`03-command-390.png`：桌面/窄屏。
- `04-satellite-live-desktop.png`、`05-satellite-live-narrow.png`：实时遥测地图。
- `06-offline-grid-fallback.png`：瓦片不可用提示；之后测试切换至网格。
- `regression/`、`live-regression/`：既有任务工作区与实时视图回归截图。

## 运行

开发地址：`http://127.0.0.1:5175/experiments/collaboration`

```bash
cd /home/vip/muva/MUVA_unified_full_student_v2_integrated
export PATH=/home/vip/muva/.tools/node/bin:$PATH
npm run dev -- --host 0.0.0.0 --port 5175
```

浏览器测试若未安装项目本地 playwright-core，可使用现有运行时：

```bash
export PLAYWRIGHT_CORE_PATH=/home/vip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core
npm run test:collaboration-satellite-browser
```

卫星底图依赖在线 Esri World Imagery；不可用时可切换坐标网格。实验三飞行数据仍为明确标识的 Mock；真实 Gazebo 地理参考、十五机遥测接收和控制待后续适配。
