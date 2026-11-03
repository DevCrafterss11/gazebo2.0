# 实验三：独立任务业务模型调整与验收

日期：2026-10-30。工作分支：`upload/muva-experiment3-2026-10-22`。

## 最终业务模型

以用户最新规则为准：**15 架统一启动、统一资源池、五种独立任务入口、一次只执行一种任务，任务内部多机协同。** 早期“五组默认各三架、统一并行启动”的要求已被替换。

集群启动后全部待命、未分配、未解锁。学生先在资源管理配置候选资格，再进入一种任务选择成员、配置地图和角色，检查摘要并确认后执行。结束后留在原任务工作区，安全返航落地后释放资源，集群继续运行。

## 审查结论与调整

| 原实现 | 处理结果 |
| --- | --- |
| 已有 React/Zustand、Mock Runtime、教学页、CSS Modules、集群启动与通信展示 | 保留并扩展，未另建运行时或修改实验一、二业务 |
| 原任务组配置和统一执行面向五组并行 | 正式入口改为五个独立草稿工作区；活动任务最多一个 |
| 任务分组、资源资格、实例状态和图标显示语义混杂 | 分离 enabled / allowedTaskTypes / visibleOnMap / assignedTaskId / currentRole / instanceStatus |
| 地图与执行轨迹缺少单机安全收尾入口 | 共用 FleetMap，增加悬停/点击操作面板、确认返航、独立 Home 与返航轨迹 |
| 进度与实际到点、监测停留及结果确认关联不足 | 根据实际位置限制推进；最慢在飞机成员约束航线推进；到点后累计停留；人工复核/签收显式确认 |
| 结束记录容易被下一次执行覆盖 | 执行结束 structuredClone 快照，保存配置、角色、成员、事件、轨迹与评价 |
| 切换任务可能显示上一任务轨迹 | 草稿不显示旧航迹；完成态读取当前任务记录；全局仍展示完整15机资源池 |
| 小屏顶部文字挤压、地图视野不自适应 | 仅实验三作用域调整壳层；ResizeObserver 调整地图视野；检查390/768/1024/1600宽 |

旧 MissionIntroduction、DroneGroupConfig、CollaborationConfig、CollaborationExecution、FailureSimulation、ExperimentReport 等 legacy 组件保留，正式路由未继续挂载旧业务流程。复用原教学框架、样式、TaskSettings、Lucide 图标和 Zustand/服务注入机制。

## 六步教学流程

1. 系统感知：检查项、最后检查时间与接口待接入说明；可进入教学模拟。浏览器不检查本机进程或 SSH。
2. 集群启动：3×5阵列参数集中配置，分阶段模拟启动15实例，全部待命。启动不创建任务；停止经过 UI 二次确认，先执行安全收尾。
3. 通信组网：15台独立Pi节点，IP与无人机一一对应；展示模拟心跳和转发来源。
4. 集群状态监控：15独立图标、列表联动、姿态/电量/模式/解锁/位置/服务状态和更新时间，支持单机操作。
5. 多任务协同指挥：独立业务导航、资源弹窗、专属配置、地图编辑、成员角色、摘要确认、当前任务控制与事件。一个任务内部可有多机。
6. 实验评价：按每次独立任务实际记录评价，提供历史配置和轨迹快照；返回当前工作区后数据保留。

前置条件由 store 校验，切换教学步骤不启动任务或伪造集群就绪。任务结束不自动跳离当前工作区。

## 数据模型与运行机制

- `Drone`：固定编号/IP、类型、instanceStatus、connectionStatus、enabled、allowedTaskTypes[]、visibleOnMap、assignedTaskId、currentRole、Home、位置/姿态/电量、服务状态、任务轨迹与返航轨迹。
- `CommunicationNode`：独立 droneId/IP/network/mavlink/heartbeatAt/source。真实在线不会由 Mock 构造。
- `TaskGroup`：为兼容旧组件保留类型名；正式页面代表一个任务类型的当前草稿/执行，包含参数、点位、成员、角色、runId、状态、进度、停留计数、开始结束时间。
- `TaskRecord`：每次执行的不可变快照，历史记录不占用资源；再次执行有独立 runId。
- `TaskEvent` / `EvaluationResult`：模拟标识与时间戳；评价使用实际进度、轨迹采样、停留计数和异常/处置事件，不生成固定成绩。

一个 store 服务所有页面；组件经 store 使用 `CollaborationRuntimeAdapter`，具体 Mock 只由 registry 注入。集群只有一个450ms启动/心跳时钟，启动四阶段后持续心跳；执行/返航使用一个850ms时钟，重复调用会替换而非叠加。暂停冻结任务进度及任务航迹，独立返航仍继续。停止/重置清理对应时钟。SPA页面切换保留运行状态，页面切换不会关闭集群。

### 生命周期与返航

`配置中 → 待确认 → 执行中 → 暂停 / 异常 / 待结果确认 → 安全收尾 → 已完成 / 已终止`。

启动同时校验集群、摘要确认、任务资格、连接/实例状态、电量、角色、点位与占用。实际分配只发生在确认开始时。暂停、继续、终止改变实际运行状态。终止冻结任务进度，先返航再归档。

单机返航：UI确认 → 该机进入RETURNING/RTL → 独立三维模拟移动至Home → 保存橙色返航轨迹 → 落地解除armed并释放资源。其余成员继续；关键角色退出或无在飞机会进入异常待处置，不会自动终止任务。显式降级后剩余成员接替角色；无剩余成员则提示终止。暂停期间返航仍可完成。

### 五种独立模拟逻辑

| 类型 | 路线/执行 | 动态指标 |
| --- | --- | --- |
| 区域巡逻 | 多边形扫描/周边巡逻，航线间距影响扫描密度 | 采样覆盖率、航线完成率 |
| 目标搜索 | 网格/扇形/反向协同扫描；单目标点可按搜索范围扩展 | 搜索覆盖、模拟目标发现事件；人工复核需确认 |
| 定点监测 | 到监测点后驻留，实际到点后计时，暂停不累计 | 监测点完成、实际有效停留时间 |
| 物资运输 | 起点→编辑航点→交付点；人工签收需确认后安全返回 | 实际航线进度、到点/人工签收情况 |
| 应急救援 | 起点→按救援策略选择中间点→目标，优先级影响推进速度 | 实际到达、响应时间 |

所有任务沿同一个本地坐标路线模型移动，地图虚线与实际执行引用同一函数。推进不只依靠时间：需要成员接近当前目标，下一步目标距离限制为一个模拟tick可飞距离。任务完成后自动安全返航，资源在落地前不可重新分配。

## 视觉与地图

已对比实验一、二截图和本机微信参考，保留平台壳层、字体、圆角、教学步骤和按钮规范。工作区以深青/深蓝绿面板、青绿强调、左侧任务入口、中央可交互模拟地图、右侧参数/遥测和底部sticky操作栏组织。资源用可滚动原生dialog表格，非静态背景图。

地图支持平移、缩放、自动适配、网格/轨迹开关、区域点/航点增删改、起点/交付点设置、成员筛选、标记悬停与点击、定位/详情/确认返航。窄屏分栏纵向排列；表格在弹窗内部横向滚动，页面不横溢出。窄屏可点击打开操作面板。

## 实际验证结果

日志在 `docs/ui-verification/collaboration/final-single-task/checks/`。

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，保持strict TS |
| `npm run test:collaboration` | 22/22通过 |
| `npm run test:collaboration-browser`（下述环境变量） | 通过，无console/pageerror |
| `npm run build` | 通过；主JS约4.20MB，Vite仍提示大chunk警告 |
| `npm test` | 115/120通过，5项实验二swarm失败 |
| `npm run test:experiment1-map` | 17/19通过，2项实验一相机zoom断言失败 |
| `npm run lint` | 项目没有lint脚本/配置，命令返回Missing script，不能宣称通过 |
| `git diff --check` | 通过 |

实验二失败：测试89–92连续运动间距分别为7.395/7.505/7.394/7.605m；测试104提前返航场景被禁飞/等待点/训练范围规划校验拒绝。实验一地图失败：测试5、6断言zoom=18，当前实际17.2。对应实验一、二业务与测试文件本轮没有修改，未通过放宽断言掩盖问题。全量脚本因前五项失败，未执行其末尾地图测试，所以另行运行并如实记录。

专项单测覆盖：15资源及映射、零默认任务、多任务资格/启用/显隐语义、确认门禁、单任务互斥、暂停继续、暂停期间单机返航、关键角色降级、终止安全收尾、五类自然完成及差异指标、模拟异常、停止集群、时钟幂等/清理、最慢成员到点约束、实际监测停留、人工复核/签收、单点搜索、同时间重复执行事件隔离。

浏览器通过真实UI完成：六步、资源资格、15图标与列表联动、地图绘制/坐标编辑/删除/缩放/平移、角色选择、摘要确认、当前任务互斥、暂停继续、取消/确认单机返航、异常降级、终止搜索任务、其他四类完成、运输人工签收、历史与评价、集群继续运行、停止确认及页面切换。桌面1600×1000，窄屏1024×900、768×1024、390×844，无页面横向溢出。浏览器clock加速执行，业务动作通过UI，store只用于读取断言。

关键截图：

- `final-single-task/01-readiness.png`、`02-cluster.png`、`03-network.png`、`04-fleet.png`
- `final-single-task/resources.png`
- `final-single-task/05-patrol-config.png`、`05-patrol-running.png`、`05-patrol-result.png`
- `final-single-task/05-2-config.png` 至 `05-5-result.png`
- `final-single-task/05-delivery-awaiting-confirmation.png`
- `final-single-task/history-snapshot.png`、`06-evaluation.png`
- `final-single-task/narrow-1024.png`、`narrow-768.png`、`narrow-resources.png`、`narrow-390.png`、`narrow-390-map.png`、`narrow-390-task.png`

上述目录相对于 `docs/ui-verification/collaboration/`。`browser-result.json`保存五次任务状态及实际指标。`reference-experiment-1.png`、`reference-experiment-2.png`为平台风格对照。

## 文件清单

本轮修改：

- `src/types/collaboration.ts`
- `src/services/collaborationContract.ts`（上一轮未跟踪文件，继续完善）
- `src/services/mock/CollaborationMockRuntime.ts`
- `src/stores/collaborationStore.ts`
- `src/experiments/collaboration/CollaborationExperimentPage.tsx`
- `src/experiments/collaboration/Collaboration.module.css`
- `src/experiments/collaboration/TaskSettings.tsx`（继续复用，补充可访问表单名称）
- `src/layouts/MainLayout/MainLayout.module.css`（仅实验三选择器下窄屏适配）
- `tests/collaboration.test.ts`、`tests/collaboration-browser.cjs`

新增业务模块：

- `src/domain/collaborationMission.ts`
- `src/experiments/collaboration/TaskWorkspace.tsx`
- `src/experiments/collaboration/components/FleetMap.tsx`
- `src/experiments/collaboration/components/ResourceManager.tsx`
- `src/experiments/collaboration/components/TaskResult.tsx`

工作区另有上一轮已有的package脚本、serviceRegistry注入、TopHeader实验三Mock标识等修改，保留。用户未提交的 `docs/实验3的最终版本/` 和ArduCopter dump文件完整保留，未提交或推送。

## 运行与真实能力边界

开发服务：`http://127.0.0.1:5175/experiments/collaboration`。

```bash
cd /home/vip/muva/MUVA_unified_full_student_v2_integrated
export PATH=/home/vip/muva/.tools/node/bin:$PATH
VITE_DATA_SOURCE=mock npm run dev -- --host 127.0.0.1 --port 5175
```

复现浏览器验收：

```bash
PLAYWRIGHT_CORE_PATH=/home/vip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core \
MUVA_TEST_URL=http://127.0.0.1:5175 npm run test:collaboration-browser
```

已只读调查 `mavlink-gateway/muva_gateway/app.py`：存在 `/api/vehicle`、`/api/monitor`、`/ws/telemetry`、`/ws/monitor`、`/ws/mavlink/monitor`，`telemetry_envelope`包含位置、姿态、电量、mode、armed及连接字段；swarm网关为实验二隔离能力。**这不代表实验三15机/Pi已接入或已验证真实数据。** 本轮没有发送飞控指令或尝试SSH。

registry的实验三在mock/api两分支都明确注入Mock；设置api不会使实验三变成真实控制。真实15机身份绑定、独立心跳/陈旧判定、Pi网络检测、集群管理、返航控制与安全指令确认仍未接入。适配合同是预留边界，后续还需实现真实后端状态确认，不能把当前前端Mock状态转换直接当作真实指令成功。建议接入顺序：只读15机身份/心跳/遥测 → 通信健康 → 集群生命周期 → 后端确认的安全指令。

## 当前限制

- 每种类型保留一个当前草稿和多次历史执行，不支持同类型任意多个未执行草稿；刷新浏览器会清空当前内存运行与历史，SPA页面切换保留。
- 飞行、返航和航线为本地教学模拟，无碰撞规避/动力学/载荷物理模型。轮换/交接与载荷配置会保留，未实现复杂机队轮换调度和真实物流签收流程。
- 区域覆盖率为沿计划扫描采样的教学估计，不是传感器实测覆盖；凹多边形航线连接不是通用避障规划。
- 真实停止/RTL指令确认、15Pi连接、Gazebo/SITL部署均未接入。
- 当前全量回归有上述7项其他实验失败，lint工具未配置，不能宣称全仓库全绿。
