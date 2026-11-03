# 本次上传验证记录

验证日期：2026 年 11 月 3 日。

## 前端与实验界面

- `npm run typecheck`：通过。
- `npm run build`：通过；存在构建包体积超过 500 kB 的提示。
- `npm test`：19 项通过。
- `npm run test:collaboration`：9 项通过。
- `npm run test:attack-config`：6 项通过。
- 五个实验均完成浏览器 Mock 流程，采集 31 张最终版步骤截图；实验一、二、三包含模拟执行结果页。
- GPS 浏览器验证通过：跨五类并发任务选择 15 架目标、逐机参数、配置持久化、弹窗尺寸与窄屏布局、红色实际轨迹、独立停止及历史保留。
- 另附 3 张 GPS 逐机配置、窄屏配置和运行轨迹截图。

截图使用当前前端的 Mock 数据源；本次未执行真实 SITL/Gazebo 飞行验证。

## Gateway

执行 `PYTHONPATH=.packages:. python3 -m pytest -q`：101 项通过，1 项失败。

失败用例：`tests/test_experiment_api.py::test_waypoint_tampering_rejects_points_outside_home_fence`。
该用例期望航点越界请求返回 HTTP 422，实际返回 HTTP 503；这一问题尚未修复。本次文档整理未修改该接口实现。

[返回实验步骤](README.md)
