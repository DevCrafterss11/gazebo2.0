# 实验三两轮操作与视觉自检（2026-10-31）

## 范围和结论

基于当前工作区迭代，完成两轮实际浏览器验收和代码修复，重点是学生从系统感知、启动、组网、监控，到独立任务配置、执行、安全收尾、评价、再次执行的完整链路。保持现有地图指挥工作区、实时视图和平台设计，不修改实验一、二，也没有接入真实飞控。

沿用最终业务规则：15架统一启动且不默认分配任务；五种任务独立配置；同一时刻只执行一个任务，该任务允许多架无人机参与。不是五组统一启动。

工作分支为 `upload/muva-experiment3-2026-10-22`。开始时已检查工作区。原有未提交改动、用户文档和 ArduCopter dump 均保留，没有 reset、清理、提交或推送。

## 第一轮：实际操作并复现问题

执行六个原有浏览器脚本：

- `node tests/collaboration-student-browser.cjs`
- `node tests/collaboration-map-command-browser.cjs`
- `node tests/collaboration-live-reference-browser.cjs`
- `node tests/collaboration-readiness-browser.cjs`
- `node tests/collaboration-startup-browser.cjs`
- `node tests/collaboration-compact-browser.cjs`

六个脚本均通过，表明原有主要链路可用，但不能据此视为所有边界情况正确。继续检查状态与执行记录后，新增四项回归测试；修复前结果为29项中25项通过、4项失败，保留在 [修复前日志](ui-verification/collaboration/two-round-review-2026-10-31/round1/new-regressions-before.log)。

| 实际问题 | 本次修复 |
| --- | --- |
| 开始下一次任务会清空当前评价对象，导致已有历史评价的步骤6被锁住 | 入口和状态管理统一根据已归档任务记录判断，不依赖当前任务临时评价 |
| 任务已完成、正在安全返航时点击停止集群，会重新终止任务，覆盖成功结果 | 安全收尾期间等待现有返航落地，不再覆盖结果；重复终止操作也不会重写收尾结果 |
| 定点监测只停留片刻后终止，仍显示监测点完成率100% | 完成率要求实际任务完成且有效停留达到配置时长；部分停留仍记录真实时长，完成率为0% |
| 已有运行时再次收到启动请求，会先清理再重建定时器，推迟下一次更新 | 运行时启动改为幂等，已经运行则复用时钟；返航等命令不重置执行节奏 |

同时修复监控显示不一致：

- 把资源异常、通信中断、数据过期、低电量的判断统一到领域函数 `droneAlert`。
- 机队列表、地图标记提示、实时遥测卡片共同使用这一判断。断连标记有文字，且地图采用离线颜色。
- 机队顶部区分模拟待命、任务运行中、安全停止中、已停止，不再将任务执行中的集群显示为待命。
- 移除机队详情中重复的“进入任务指挥”按钮，保留页面统一入口。

## 第二轮：修复后的完整链路与视觉复核

新增 `tests/collaboration-two-round-browser.cjs`，使用全新浏览器会话完成：

1. 未选择模拟模式不能越过前置条件；集群启动后15架待命、未解锁、无任务占用；编号、IP、3×5阵列及地图15个标记一致。
2. 为定点监测配置资格、选择3架、设置参数；确认弹窗可取消，只有明确确认才开始当前任务。
3. 暂停后位置保持；切换到运输工作区不会启动运输，并可返回正在执行的监测任务；继续后恢复运动。
4. 监测只停留部分时间后终止，安全落地归档，完成率0%、有效监测时长大于0，轨迹保留、集群仍运行。
5. 再次执行后仍可进入旧实验评价，并返回监控；查看记录不影响当前任务。
6. 用 Store 已有的公开故障动作注入单机通信中断，核对机队异常数量、文字和实时视图告警一致。说明：该项通过 `injectFailure('DISCONNECT', 'uav103')` 注入，其余正常配置和控制通过UI操作；当前UI的模拟异常入口主要演示低电量。
7. 等待任务自然完成进入安全收尾；停止集群先取消确认再确认，等待落地后停止。归档结果仍为“已完成”、监测完成率100%，保留通信异常记录，没有被追加任务终止事件。
8. 停止后仍能看归档；重新启动15架恢复待命、无实际任务占用，历史记录保留。
9. 补跑目标搜索的成功分支：实际飞完搜索航线、产生模拟目标发现事件，等待学生明确人工复核后归档为已完成，返航释放资源。
10. 在1366×768、390×844逐个进入全部六步，检查页面横向溢出、导航可达和截图。

第二轮同时重新执行学生流程、五类任务地图流程、实时视图、紧凑步骤四个浏览器脚本，全部通过。

五任务地图流程实际完成巡逻、监测、运输、救援；搜索专门用于提前终止验证。搜索正常完成、人工复核与发现事件由新增的第二轮浏览器脚本另行实际操作验证；学生流程另外覆盖搜索资源不足时的异常处置。地图流程保存各类参数、执行位置、结果及异常信息，不能将截图中的进度条存在等同于任务已验证。

### 第二轮发现并修正的视觉问题

390px宽度下，步骤4、6原先仍是大标题与横向滚动步骤栏，当前步骤会在可视范围之外，返回实验中心文字也会被挤成多行。统一六步手机端标题区：

- 六步采用3列×2行展示，保留当前、完成、禁用状态，不再依赖横向滚动寻找当前步骤。
- 减少重复标题和摘要，保留业务主体的统计信息。
- 返回链接保持单行，手机保留明确的“MOCK · 教学模拟”标识；较长数据边界说明在桌面显示。
- 合并此前仅针对部分步骤的重复导航样式。

浏览器补充断言：390px时所有教学步骤按钮均在导航边界内，当前按钮具有 `aria-current="step"`，返回链接不换行。已重新运行通过。

查看了桌面任务执行、任务参数图层、资源管理、实时视图、六步窄屏等实际截图。地图仍为主区域；配置通过浮层打开，未把地图缩成一列；实时视图保持遥测列表、地图、控制图层的组织方式，没有额外加入任务导航和启动按钮。

## 本次修改文件

仅列本次自检实际编辑的源文件和测试，不将之前已有工作区改动算作本次成果。

| 文件 | 内容 |
| --- | --- |
| `src/stores/collaborationStore.ts` | 历史评价入口、安全收尾停止与重复终止保护 |
| `src/services/mock/CollaborationMockRuntime.ts` | 幂等启动，复用执行时钟 |
| `src/domain/collaborationMission.ts` | 监测评价修正、共享资源告警判断 |
| `src/experiments/collaboration/CollaborationExperimentPage.tsx` | 评价入口、机队状态、移除重复入口、窄屏来源标识 |
| `src/experiments/collaboration/Collaboration.module.css` | 统一全部六步的窄屏标题与教学导航 |
| `src/experiments/collaboration/components/LiveTelemetry.tsx` | 共享实例状态及资源告警 |
| `src/experiments/collaboration/components/FleetMap.tsx` | 断连标记和告警文字与遥测一致 |
| `tests/collaboration.test.ts` | 新增4项先失败再修复通过的回归用例 |
| `tests/collaboration-two-round-browser.cjs` | 新增安全收尾、评价、断连、重启与六步响应式验收 |
| 本报告及 `docs/ui-verification/collaboration/two-round-review-2026-10-31/` | 两轮日志、截图、结构化结果 |

## 工程检查结果

| 命令 | 实际结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run test:collaboration` | 29/29通过，包含新增4项回归 |
| `npm run build` | 通过；仍提示部分bundle大于500KB，未为此进行无关拆包 |
| `npm test` | 115/120通过，5项实验二既有失败 |
| `npm run test:experiment1-map` | 单独执行，17/19通过，2项实验一既有失败 |
| lint | `package.json`未配置lint脚本，也没有现成lint配置；未虚报通过、未新增依赖 |
| `git diff --check` | 通过 |

全项目原有失败与此前 [实时视图验收报告](experiment3-live-reference-2026-10-31.md) 记录一致：实验二用例89–92的连续运动最小间距断言失败，用例104提前返航触发禁飞缓冲区规划校验；实验一两项相机用例预期初始缩放18，实际17.2。本轮未改动这些实验的代码或放宽断言。不能据此声称全仓库测试全部通过。

浏览器均使用实际Chrome无头运行。为了可重复地等待飞行和验证暂停，脚本使用Playwright时钟推进，检查的是实际渲染、UI动作和统一运行时更新，不需要真实后端。专项浏览器验收未捕获到页面异常或console.error。

## 日志和截图

- [第一轮证据](ui-verification/collaboration/two-round-review-2026-10-31/round1/)
- [第二轮证据](ui-verification/collaboration/two-round-review-2026-10-31/round2/)
- [工程检查原始日志](ui-verification/collaboration/two-round-review-2026-10-31/checks/)
- [独立任务执行桌面](ui-verification/collaboration/two-round-review-2026-10-31/round2/map-command/04-4-execution.png)
- [资源管理图层](ui-verification/collaboration/two-round-review-2026-10-31/round2/map-command/02-resource-layer.png)
- [任务参数窄屏](ui-verification/collaboration/two-round-review-2026-10-31/round2/map-command/09-narrow-layer.png)
- [修正后的390px机队页面](ui-verification/collaboration/two-round-review-2026-10-31/round2/lifecycle/11-390-step4.png)
- [执行新任务时查看旧评价](ui-verification/collaboration/two-round-review-2026-10-31/round2/lifecycle/06-old-evaluation-during-new-flight.png)
- [通信中断实时显示](ui-verification/collaboration/two-round-review-2026-10-31/round2/lifecycle/08-disconnected-live.png)
- [安全停止后的保留结果](ui-verification/collaboration/two-round-review-2026-10-31/round2/lifecycle/10-retained-evaluations.png)

## 运行与能力边界

当前开发服务：`http://127.0.0.1:5175/experiments/collaboration`。

```bash
cd /home/vip/muva/MUVA_unified_full_student_v2_integrated
export PATH=/home/vip/muva/.tools/node/bin:$PATH
VITE_DATA_SOURCE=mock npm run dev -- --host 127.0.0.1 --port 5175
```

本轮没有新建第二套运行时。集群启动/遥测心跳及任务运动由已有Mock适配器驱动，Store统一任务占用、角色、事件、记录和评价。任务完成后返航落地再释放资源；历史记录保存快照。页面/图层切换不清空同一浏览器会话中的状态；本轮不宣称整页刷新或关闭浏览器后仍持久化保存。

本次实际验证的是Mock教学流程。Gazebo、SITL、树莓派网络、真实飞控遥测和真实返航指令未接入、未验证；界面中的在线、心跳、位置和返航均为明确标识的教学模拟。剩余全项目测试失败如上，不将其隐藏为验收通过。
