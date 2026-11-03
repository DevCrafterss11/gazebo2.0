# 实验二：飞行中直接中止并回收验证

日期：2026-10-31（Asia/Shanghai）。本次只新增验收脚本和记录，没有修改页面、任务调度或生产 API。

## 结论与验证范围

当前实现支持在飞行中确认“中止并回收 SITL 仿真”，无需先返航、降落或上锁。它是**强制终止本实验的仿真环境**，并非安全降落命令，也不是关闭整个 MUVA 服务。

采用真实 ArduCopter SITL + Gazebo 双机、真实 MAVLink 遥测和命令确认，通过 FastAPI 路由调用完整回收链路；不是 Mock 飞行。测试使用独立端口和状态目录，没有连接真实硬件，也没有操作用户网页的实验会话。未进行浏览器自动点击验收。

## 飞行验证

两轮完整验收记录（共四次真实仿真飞行中止）：

| 轮次 / 场景 | 中止前遥测 | 回收耗时 | 结果 |
| --- | --- | --- | --- |
| 第一轮：执行航线中止 | RUNNING；双机 armed；高度 9.99 / 10.00 m；均已离开起点超过 2 m | 7.066 s | 通过 |
| 第一轮：重新初始化后，起飞爬升途中中止 | TAKING_OFF；双机 armed；高度均为 1.09 m | 6.578 s | 通过 |
| 第二轮：执行航线中止（含完整子进程树核验） | RUNNING；双机 armed；高度均为 10.00 m；均已离开起点超过 2 m | 6.662 s | 通过 |
| 第二轮：重新初始化后，起飞爬升途中中止 | TAKING_OFF；双机 armed；高度 1.24 / 1.25 m | 7.328 s | 通过 |

四次均检查：

- API 返回 `aborted: true, landed: false`，不伪造已落地。
- 飞行调度线程、MAVLink 读取线程停止。
- SITL 进程退出；Gazebo launcher、server 和 GUI 实际 PID 均不再运行。
- SITL TCP 16960 / 16980 和 FDM UDP 19402 / 19412 释放。
- health 为 `sessionId: null, gazebo: false`，旧会话查询返回 409。
- 相同会话重复回收幂等成功。
- 原端口可重新初始化；旧会话回收请求不能关闭新会话。

新脚本还在回收前捕获 Gazebo 的完整子进程树及各自进程组，而不是只检查 launcher 的进程组；最终复验数据见备份目录的 `verification/sitl-final/report.json`。

首次试运行在起飞前被 ArduPilot 的 `Arm: Accels inconsistent` 预解锁检查拒绝，未进入飞行验收。记录保留为 `attempt1-imu-warmup.log`；验收脚本增加启动后 20 秒传感器稳定等待后重跑，没有禁用或修改飞控安全检查。

## 页面到回收接口的路径

`SwarmExperimentPage` 的确认按钮 → `swarmStore.abortRuntimeAndNewRun` → `ApiSwarmService.abortSimulation` → `/api/swarm/abort-simulation` → `SwarmSitlRuntime.abort_simulation`。

飞行调度本身不持续占用前端 busy 状态，因此正常飞行期间回收按钮可以使用。回收时先取消调度并唤醒 ACK/高度/降落等待，再关闭仿真进程；不经过 `require_ground()`。回收成功后当前未完成进度被归档为中断，再创建新的实验记录；已有完成结果不会改写。

## 边界

- 这是有确认步骤的破坏性仿真回收，不是点击后瞬间完成；本机本次耗时约 6–8 秒。
- 若正在初始化/上传等持有操作锁的流程中，接口会拒绝并提示稍后重试。
- 若调度线程在取消后 10 秒仍不退出，接口会报错，不能声称环境已经回收。
- 验证证明本次飞行与爬升场景通过，不等于操作系统、权限或所有卡死故障均能百分之百清除。
- 本机没有 xterm，未创建独立监控终端，因此不包含真实 xterm 窗口回收验收；相关现有单元测试通过。
- 保留日志、任务记录及历史结果是预期行为；清理不等于删除这些文件，也不会关闭前端和网关服务。

## 复现

在 `mavlink-gateway` 目录，确认隔离端口可用、Gazebo 图形环境可用后：

```bash
MUVA_RUN_SWARM_ABORT_E2E=1 \
PYTHONPATH=.packages:. \
python3 tests/swarm_abort_sitl_e2e.py
```

脚本只管理自身 runtime 创建的仿真进程，没有全局 `pkill`。此命令会实际启动并解锁**模拟飞行器**，默认不会在普通 pytest 中运行。

备份及完整日志：`/home/vip/muva/backups/before-exp2-airborne-abort-check-2026-10-31-153203`。

## 自动化回归

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm test`：155 项通过（136 + 实验一地图 19）。
- `PYTHONPATH=.packages:. python3 -m pytest tests/test_swarm_sitl.py -q`：38 项通过。
- 最终飞行验收脚本：两个场景全部通过，包含完整 Gazebo 子进程组核验；一次 SITL 实际使用 SIGKILL 兜底退出后仍释放全部专用端口。
