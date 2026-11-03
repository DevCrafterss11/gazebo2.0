本轮仅处理实验一地图故障、实验二安全间隔及返航异常，并同步实验二 API 后端。日期：2026-10-31。

备份：
- 前端原始快照：`/home/vip/muva/backups/before-exp1-exp2-bugfix-2026-10-31-132822`，包含 src、tests、包配置、原工作区差异及 SHA256 清单。
- API 修改前快照：`/home/vip/muva/backups/before-api-rtl-bugfix-2026-10-31`，包含本次修改的后端源文件、测试及 SHA256 清单。

修改结果：
- 实验二新建实验默认安全间隔为 3m；已有草稿及显式提交的 8m 参数继续保留。原有 8m 连续运动安全断言保持原样并通过。
- Mock 执行顺序与规划器的等待位置约束保持一致，修复入场、覆盖完成后的返航交叉导致的间距失败。
- Mock 单机路径规划异常单独记录，受阻机保持位置并重试；其他可返航飞机继续。提前返航和覆盖完成后的返航均有新增回归用例。
- API `/api/swarm/configure` 在未传 safety 时使用 3m，显式值仍按原约束校验。
- API `/api/swarm/command` 返航队列隔离单机绕障规划失败，其他飞机可继续返航；其他飞机落地后重新尝试受阻飞机。持续受阻保留 RETURNING、原因及待重试请求，不计作成功。
- API 受阻飞机不继续执行旧覆盖航线；悬停指令失败如实记录。真实飞控执行异常仍进入原有失败处理，不屏蔽心跳和安全距离检查；返航内部标志通过 finally 释放。
- 实验一初始缩放恢复到 18，编辑 HOME 后按配置点居中。
- 实验一在线底图失败时，离线坐标视图保留完整航点工具条，支持选点、撤销、参数设置与提交航线，基础飞行控制不依赖在线瓦片。

验证：
- `npm run typecheck`：通过。
- `npm run build`：通过；仍有已有的大包体积警告。
- `npm test`：122 + 19 = 141 项通过，0 失败。
- 实验一 Playwright：通过。包含 HOME 居中、平移缩放持久化、断开瓦片后的航点添加/撤销/任务提交、实际 Mock 基础起飞/移动/降落、恢复在线底图、页面脚本异常及横向溢出检查。教学前置步骤使用 fixture 注入，在线瓦片用可控图片替代，不代表外部地图服务可用性测试。
- 浏览器新建实验二默认值检查：3m，通过。
- 后端 `PYTHONPATH=.packages:. python3 -m pytest -q tests/test_swarm_sitl.py`：26 项通过。
- 后端全量 pytest：85 项通过、1 项已有失败。失败为 `tests/test_experiment_api.py::test_waypoint_tampering_rejects_points_outside_home_fence`，实验四安全接口预期 HTTP 422，实际 503。使用修改前的 swarm_sitl.py 在隔离目录复核，同样失败；未修改此无关接口和测试。

验证边界：本轮 API 使用 HTTP 合约与调度测试替身验证，未启动实际 Gazebo/SITL 飞行，也未连接真实硬件。实验一现有 MockMissionService 仅确认航线上传/启动；本轮未新增 AUTO 自动航点飞行能力。已验证的实际 Mock 运动为基础起飞、移动、降落。

范围核对：相对于修改前快照，前端仅 5 个源文件、2 个测试文件变更；后端 1 个源文件、1 个测试文件变更。实验三、CSS、环境配置和依赖没有在本轮修改。具体文件和修改前后哈希见 `ui-verification/bugfix-exp1-exp2-2026-10-31/source-scope.json`，测试日志和离线页面截图也在同目录。
