# 实验二并行航线调度修复（2026-10-31）

## 执行语义

保持各机独立、并行执行完整任务：入场 → 覆盖 → 返航 → 降落。一架完成覆盖即可返航，到达自己的 HOME 即开始降落，其他飞机继续执行各自任务。

共享交叉空间采用下一航段预约。可用航段同时放行；被占用航段的飞机在当前位置等待，航段释放后自动继续。没有全机入场完成后再统一覆盖、全机覆盖结束后再统一返航的阶段屏障。地理上的航线交叉也不再直接等同于必然碰撞。

## 备份

修改前备份：`/home/vip/muva/backups/before-exp2-route-scheduling-2026-10-31-140204`。

备份包含本次修改涉及的既有源码、测试和 SHA256，以及当时的 Git 状态/差异，保留了此前用户已修改的版本。

## 修改范围

- `src/domain/swarmDeconfliction.ts`：新增完整任务路径的并行可行性检查、局部航段预约及调度优先级求解。
- `src/domain/swarmPlanning.ts`：遇到连接或调度冲突时，自动尝试重新匹配机体与覆盖分区并重建入场/返航路径；保留飞机编号与任务编号。估时纳入等待时间。
- `src/services/mock/MockSwarmRuntime.ts`：按同类预约规则并行移动、局部等待/恢复、各机独立返航落地。
- `src/domain/swarmMissionWorkflow.ts`、`src/pages/experiments/swarm/MissionPlanningStep.tsx`：修正旧的逐机阶段执行说明，无布局/CSS 改动。
- `mavlink-gateway/muva_gateway/swarm_routing.py`：新增后端并行调度可行性检查。
- `mavlink-gateway/muva_gateway/swarm_sitl.py`：上传校验与并行调度对齐；实际执行以位置遥测和航段占用决定放行，使用 GUIDED 目标，逐机独立 LAND。保留上传 MISSION_ACK 和任务回读确认。
- 新增/扩展前后端回归及 `tests/swarm-parallel-browser.cjs`。

没有改动实验一、实验三的源码、前端样式、环境配置或依赖。

## 两轮检查

第一轮检查规划、API 校验与实际执行语义：交叉入场/返航允许通过局部避让调度；无冲突航段实际保持并行；原分区匹配受阻可自动重新分配。初始距离不足、互相占用端点、禁飞区和边界等真实安全问题仍拒绝。

第二轮检查并行下的暂停与落地：发现已开始独立降落的飞机可能被同伴暂停/返航时的悬停目标覆盖。已修复：已交给 LAND 的飞机继续降落，剩余飞机响应操作；新增暂停、返航两个回归场景。

SITL 的 2m 跟踪余量沿用既有实现：Store 生成计划前已增加余量，后端校验/航段放行同样保留余量；用户设置的安全间距未修改。

## 验证结果

按工程要求执行 `npm run typecheck` → `npm run build` → `npm test`：全部通过。前端共 144 项（主测试 125 + 实验一地图 19），其中实验二领域/运行时 61 项，包括 2～6 架连续运动的最小间距和至少两机同时移动断言。

后端专项：

```bash
cd /home/vip/muva/mavlink-gateway
PYTHONPATH=.packages:. python3 -m pytest tests/test_swarm_sitl.py -q
```

33 项通过。包含交叉航线自动等待/恢复、完整路径校验、HTTP 下发契约、实际调度循环的并发移动和独立结束回调、落地期间同伴暂停/返航。

后端全量：92 通过、1 失败。失败为此前已存在的实验四 `tests/test_experiment_api.py::test_waypoint_tampering_rejects_points_outside_home_fence`：预期 HTTP 422，实际 503。未修改或忽略该测试。

额外交叉验证：前端生成 2、3、4、5、6 架 × 安全间距 3m、8m 共 10 组计划，使用既有 SITL 2m 余量，逐组交由 Python `_validate_plan` 校验，10/10 通过。结果见 `ui-verification/exp2-parallel-2026-10-31/frontend-api-validation.json`。

## 浏览器验收

实际启动隔离的 Vite Mock 服务于 5181，未改动 `.env.local`，未替换用户 5173 服务。

```bash
VITE_DATA_SOURCE=mock VITE_SWARM_DATA_SOURCE=mock npm run dev -- --host 127.0.0.1 --port 5181 --strictPort
MUVA_TEST_URL=http://127.0.0.1:5181 \
PLAYWRIGHT_CORE_PATH=/home/vip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core \
CHROMIUM_PATH=/usr/bin/google-chrome \
node tests/swarm-parallel-browser.cjs
```

测试通过页面按钮完成配置/初始化、生成/检查/下发、预飞检查、起飞、开始、暂停/继续，随后确认自动避让恢复、独立返航/落地和全部完成。区域与 HOME 的测试坐标通过现有 Store 设置；浏览器中用 Mock tick 加速运动并逐段计算连续相对运动的最小间距。

结果：3 份下发回执，最多 3 架同时移动；一架落地时仍有同伴执行覆盖；覆盖率 100%，全部回到各自 HOME；连续运动最小间距约 5.002m（本场景设置 3m）；页面异常与控制台 error 均为 0；1920×1080、1440×900 无横向溢出。已人工查看并行飞行和独立落地截图。

证据：`ui-verification/exp2-parallel-2026-10-31/`，含截图、JSON 和构建/测试日志。

原 `swarm-planning-browser.cjs` 使用过期的“继续上次进度”“重新开始实验”选择器，与当前按钮/模态确认流程不一致，未将该旧综合脚本记为全通过。本次新增专门回归覆盖上述完整执行流程，没有为了通过旧脚本更改产品界面。

## 实际验证边界

本次未启动 Gazebo/ArduPilot SITL，未执行真实硬件飞行。API 通过模拟遥测、指令替身及 HTTP 契约测试验证，不能据此宣称已完成真实飞行验收。

无法满足安全间距、航线不可达或实际遥测导致持续互锁时，仍会明确报错并停止放行，不会跳过安全检查。常规交叉航段通过局部等待自动恢复；区域几何本身无解时不能保证自动规划成功。

## 当前服务的生效状态

2026-10-31T14:47:35+08:00：生效前检查确认实验二 sessionId=null，实验一和实验四的 Gazebo/SITL 均已停止。由于统一启动器会监控子进程退出，本次通过启动器正常停止服务，外层托管随后自动重新启动整个平台。

新版实验二网关 PID 4122951，端口 8002；统一前端仍使用 5173。已验证三个 API 网关健康、5173 实验二页面和最新规划源码可访问、8002 允许 5173 跨域访问。本次激活操作没有调用初始化、起飞或飞行接口。验证时新网关已出现新的会话 bf973dc7-9afc-4ce1-ab3e-9d3783648750，Gazebo 已启动；保留该会话供用户继续操作，没有再次重启或中断。
