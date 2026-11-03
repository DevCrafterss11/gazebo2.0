# MUVA MAVLink Gateway

将 ArduPilot MAVLink 转换为前端可用的 HTTP 命令接口和 WebSocket 遥测流。

实验二使用单独的 `muva_gateway.swarm_app`：在仓库根目录运行 `./start_experiment2.sh`；独立网关监听 `127.0.0.1:8002`，前端其他实验保持 Mock。点击初始化时，运行时从 `ardupilot_gazebo/worlds/experiment2_swarm.sdf` 生成独立 world 和每机独立的 Iris 模型副本，设置用户场景原点、地面初始位置与不同插件端口，再启动专用 `GZ_PARTITION` 的 Gazebo Sim 8，并启动对应的 ArduCopter JSON SITL。Gazebo FDM UDP 端口为 `9202 + 10*i`（`i=0..5`），与实验一的 `9002` 分开；SITL MAVLink TCP 端口默认 `15760 + 20*i`。后端确认每个 Gazebo 模型存在，并逐机等待心跳、GPS、EKF 后才返回初始化成功。随后后端逐机上传并回读任务，以 GUIDED 指令调度覆盖和返航，经 `/ws/swarm` 回传 Gazebo-backed 飞控遥测。任一初始化环节失败仅清理本次实验二创建的进程；不会操作实验一的 world、SITL、网关或进度。

初始化成功后，若图形桌面已安装 `xterm`，会按机数打开独立的**只读指令流水**，窗口固定使用 UTF-8 与 `Noto Sans Mono CJK SC` 中文等宽字体；显示实际命令 TX、飞控 ACK/状态 RX，以及经状态确认后的 DONE。各机独立写入 `uav-N/commands.jsonl`、`uav-N/flight-state.json` 和 `uav-N/sitl.log`；Gazebo 日志与本次生成的 world/model 存在 `~/.local/state/muva/experiment2/gazebo/`。设置 `MUVA_SWARM_MONITOR_TERMINALS=0` 可关闭弹窗。`./stop_experiment2.sh` 会先请求后端安全关闭，飞行中或无法确认落地时拒绝停止。

需要**实际飞行验证双机完整链路**时，在 `mavlink-gateway` 目录运行：

```bash
MUVA_RUN_SWARM_SITL_E2E=1 PYTHONPATH=.packages:. python3 tests/swarm_sitl_e2e.py
```

测试使用临时状态目录、独立 MAVLink 端口 16960/16980、独立 Gazebo 分区及独立 FDM 端口，不连接已有实验；它会运行双机任务并自动返航落地，飞行中请勿强制终止脚本。测试脚本不会关闭实验一 Gazebo。

## 运行

标准 MAVProxy 输出方式：

```bash
./dev.sh
```

默认监听 `udpin:0.0.0.0:14552`。当前 SITL 已经运行但没有重启加载 `14552` 时，可直接使用其独立 MAVLink TCP 端口：

```bash
MUVA_MAVLINK_ENDPOINT=tcp:127.0.0.1:5762 ./dev.sh
```

HTTP 服务位于 `http://localhost:8000`，接口文档位于 `/docs`。

## 飞控信息监控

独立的只读终端监控器会展示飞行模式、解锁状态、位置、姿态、速度、GPS、
电池、任务进度、EKF / 传感器健康、RC / 舵机输出，以及飞控的 `STATUSTEXT`
错误和 `COMMAND_ACK` 结果。

Web 前端集成的只读回传控制台使用 UDP 14553。独立终端监控器默认使用 UDP 14554，使用前需要为 SITL 增加对应的 `--out`：

```bash
./monitor.sh --port 14554
```

保存全部收到的 MAVLink 数据为 JSONL：

```bash
./monitor.sh --port 14554 --log logs/flight-monitor.jsonl
```

当前网关已经占用 14552 时，不要让两个进程竞争同一个 UDP 输入端口。可直接
连接 SITL 的独立 TCP 端口：

```bash
./monitor.sh --endpoint tcp:127.0.0.1:5762
```

或者让 MAVProxy / SITL 额外输出到另一个 UDP 端口，再用 `--port` 指定该端口。
使用 `--no-clear` 可以保留每次刷新内容，适合重定向到终端日志。

监控器默认会发送 MAVLink 遥测订阅请求，以便直接 TCP 连接时获取位置、姿态等
完整状态；它不会发送解锁、模式或飞行控制命令。使用 `--passive` 可关闭订阅请求。

## 接口

实验一的真实 Session、按 `progressId` 保存的进度、按 Session 保存的评分/报告、环境、传感器预检和版本化飞行接口详见前端 `docs/experiment1-api.md`；全部接口细节以运行中的 `/docs` 为准。评分和实验进度持久化于 `MUVA_PLATFORM_DATA` 指定的文件（默认用户状态目录），不是浏览器 localStorage。

实验四安全对抗使用隔离的 `/api/v1/security/runs` REST 生命周期和 `WS /ws/security/{runId}` 通道；契约、检测/评分规则、Mock/API 差异与限制详见前端 `docs/experiment4-v1.md`。实验安全样本使用独立的 `security.telemetry.v1` envelope，不进入普通车辆遥测通道。考核结果虽由 Gateway 计算和保存，但当前服务没有身份认证/授权，不适用于正式防篡改考试。

- `GET /api/health`：网关和飞控连接健康
- `GET /api/vehicle`：最新车辆状态快照
- `WS /ws/telemetry`：最新遥测状态流
- `POST /api/commands/mode`：切换模式并等待心跳确认
- `POST /api/commands/arm`：解锁/锁定并等待 ACK 与状态确认
- `POST /api/commands/takeoff`：GUIDED 模式起飞命令
- `POST /api/commands/hold`：GUIDED 位置/高度保持（不依赖遥控器油门）
- `GET /api/missions`：从飞控下载任务
- `POST /api/missions/upload`：上传任务并回读校验
- `POST /api/missions/start`：切换 AUTO 并启动任务

地面解锁时，网关会自动将 `AUTO`、`LAND`、`RTL` 和 `SMART_RTL` 切换到 `GUIDED` 后再发送解锁命令；飞行中不会绕过安全检查。飞控拒绝解锁时，错误会包含同一时段的 `STATUSTEXT` 预检原因。

## 测试

```bash
PYTHONPATH=.packages:. python3 -m pytest -q
```

## 账号与课程数据库（可选）

默认前端仍为独立 Mock，不需要 Docker。要启用持久化账号、管理员用户/课程/成员/审计/实验定义和教师课程/学生名单/实验定义：

1. 在本目录复制 `.env.example` 为 `.env`，修改 `POSTGRES_PASSWORD` 为强随机密码，执行 `docker compose up -d database`。数据库仅监听本机，数据保存在命名卷 `muva_pgdata`；不要将 `.env` 提交到仓库。
2. 安装 `requirements.txt`（包含 PostgreSQL 驱动）。设置 `MUVA_DATABASE_URL=postgresql://muva:<数据库密码>@127.0.0.1:5432/muva`，在本目录执行 `python3 -m muva_gateway.management init`，再执行 `python3 -m muva_gateway.management bootstrap-admin --username admin01`。后者会交互读取至少 10 位的管理员密码，不写入命令历史；重复引导不会覆盖已有账号。
3. 使用相同的 `MUVA_DATABASE_URL` 启动 `./dev.sh`（或网关的 uvicorn 启动方式）。前端开发环境配置 `VITE_AUTH_DATA_SOURCE=api`、`VITE_ADMIN_DATA_SOURCE=api`、`VITE_API_BASE_URL=http://127.0.0.1:8000/api`，重启 `npm run dev`。不要把数据库 URL 配置到 Vite：数据库凭证仅在后端。
4. 管理员登录后创建教师/学生账号（初始密码不少于 10 位），创建课程并指定教师，在课程详情加入学生；教师登录后只能查看自己课程及其学生，并为自己的课程创建实验草稿、发布和结束。停用或重置密码会撤销该用户的现有会话；个人信息页允许已登录用户用原密码修改密码，成功后撤销其所有会话并要求重新登录；退出会撤销本次会话。访问控制由后端校验，不依赖前端角色路由。

**范围与限制：** 当前持久化实现仅包含身份、课程、选课名单、实验定义及审计。实验定义的发布只是状态管理，不代表学生端已经联动；教师的成绩、监控和管理员的角色权限设置、仿真资源等其他界面仍是前端教学演示，不能当作真实业务数据或真实资源控制；资源 API 在数据库模式明确返回 501。当前 HTTP 登录令牌保存在浏览器 `sessionStorage`，有效期 8 小时；生产部署还需 HTTPS、密码找回、登录限速、会话清理、数据库迁移与备份，并为原有飞行 API / WebSocket 增加统一鉴权后才能对公网开放。

本地无需 Docker 的接口自测：`PYTHONPATH=.packages:. python3 -m pytest -q tests/test_management.py`，测试使用临时 SQLite 数据库，不影响已有仿真数据。

已知联动边界：教师“实验定义”的发布仅持久化状态，不会自动改变学生实验目录或权限；教师监控、成绩及管理员资源控制在真实模式未接入，不应使用这些页面进行实际飞行管控或成绩发布。正式对外部署前须统一保护已有的 `/api/v1` 和 WebSocket 飞控端点（本次新增的管理 API 已有后端角色校验）。
