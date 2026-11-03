import math
import threading
import signal
import json
import socket
import xml.etree.ElementTree as ET
from types import SimpleNamespace
from unittest.mock import Mock
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pymavlink import mavutil

from muva_gateway.commands import CommandRejectedError, InvalidCommandError
from muva_gateway.swarm_app import create_swarm_app
from muva_gateway.swarm_routing import timed_paths_violate_separation, plan_parallel_routes
from muva_gateway.swarm_console import FlightConsole, read_display
from muva_gateway.swarm_sitl import SwarmSitlRuntime, SwarmVehicleState


class EkfReport:
    def __init__(self, flags: int, system: int = 21) -> None:
        self.flags = flags
        self.system = system

    def get_type(self) -> str:
        return "EKF_STATUS_REPORT"

    def get_srcSystem(self) -> int:
        return self.system

    def get_srcComponent(self) -> int:
        return 1


def test_return_preflight_compares_concurrent_segments_not_static_crossings() -> None:
    first = [[-10, 0], [10, 0]]
    second = [[0, -10], [0, 10]]

    assert not timed_paths_violate_separation(first, 0, second, 20, 9.5, 1)
    assert timed_paths_violate_separation(first, 0, second, 0, 9.5, 1)


@pytest.fixture
def crossing_return_plan():
    origin = [116.3268, 40.0098]
    scale = 111320 * math.cos(math.radians(origin[1]))
    geo = lambda point: [origin[0] + point[0] / scale, origin[1] + point[1] / 110540]
    homes = [geo([-15, 0]), geo([15, 0])]
    vehicles = [SimpleNamespace(drone_id=f"UAV-0{index + 1}", home=home) for index, home in enumerate(homes)]
    paths = [
        ([-15, 5], [-15, 10], [-15, 20], [[-15, 20], [0, 10], [-15, 0]]),
        ([15, 5], [15, 10], [15, 20], [[15, 20], [0, 10], [15, 0]]),
    ]
    missions = []
    for index, (entry_start, coverage_start, coverage_end, returning) in enumerate(paths):
        mission_points = [geo(entry_start), geo(coverage_start), geo(coverage_end)]
        missions.append({
            "missionId": f"mission-{index + 1}", "droneId": vehicles[index].drone_id,
            "assignedArea": 100, "waypoints": mission_points,
            "entryPath": [homes[index], *mission_points[:2]],
            "returnPath": [geo(point) for point in returning],
            "coverageStartIndex": 1, "coverageWaypointIndices": [2],
            "coverageSegments": [[mission_points[1], mission_points[2]]],
            "routingObstacles": [],
        })
    assert timed_paths_violate_separation(
        [[-15, 20], [0, 10], [-15, 0]], 20 / 7,
        [[15, 20], [0, 10], [15, 0]], 20 / 7, 9.5, 7,
    )
    runtime = object.__new__(SwarmSitlRuntime)
    runtime.vehicles = vehicles
    runtime.config = {"sceneOrigin": origin, "speed": 7, "safety": 8, "altitude": 20}
    return runtime, missions, geo


def test_upload_automatically_resolves_crossing_returns_and_keeps_parallel_routes(crossing_return_plan) -> None:
    runtime, missions, _ = crossing_return_plan
    runtime._validate_plan(missions)
    assert sorted(runtime.dispatch_order) == [0, 1]
    assert sum(runtime.dispatch_waits) > 0
    paths = [[[-15, 0], [-15, 10], [-15, 20], [0, 10], [-15, 0]],
             [[15, 0], [15, 10], [15, 20], [0, 10], [15, 0]]]
    schedule = plan_parallel_routes(paths, 10, 7, 4)
    assert schedule["maxConcurrent"] == 2


def test_parallel_preflight_rejects_unresolvable_endpoint_deadlock() -> None:
    with pytest.raises(CommandRejectedError, match="无法安全放行"):
        plan_parallel_routes([[[-15, 0], [15, 0]], [[15, 0], [-15, 0]]], 10, 7, 4)


def test_parallel_preflight_rejects_initial_unsafe_spacing() -> None:
    with pytest.raises(CommandRejectedError, match="起降点不足安全间距"):
        plan_parallel_routes([[[0, 0], [0, 20]], [[5, 0], [5, 20]]], 10, 7, 4)


def test_upload_still_rejects_a_mismatched_entry_path(crossing_return_plan) -> None:
    runtime, missions, _ = crossing_return_plan
    missions[0]["entryPath"].pop(1)
    with pytest.raises(InvalidCommandError, match="入场路径与实际执行航点不一致"):
        runtime._validate_plan(missions)


def test_position_readiness_requires_fresh_ekf_and_gps() -> None:
    state = SwarmVehicleState()
    state.is_online = lambda: True
    state._telemetry["gpsFixType"] = 3
    state.handle_message(EkfReport(0))
    assert not state.position_ready()
    state.handle_message(EkfReport(mavutil.mavlink.ESTIMATOR_POS_HORIZ_ABS))
    assert state.position_ready()
    state.handle_message(EkfReport(0))
    assert not state.position_ready()
    state.handle_message(EkfReport(mavutil.mavlink.ESTIMATOR_POS_HORIZ_ABS))
    state._position_estimate_at -= 10
    assert not state.position_ready()
    state.handle_message(EkfReport(mavutil.mavlink.ESTIMATOR_POS_HORIZ_ABS))
    state.set_transport_connected(False)
    assert not state.position_ready()


def test_ready_rejects_missing_ekf_and_shutdown_rejects_offline(tmp_path) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    state = SwarmVehicleState()
    state.is_online = lambda: True
    state._telemetry["gpsFixType"] = 3
    runtime.vehicles = [SimpleNamespace(state=state, process=SimpleNamespace(poll=lambda: None))]
    runtime.plan_id = "plan"
    runtime.receipts = [{}]
    runtime.status = "PLANNED"
    runtime.snapshot = lambda: {"status": runtime.status}
    try:
        with pytest.raises(CommandRejectedError, match="EKF"):
            runtime.command("ready")
        state.handle_message(EkfReport(mavutil.mavlink.ESTIMATOR_POS_HORIZ_ABS))
        assert runtime.command("ready")["status"] == "READY"
        state.is_online = lambda: False
        with pytest.raises(CommandRejectedError, match="离线"):
            runtime.require_ground()
        runtime.session_id = "session"
        with pytest.raises(CommandRejectedError, match="离线"):
            runtime.shutdown("session")
    finally:
        runtime.vehicles = []
        runtime.close()


def test_six_vehicle_config_and_safe_restart(monkeypatch, tmp_path) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    config = {"count": 6, "altitude": 30, "speed": 7, "spacing": 12, "safety": 8}
    runtime.validate_config(config)
    with pytest.raises(InvalidCommandError, match="count"):
        runtime.validate_config({**config, "count": 7})
    state = SwarmVehicleState()
    state.is_online = lambda: True
    runtime.session_id = "original-session"
    runtime.vehicles = [SimpleNamespace(state=state, process=SimpleNamespace(poll=lambda: None))]
    closed = []
    monkeypatch.setattr(runtime, "_close_vehicles", lambda: (closed.append(True), runtime.vehicles.clear()))
    try:
        state._vehicle["armed"] = True
        with pytest.raises(CommandRejectedError, match="已解锁"):
            runtime.shutdown("original-session")
        state._vehicle["armed"] = False
        state._telemetry["altitude"] = 30
        with pytest.raises(CommandRejectedError, match="无法确认落地"):
            runtime.shutdown("original-session")
        assert runtime.session_id == "original-session" and not closed
        state._telemetry["altitude"] = 0
        runtime.shutdown("original-session")
        assert closed and runtime.session_id is None
    finally:
        runtime.close()


def test_experiment2_world_generates_isolated_iris_models_and_fdm_ports(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("MUVA_SWARM_FDM_BASE_PORT", "19202")
    runtime = SwarmSitlRuntime(workspace=Path(__file__).resolve().parents[2], state_dir=tmp_path)
    runtime.session_id = "experiment2-test-session"
    try:
        world_path, model_path = runtime._prepare_world(2, [116.4, 39.9])
        world = ET.parse(world_path).getroot().find("world")
        assert world is not None
        assert world.get("name").startswith("muva_experiment2_")
        runway = next(node for node in world.findall("include") if node.findtext("uri") == "model://runway")
        assert runway.findtext("pose") == "0 0 0 0 0 363"
        drones = [node for node in world.findall("include") if node.findtext("name", "").startswith("uav_")]
        assert [node.findtext("name") for node in drones] == ["uav_01", "uav_02"]
        assert [node.findtext("pose") for node in drones] == [
            "-7 0 0.195 0 0 0", "7 0 0.195 0 0 0"]
        assert world.findtext("spherical_coordinates/longitude_deg") == "116.4"
        assert world.findtext("spherical_coordinates/latitude_deg") == "39.9"
        ports = []
        for index in range(2):
            model = ET.parse(model_path / f"uav_{index + 1:02}" / "model.sdf").getroot().find("model")
            assert model is not None and model.get("name") == f"uav_{index + 1:02}"
            plugin = next(node for node in model.findall("plugin") if node.get("name") == "ArduPilotPlugin")
            ports.append(int(plugin.findtext("fdm_port_in")))
        assert ports == [19202, 19212]
        assert runtime.fdm_base_port == 19202
    finally:
        runtime.close()


def test_stale_session_can_only_be_cleared_without_a_live_fleet(tmp_path) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        runtime.base_port = probe.getsockname()[1]
    try:
        runtime.shutdown("previous-session")
        assert runtime.session_id is None and not runtime.vehicles
        with TestClient(create_swarm_app(runtime)) as client:
            response = client.post("/api/swarm/shutdown", json={"sessionId": "previous-session", "action": "shutdown"})
            assert response.status_code == 200 and response.json() == {"stopped": True}
        with socket.socket() as occupied:
            occupied.bind(("127.0.0.1", runtime.base_port))
            with pytest.raises(CommandRejectedError, match="仍被占用"):
                runtime.shutdown("previous-session")
        runtime.session_id = "another-session"
        with pytest.raises(CommandRejectedError, match="已失效"):
            runtime.shutdown("previous-session")
        runtime.session_id = None
        runtime.vehicles = [SimpleNamespace()]
        with pytest.raises(CommandRejectedError, match="已失效"):
            runtime.shutdown("previous-session")
    finally:
        runtime.vehicles = []
        runtime.close()


def test_coverage_counts_last_confirmed_waypoint(tmp_path) -> None:
    runtime = object.__new__(SwarmSitlRuntime)
    runtime._cancel = threading.Event()
    runtime.return_requested = set()
    runtime.paused = False
    runtime._returning = False
    runtime.config = {"speed": 5}
    runtime._check_motion = lambda: None
    runtime._position = lambda vehicle: vehicle.position
    runtime._target = lambda vehicle, point: setattr(vehicle, "position", point)
    path = [[116.3268, 40.0098], [116.3268, 40.00983], [116.3268, 40.00986]]
    console = FlightConsole(tmp_path / "uav-1")
    vehicle = SimpleNamespace(drone_id="UAV-01", phase="HOLDING", console=console, state=SimpleNamespace(
        is_online=lambda: True, telemetry_value=lambda name: 0), position=path[0], waypoint_index=0, completed=0)
    runtime.vehicles = [vehicle]
    runtime.plan = [{"droneId": vehicle.drone_id, "coverageStartIndex": 0, "coverageWaypointIndices": [1, 2]}]

    runtime._move_many({vehicle.drone_id: path[1:]}, coverage=True)

    assert vehicle.completed == 2
    assert vehicle.waypoint_index == 2
    recorded = [json.loads(line) for line in console.events_file.read_text().splitlines()]
    assert [event["kind"] for event in recorded] == ["TX", "DONE", "TX", "DONE"]


def test_takeoff_runs_each_command_phase_for_all_vehicles_concurrently() -> None:
    runtime = object.__new__(SwarmSitlRuntime)
    runtime.started_at = None
    runtime.return_requested = set()
    runtime._returning = False
    runtime.config = {"altitude": 12}
    runtime.status = "TAKING_OFF"
    runtime.event = lambda message: None
    runtime._record = lambda vehicle, kind, message: None
    barriers = [threading.Barrier(2) for _ in range(3)]
    vehicles = []
    for index in range(2):
        commands = SimpleNamespace(
            set_mode=lambda mode, barrier=barriers[0]: barrier.wait(timeout=2),
            arm=lambda value, barrier=barriers[1]: barrier.wait(timeout=2),
            takeoff=lambda altitude, barrier=barriers[2]: barrier.wait(timeout=2),
        )
        state = SimpleNamespace(telemetry_value=lambda name: 12)
        vehicles.append(SimpleNamespace(commands=commands, state=state, phase="READY"))
    runtime.vehicles = vehicles

    runtime._takeoff()

    assert all(vehicle.phase == "HOLDING" for vehicle in vehicles)
    assert runtime.status == "HOLDING"


def test_start_mission_schedules_each_complete_route_with_coverage_boundaries() -> None:
    runtime = object.__new__(SwarmSitlRuntime)
    landing_barrier = threading.Barrier(2)
    runtime.vehicles = [SimpleNamespace(drone_id="UAV-01", phase="HOLDING", waypoint_index=0, completed=0,
                                        returning=[], commands=SimpleNamespace(land=lambda: landing_barrier.wait(timeout=2)),
                                        state=SimpleNamespace(wait_for=lambda predicate, timeout: True)),
                        SimpleNamespace(drone_id="UAV-02", phase="HOLDING", waypoint_index=0, completed=0,
                                        returning=[], commands=SimpleNamespace(land=lambda: landing_barrier.wait(timeout=2)),
                                        state=SimpleNamespace(wait_for=lambda predicate, timeout: True))]
    runtime.plan = [
        {"droneId": "UAV-01", "entryPath": [[1, 1], [1, 2]], "waypoints": [[1, 2], [1, 3]],
         "coverageStartIndex": 0, "coverageWaypointIndices": [1], "coverageSegments": [[0, 1]], "returnPath": [[1, 3], [1, 4]]},
        {"droneId": "UAV-02", "entryPath": [[2, 1], [2, 2]], "waypoints": [[2, 2], [2, 3]],
         "coverageStartIndex": 0, "coverageWaypointIndices": [1], "coverageSegments": [[0, 1]], "returnPath": [[2, 3], [2, 4]]},
    ]
    scheduled = []
    def move(routes, coverage=False, coverage_ranges=None, on_complete=None):
        scheduled.append((routes, coverage_ranges))
        for vehicle in runtime.vehicles:
            on_complete(vehicle)
    runtime._move_many = move
    runtime.event = lambda message: None
    runtime._finish = lambda: None
    runtime._record = lambda vehicle, kind, message: None
    runtime.status = "HOLDING"
    runtime._returning = False

    runtime._execute()

    assert scheduled == [(
        {"UAV-01": [[1, 2], [1, 3], [1, 4]], "UAV-02": [[2, 2], [2, 3], [2, 4]]},
        {"UAV-01": (1, 1, 0), "UAV-02": (1, 1, 0)},
    )]


def test_completed_mission_returns_and_lands_all_vehicles_concurrently() -> None:
    runtime = object.__new__(SwarmSitlRuntime)
    runtime._returning = False
    runtime.event = lambda message: None
    runtime._record = lambda vehicle, kind, message: None
    runtime._move_many = lambda routes: None
    landing_barrier = threading.Barrier(2)
    vehicles = []
    for index in range(2):
        commands = SimpleNamespace(land=lambda barrier=landing_barrier: barrier.wait(timeout=2))
        state = SimpleNamespace(
            wait_for=lambda predicate, timeout: True,
            vehicle_value=lambda name: False,
            telemetry_value=lambda name: 0,
        )
        vehicles.append(SimpleNamespace(drone_id=f"UAV-0{index + 1}", phase="RUNNING", returning=[], commands=commands, state=state))
    runtime.vehicles = vehicles

    runtime._return_fleet({vehicle.drone_id: [[index, 0], [index, 1]] for index, vehicle in enumerate(vehicles)})

    assert all(vehicle.phase == "LANDED" and vehicle.returning == [] for vehicle in vehicles)
    assert runtime._returning is False


@pytest.mark.parametrize("count", [2, 6])
def test_initialization_opens_separate_read_only_terminals(monkeypatch, tmp_path, count) -> None:
    runtime = SwarmSitlRuntime(workspace=tmp_path, state_dir=tmp_path / "state")
    runtime.vehicles = [SimpleNamespace(drone_id=f"UAV-{index:02}", sys_id=20 + index,
                                        monitor_process=None, console=FlightConsole(runtime.state_dir / f"uav-{index}"))
                        for index in range(1, count + 1)]
    for index in range(1, count + 1):
        (runtime.state_dir / f"uav-{index}").mkdir(parents=True, exist_ok=True)
    spawned = []
    monkeypatch.setenv("DISPLAY", ":0")
    monkeypatch.delenv("MUVA_SWARM_MONITOR_TERMINALS", raising=False)
    monkeypatch.setattr("muva_gateway.swarm_sitl.shutil.which", lambda name: "/usr/bin/xterm")

    def start(args, **kwargs):
        spawned.append((args, kwargs))
        return SimpleNamespace(poll=lambda: None)

    monkeypatch.setattr("muva_gateway.swarm_sitl.subprocess.Popen", start)
    monkeypatch.setattr("muva_gateway.swarm_sitl.time.sleep", lambda seconds: None)
    try:
        runtime._open_monitors()
        assert len(spawned) == count
        assert [args[args.index("--directory") + 1] for args, _ in spawned] == [
            str(runtime.state_dir / f"uav-{index}") for index in range(1, count + 1)]
        assert [args[args.index("--sys-id") + 1] for args, _ in spawned] == [str(20 + index) for index in range(1, count + 1)]
        assert all(args[args.index("-fa") + 1] == "Noto Sans Mono CJK SC" and args[args.index("-u8")] == "-u8" for args, _ in spawned)
        assert all("muva_gateway.swarm_console" in args and "-title" in args for args, _ in spawned)
        assert all(kwargs["env"]["LC_ALL"] == "zh_CN.UTF-8" and kwargs["env"]["PYTHONIOENCODING"] == "UTF-8" for _, kwargs in spawned)
        assert all(vehicle.monitor_process is not None for vehicle in runtime.vehicles)
        monkeypatch.setenv("MUVA_SWARM_MONITOR_TERMINALS", "0")
        runtime._open_monitors()
        assert len(spawned) == count
    finally:
        runtime.vehicles = []
        runtime.close()


def test_monitor_terminals_are_optional_without_desktop(monkeypatch, tmp_path) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("MUVA_SWARM_MONITOR_TERMINALS", raising=False)
    try:
        runtime._open_monitors()
        assert "commands.jsonl" in runtime.events[-1]
    finally:
        runtime.close()


def test_per_vehicle_console_records_real_ack_and_confirmed_state(tmp_path) -> None:
    first = FlightConsole(tmp_path / "uav-1")
    second = FlightConsole(tmp_path / "uav-2")
    state_first = SwarmVehicleState(console=first)
    state_second = SwarmVehicleState(console=second)
    state_first._vehicle["systemId"] = 21
    state_second._vehicle["systemId"] = 22

    def ack(system_id: int, result: int):
        return SimpleNamespace(get_type=lambda: "COMMAND_ACK", get_srcSystem=lambda: system_id,
                               get_srcComponent=lambda: 1, command=400, result=result)

    first.record("TX", "ARM target=21")
    state_first.handle_message(ack(21, mavutil.mavlink.MAV_RESULT_ACCEPTED))
    state_first.handle_message(ack(22, mavutil.mavlink.MAV_RESULT_DENIED))
    state_second.handle_message(ack(22, mavutil.mavlink.MAV_RESULT_DENIED))
    assert all(event["kind"] != "DONE" for event in (json.loads(line) for line in first.events_file.read_text().splitlines()))
    first.record("DONE", "飞控 ACK + 心跳确认解锁")
    first.update({"connected": True, "armed": True, "flightMode": "GUIDED", "phase": "HOLDING"})

    first_events = [json.loads(line) for line in first.events_file.read_text().splitlines()]
    second_events = [json.loads(line) for line in second.events_file.read_text().splitlines()]
    assert [event["kind"] for event in first_events] == ["TX", "RX", "DONE"]
    assert "ACCEPTED" in first_events[1]["text"]
    assert len(second_events) == 1 and "DENIED" in second_events[0]["text"]
    display = read_display(tmp_path / "uav-1", "UAV-01", 21)
    assert "GUIDED" in display and "心跳确认解锁" in display
    assert "DENIED" not in display


def test_new_session_archives_prior_command_record(tmp_path) -> None:
    previous = FlightConsole(tmp_path / "uav-1")
    previous.record("DONE", "上次任务已完成")
    current = FlightConsole(tmp_path / "uav-1")
    current.record("INFO", "新的任务")
    archives = list((tmp_path / "uav-1").glob("commands-*.jsonl"))
    assert len(archives) == 1
    assert "上次任务已完成" in archives[0].read_text()
    assert "上次任务已完成" not in current.events_file.read_text()


def test_console_write_failure_does_not_block_flight(tmp_path) -> None:
    console = FlightConsole(tmp_path / "uav-1")
    console.events_file = tmp_path / "unavailable" / "commands.jsonl"
    console.state_file = tmp_path / "unavailable" / "flight-state.json"
    console.record("TX", "ARM")
    console.update({"armed": False})
    assert console._write_failed


def test_closing_monitor_group_does_not_stop_other_vehicle(monkeypatch, tmp_path) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    terminated = []
    monkeypatch.setattr("muva_gateway.swarm_sitl.os.killpg", lambda pid, sig: terminated.append((pid, sig)))
    vehicle = SimpleNamespace(monitor_process=SimpleNamespace(pid=98765, poll=lambda: None, wait=Mock()),
                              transport=SimpleNamespace(stop=Mock()),
                              process=SimpleNamespace(poll=lambda: 0), log_file=SimpleNamespace(close=Mock()))
    runtime.vehicles = [vehicle]
    runtime.close()
    assert terminated == [(98765, signal.SIGTERM)]
    vehicle.transport.stop.assert_called_once()
    vehicle.log_file.close.assert_called_once()


def test_abort_simulation_requires_explicit_confirmation_and_releases_session(tmp_path) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    runtime.session_id = "active-session"
    try:
        with pytest.raises(CommandRejectedError, match="明确确认"):
            runtime.abort_simulation("active-session", False)
        runtime.abort_simulation("active-session", True)
        assert runtime.session_id is None
        assert runtime.status == "ABORTED"
        assert "未确认飞行器已安全着陆" in runtime.last_error
    finally:
        runtime.close()


@pytest.mark.parametrize("safety", [None, 8])
def test_configure_api_defaults_only_missing_safety_to_three(monkeypatch, tmp_path, safety) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    config = {"count": 3, "altitude": 30, "speed": 7, "spacing": 12}
    if safety is not None:
        config["safety"] = safety
    captured = []

    def validate(value):
        SwarmSitlRuntime.validate_config(value)
        captured.append(value["safety"])
        # Stop before launching any real Gazebo/SITL processes in this contract test.
        raise InvalidCommandError("validated without launching SITL")

    monkeypatch.setattr(runtime, "validate_config", validate)
    with TestClient(create_swarm_app(runtime)) as client:
        reply = client.post("/api/swarm/configure", json={"config": config})
        assert reply.status_code == 422
        assert reply.json()["detail"] == "validated without launching SITL"
    assert captured == [3 if safety is None else safety]
    assert ("safety" in config) == (safety is not None)


@pytest.mark.parametrize("failure", [None, "reject", "timeout"])
def test_return_api_sends_parallel_direct_rtl_and_isolates_aircraft_failure(monkeypatch, tmp_path, failure) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    runtime._stop.set()
    runtime._monitor.join(timeout=2)
    runtime.config = {"sceneOrigin": [116.3268, 40.0098], "altitude": 30, "speed": 7, "safety": 8}
    runtime.session_id = "rtl-test"
    runtime.status = "HOLDING"
    origin = runtime.config["sceneOrigin"]
    geo = lambda east: [origin[0] + east / (111320 * math.cos(math.radians(origin[1]))), origin[1]]
    sent = []
    # A serial implementation cannot reach this barrier and fails the test.
    issued_together = threading.Barrier(3, timeout=3)
    for index in range(3):
        state = SwarmVehicleState()
        state.is_online = lambda: True
        state._vehicle.update(armed=True, mode="GUIDED")
        state._telemetry.update(longitude=geo(index * 20)[0], latitude=origin[1], altitude=30, groundSpeed=0)
        vehicle = SimpleNamespace(drone_id=f"UAV-0{index + 1}", sys_id=index + 1, state=state,
                                  home=geo(600 if index == 0 else 60 + index * 20),
                                  phase="HOLDING", returning=[], completed=0, waypoint_index=0,
                                  trajectory=[], endpoint="test", console=None)
        def rtl(vehicle=vehicle, index=index):
            sent.append(vehicle.drone_id)
            issued_together.wait()
            if index == 0 and failure == "reject":
                raise CommandRejectedError("RTL ACK rejected")
            if index == 0 and failure == "timeout":
                return
            vehicle.state._vehicle.update(armed=False, mode="RTL")
            vehicle.state._telemetry.update(altitude=0, longitude=vehicle.home[0], latitude=vehicle.home[1])
        vehicle.commands = SimpleNamespace(rtl=rtl, set_mode=Mock())
        if index == 0 and failure == "timeout":
            state.wait_for = lambda predicate, timeout: False
        runtime.vehicles.append(vehicle)
        runtime.plan.append({"droneId": vehicle.drone_id, "coverageSegments": [[0, 1]]})
    monkeypatch.setattr(runtime, "_safe_return", Mock(side_effect=AssertionError("explicit RTL must not plan a path")))
    monkeypatch.setattr(runtime, "_check_motion", Mock(side_effect=AssertionError("explicit RTL must not check separation")))
    monkeypatch.setattr(runtime, "_target", Mock())
    close = runtime.close
    monkeypatch.setattr(runtime, "close", lambda: None)
    try:
        with TestClient(create_swarm_app(runtime)) as client:
            reply = client.post("/api/swarm/command", json={"sessionId": "rtl-test", "action": "returnToHome"})
            assert reply.status_code == 200
            runtime._worker.join(timeout=5)
            assert not runtime._worker.is_alive(), "RTL 并行线程应独立结束"
            snapshot = runtime.snapshot()
            assert set(sent) == {"UAV-01", "UAV-02", "UAV-03"}
            assert all(drone["state"] == "LANDED" for drone in snapshot["drones"][1:])
            if failure:
                assert snapshot["status"] == "FAILED"
                assert snapshot["drones"][0]["armed"] is True
                assert snapshot["drones"][0]["state"] != "LANDED"
                assert "UAV-01 RTL 返航未完成" in snapshot["runtime"]["error"]
            else:
                assert snapshot["status"] == "ABORTED"  # Early RTL must not invent coverage.
                assert snapshot["runtime"]["error"] is None
                assert all(drone["state"] == "LANDED" for drone in snapshot["drones"])
            assert not runtime.return_requested
            runtime._safe_return.assert_not_called()
            runtime._check_motion.assert_not_called()
            runtime._target.assert_not_called()
            for vehicle in runtime.vehicles:
                vehicle.commands.set_mode.assert_not_called()
    finally:
        runtime.vehicles = []
        close()


def test_return_execution_error_releases_return_flag_and_still_propagates() -> None:
    runtime = object.__new__(SwarmSitlRuntime)
    runtime._returning = False
    runtime._move_many = Mock(side_effect=CommandRejectedError("heartbeat lost"))
    vehicle = SimpleNamespace(drone_id="UAV-01", phase="HOLDING", returning=[])
    with pytest.raises(CommandRejectedError, match="heartbeat lost"):
        runtime._return_vehicle(vehicle, [[1, 1], [1, 2]])
    assert runtime._returning is False
    assert vehicle.phase == "RETURNING"


def test_blocked_rtl_does_not_resume_old_coverage_route(monkeypatch) -> None:
    runtime = object.__new__(SwarmSitlRuntime)
    attempts = iter([False, True])
    runtime._cancel = SimpleNamespace(is_set=lambda: next(attempts))
    runtime._returning = False
    runtime.paused = False
    runtime.return_requested = {"UAV-01"}
    runtime._check_motion = lambda: None
    runtime._return_pending = Mock()
    runtime._position = lambda vehicle: [1, 1]
    runtime._target = Mock()
    runtime.vehicles = [SimpleNamespace(drone_id="UAV-01", phase="RETURNING",
                                       state=SimpleNamespace(vehicle_value=lambda name: True))]
    monkeypatch.setattr("muva_gateway.swarm_sitl.time.sleep", lambda seconds: None)
    with pytest.raises(CommandRejectedError, match="后端调度已停止"):
        runtime._move_many({"UAV-01": [[2, 2]]})
    # Holding its current position is permitted; continuing to the old waypoint is not.
    runtime._target.assert_called_once_with(runtime.vehicles[0], [1, 1])
    runtime._return_pending.assert_called_once()


def test_live_parallel_scheduler_yields_only_crossing_segments_and_auto_resumes(crossing_return_plan, monkeypatch) -> None:
    runtime, missions, geo = crossing_return_plan
    runtime._validate_plan(missions)
    runtime.plan = missions
    runtime._cancel = threading.Event()
    runtime.return_requested = set()
    runtime.paused = False
    runtime._returning = False
    events = []
    runtime.event = events.append
    runtime._record = lambda *args: None
    maximum = 0
    ticks = 0
    first_completed_while_other_active = []
    for vehicle in runtime.vehicles:
        vehicle.position = list(vehicle.home)
        vehicle.target = list(vehicle.home)
        vehicle.phase = "RUNNING"
        vehicle.completed = 0
        vehicle.waypoint_index = 0
        vehicle.state = SimpleNamespace(is_online=lambda: True,
            vehicle_value=lambda key, vehicle=vehicle: vehicle.phase != "LANDED",
            telemetry_value=lambda key, vehicle=vehicle: (0 if vehicle.phase == "LANDED" else 20) if key == "altitude"
                else (7 if math.dist(vehicle.position, vehicle.target) > 1e-10 else 0))
    runtime._position = lambda vehicle: vehicle.position
    runtime._target = lambda vehicle, point: setattr(vehicle, "target", list(point))
    scale = 111320 * math.cos(math.radians(runtime.config["sceneOrigin"][1]))
    local = lambda point: [(point[0] - runtime.config["sceneOrigin"][0]) * scale,
                           (point[1] - runtime.config["sceneOrigin"][1]) * 110540]

    def advance(seconds):
        nonlocal ticks, maximum
        ticks += 1
        assert ticks < 1000, "局部等待必须自动恢复，不能陷入死锁"
        moving = 0
        before = [local(vehicle.position) for vehicle in runtime.vehicles]
        for vehicle in runtime.vehicles:
            distance = math.dist(local(vehicle.position), local(vehicle.target))
            if distance < 1e-8:
                continue
            moving += 1
            ratio = min(1, 7 * seconds / distance)
            vehicle.position = [vehicle.position[axis] + ratio * (vehicle.target[axis] - vehicle.position[axis]) for axis in (0, 1)]
        maximum = max(maximum, moving)
        after = [local(vehicle.position) for vehicle in runtime.vehicles]
        if all(vehicle.phase != "LANDED" for vehicle in runtime.vehicles):
            start = [before[0][axis] - before[1][axis] for axis in (0, 1)]
            velocity = [after[0][axis] - after[1][axis] - start[axis] for axis in (0, 1)]
            squared = sum(value * value for value in velocity)
            ratio = max(0, min(1, -sum(start[axis] * velocity[axis] for axis in (0, 1)) / squared)) if squared else 0
            assert math.hypot(*(start[axis] + ratio * velocity[axis] for axis in (0, 1))) >= 10 - .02

    def completed(vehicle):
        first_completed_while_other_active.append(any(other.phase != "LANDED" for other in runtime.vehicles if other is not vehicle))
        vehicle.phase = "LANDED"

    monkeypatch.setattr("muva_gateway.swarm_sitl.time.sleep", advance)
    routes = {mission["droneId"]: [*mission["entryPath"][1:], *mission["waypoints"][2:], *mission["returnPath"][1:]] for mission in missions}
    runtime._move_many(routes, on_complete=completed)
    assert maximum == 2, "无冲突航段应同时飞行，不能退回全队串行"
    assert first_completed_while_other_active[0]
    assert any("局部避让等待" in event for event in events)
    assert any("自动继续执行" in event for event in events)
    assert all(vehicle.phase == "LANDED" for vehicle in runtime.vehicles)


def test_missions_api_accepts_resolved_parallel_plan_and_preserves_ack_verification(crossing_return_plan, tmp_path) -> None:
    baseline, missions, _ = crossing_return_plan
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    runtime.config = baseline.config
    runtime.vehicles = baseline.vehicles
    runtime.session_id = "parallel-session"
    runtime.require_ground = Mock()
    runtime.close = Mock()
    for vehicle in runtime.vehicles:
        vehicle.missions = SimpleNamespace(upload=Mock(return_value={"accepted": True, "verified": True}))
    runtime.snapshot = lambda: {"status": runtime.status, "missionPlanId": runtime.plan_id, "missionReceipts": runtime.receipts}
    with TestClient(create_swarm_app(runtime)) as client:
        response = client.post("/api/swarm/missions", json={"sessionId": "parallel-session", "planId": "parallel-plan", "missions": missions})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["missionPlanId"] == "parallel-plan"
    assert len(data["missionReceipts"]) == 2
    assert all(receipt["status"] == "ACCEPTED" and receipt["planId"] == "parallel-plan" for receipt in data["missionReceipts"])
    assert runtime.plan == missions, "避让不得静默篡改已上传的航点和任务编号"
    for vehicle in runtime.vehicles:
        assert vehicle.missions.upload.call_args.kwargs == {"verify": True}
    assert any("保持多机并行" in event for event in runtime.events)


@pytest.mark.parametrize("action", ["pause", "return"])
def test_parallel_landing_is_not_interrupted_by_peer_pause_or_return(action, monkeypatch) -> None:
    runtime = object.__new__(SwarmSitlRuntime)
    runtime.config = {"speed": 7}
    runtime._cancel = threading.Event()
    runtime.return_requested = set()
    runtime.paused = False
    runtime._returning = False
    runtime._check_motion = lambda: None
    runtime._corridor_free = lambda *args: True
    runtime._record = lambda *args: None
    runtime.event = lambda *args: None
    targets = []
    landing = set()
    vehicles = []
    for index in range(2):
        vehicle = SimpleNamespace(drone_id=f"UAV-0{index + 1}", phase="RUNNING", position=[index, 0])
        vehicle.state = SimpleNamespace(is_online=lambda: True, vehicle_value=lambda name: True,
                                       telemetry_value=lambda name: 0)
        vehicles.append(vehicle)
    runtime.vehicles = vehicles
    runtime._position = lambda vehicle: vehicle.position
    def target(vehicle, point):
        assert vehicle.drone_id not in landing, "暂停/返航不能覆盖另一架已开始执行的 LAND"
        targets.append((vehicle, point))
    runtime._target = target
    def on_complete(vehicle):
        if vehicle is vehicles[0]:
            landing.add(vehicle.drone_id)
            if action == "pause":
                runtime.paused = True
            else:
                runtime.return_requested.update(v.drone_id for v in vehicles)
    def return_pending():
        assert runtime.return_requested == {"UAV-02"}, "正在降落的飞机不应重复规划返航"
        runtime.return_requested.clear()
        vehicles[1].phase = "LANDED"
    runtime._return_pending = return_pending
    ticks = 0
    def advance(seconds):
        nonlocal ticks
        ticks += 1
        assert ticks < 10
        assert vehicles[0].phase == "HOLDING", "独立降落不得被同伴暂停改写为 PAUSED"
        if runtime.paused and ticks >= 2:
            assert vehicles[1].phase == "PAUSED", "同伴仍需正常暂停"
            runtime.paused = False
        for vehicle, point in targets:
            vehicle.position = point
        targets.clear()
    monkeypatch.setattr("muva_gateway.swarm_sitl.time.sleep", advance)
    runtime._move_many({"UAV-01": [[0, 0]], "UAV-02": [[1, .0001], [1, .0002]]}, on_complete=on_complete)
    assert vehicles[0].drone_id in landing
    assert not runtime.return_requested


@pytest.mark.parametrize("wait_kind", ["ack", "altitude", "landing"])
def test_abort_wakes_flight_confirmation_waits_without_recovery_commands(monkeypatch, tmp_path, wait_kind) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    runtime.session_id = "cancel-wait"
    runtime.status = "TAKING_OFF" if wait_kind != "landing" else "RETURNING"
    state = SwarmVehicleState()
    entered = threading.Event()
    commands = SimpleNamespace(set_mode=Mock())
    runtime.vehicles = [SimpleNamespace(state=state, commands=commands)]
    monkeypatch.setattr(runtime, "_close_vehicles", lambda: runtime.vehicles.clear())
    monkeypatch.setattr(runtime, "_stop_gazebo", lambda: None)
    monkeypatch.setattr(runtime, "_target", Mock())

    def operation():
        def not_confirmed():
            entered.set()
            return None
        if wait_kind == "ack":
            # wait_for_ack uses the same overridden wait_for path as actual commands.
            original = state.wait_for
            state.wait_for = lambda predicate, timeout: original(not_confirmed, timeout)
            state.wait_for_ack(400, 0, 100)
        else:
            state.wait_for(not_confirmed, 100)

    worker = threading.Thread(target=runtime._run, args=(operation,), daemon=True)
    runtime._worker = worker
    try:
        worker.start()
        assert entered.wait(2)
        runtime.abort_simulation("cancel-wait", True)
        assert not worker.is_alive()
        assert runtime.session_id is None
        assert runtime.status == "ABORTED"
        assert not any("飞控执行失败" in event for event in runtime.events)
        commands.set_mode.assert_not_called()
        runtime._target.assert_not_called()
    finally:
        state.cancel_waits()
        worker.join(timeout=2)
        runtime.close()


def test_abort_repeat_is_idempotent_but_does_not_reclaim_a_replacement_session(tmp_path) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    runtime.session_id = "original"
    try:
        with TestClient(create_swarm_app(runtime)) as client:
            body = {"sessionId": "original", "confirmed": True}
            assert client.post("/api/swarm/abort-simulation", json=body).json() == {"aborted": True, "landed": False}
            assert client.post("/api/swarm/abort-simulation", json=body).status_code == 200
            runtime.session_id = "replacement"
            assert client.post("/api/swarm/abort-simulation", json=body).status_code == 409
            assert runtime.session_id == "replacement"
    finally:
        runtime.close()


def test_abort_wakes_all_parallel_rtl_landing_waits(tmp_path) -> None:
    runtime = SwarmSitlRuntime(state_dir=tmp_path)
    runtime._stop.set()
    runtime._monitor.join(timeout=2)
    runtime.session_id = "parallel-rtl-abort"
    entered = [threading.Event() for _ in range(3)]
    for index in range(3):
        state = SwarmVehicleState()
        state.is_online = lambda: True
        state._vehicle.update(armed=True)
        state._telemetry.update(longitude=116.3 + index * .001, latitude=40, altitude=30)
        original_wait = state.wait_for
        def wait(predicate, timeout, entered=entered[index], original_wait=original_wait):
            entered.set()
            return original_wait(predicate, timeout)
        state.wait_for = wait
        runtime.vehicles.append(SimpleNamespace(drone_id=f"UAV-0{index + 1}", state=state,
            home=[116.3 + index * .001, 40], phase="HOLDING", returning=[], console=None,
            commands=SimpleNamespace(rtl=Mock(), set_mode=Mock())))
    runtime.return_requested = {vehicle.drone_id for vehicle in runtime.vehicles}
    runtime._target = Mock()
    runtime._close_vehicles = lambda: runtime.vehicles.clear()
    runtime._stop_gazebo = lambda: None
    worker = threading.Thread(target=runtime._run, args=(runtime._return_pending,), daemon=True)
    runtime._worker = worker
    states = [vehicle.state for vehicle in runtime.vehicles]
    commands = [vehicle.commands for vehicle in runtime.vehicles]
    try:
        worker.start()
        assert all(event.wait(2) for event in entered)
        runtime.abort_simulation("parallel-rtl-abort", True)
        assert not worker.is_alive()
        assert runtime.session_id is None
        assert runtime.status == "ABORTED"
        assert not any("飞控执行失败" in event for event in runtime.events)
        for command in commands:
            command.rtl.assert_called_once()
            command.set_mode.assert_not_called()
    finally:
        for state in states:
            state.cancel_waits()
        worker.join(timeout=2)
        runtime.close()
