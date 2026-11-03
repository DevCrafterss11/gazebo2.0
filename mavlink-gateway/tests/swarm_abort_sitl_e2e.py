"""Opt-in real, isolated Gazebo/SITL airborne-reclaim acceptance test.

MUVA_RUN_SWARM_ABORT_E2E=1 PYTHONPATH=.packages:. python3 tests/swarm_abort_sitl_e2e.py
Only the processes created by this test runtime are reclaimed (never real hardware).
"""
from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path

from fastapi.testclient import TestClient

from muva_gateway.swarm_app import create_swarm_app
from muva_gateway.swarm_sitl import SwarmSitlRuntime, metres


def group_members(groups: set[int]) -> list[int]:
    members = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            # /proc/PID/stat's command may contain spaces or parentheses.
            stat = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            if int(stat[2]) in groups and stat[0] != 'Z':
                members.append(int(entry.name))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return sorted(members)


def owned_groups(roots: set[int]) -> set[int]:
    # Gazebo's launcher starts server/GUI in separate process groups.
    # Capture its full descendant tree before abort, not only the launcher PGID.
    parents: dict[int, tuple[int, int]] = {}
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            stat = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            parents[int(entry.name)] = (int(stat[1]), int(stat[2]))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    descendants = set(roots)
    while True:
        found = {pid for pid, (parent, _group) in parents.items() if parent in descendants}
        if found <= descendants:
            break
        descendants.update(found)
    return roots | {group for pid, (_parent, group) in parents.items() if pid in descendants}


def main() -> None:
    if os.getenv('MUVA_RUN_SWARM_ABORT_E2E') != '1':
        raise SystemExit('Set MUVA_RUN_SWARM_ABORT_E2E=1 to arm isolated simulated aircraft')
    os.environ['MUVA_SWARM_SITL_BASE_PORT'] = '16960'
    os.environ['MUVA_SWARM_FDM_BASE_PORT'] = '19402'
    directory = Path(os.getenv('MUVA_SWARM_ABORT_E2E_DIR') or tempfile.mkdtemp(prefix='muva-abort-e2e-'))
    directory.mkdir(parents=True, exist_ok=True)
    runtime = SwarmSitlRuntime(state_dir=directory)
    reports: list[dict] = []
    print(f'Isolated test logs: {directory}', flush=True)
    config = {'count': 2, 'altitude': 10, 'speed': 5, 'spacing': 10, 'safety': 3,
              'sceneOrigin': [116.3268, 40.0098]}
    with TestClient(create_swarm_app(runtime)) as client:
        def post(path: str, payload: dict) -> dict:
            response = client.post(f'/api/swarm/{path}', json=payload)
            assert response.is_success, (path, response.status_code, response.text)
            return response.json()

        def wait(session_id: str, predicate, timeout: float = 180) -> dict:
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                response = client.get('/api/swarm/status', params={'sessionId': session_id})
                response.raise_for_status()
                snapshot = response.json()
                assert snapshot['status'] != 'FAILED', snapshot['runtime']['error']
                if predicate(snapshot):
                    return snapshot
                time.sleep(.2)
            raise AssertionError(f'Timed out: {snapshot}')

        previous_session = None
        for scenario in ('mission-flight', 'takeoff-in-progress'):
            print(f'Initializing: {scenario}', flush=True)
            initialized = post('configure', {'config': config})
            session_id = initialized['runtime']['sessionId']
            assert session_id and session_id != previous_session
            if previous_session:
                stale = client.post('/api/swarm/abort-simulation', json={'sessionId': previous_session, 'confirmed': True})
                assert stale.status_code == 409
                assert client.get('/api/swarm/health').json()['sessionId'] == session_id
            missions = []
            for drone in initialized['drones']:
                home = drone['homePosition']
                route = [home, [home[0], home[1] + 20 / 110540], [home[0], home[1] + 40 / 110540]]
                missions.append({'droneId': drone['droneId'], 'missionId': f"{scenario}-{drone['droneId']}",
                                 'assignedArea': 400, 'waypoints': route, 'entryPath': [home],
                                 'returnPath': list(reversed(route)), 'routingObstacles': [],
                                 'coverageStartIndex': 0, 'coverageWaypointIndices': [1, 2],
                                 'coverageSegments': [[route[0], route[1]], [route[1], route[2]]]})
            post('missions', {'sessionId': session_id, 'planId': f'abort-{scenario}', 'missions': missions})
            # Allow simulated IMUs to settle after startup; do not bypass ArduPilot pre-arm checks.
            time.sleep(20)
            post('command', {'sessionId': session_id, 'action': 'ready'})
            post('command', {'sessionId': session_id, 'action': 'takeoff'})
            if scenario == 'mission-flight':
                wait(session_id, lambda s: s['status'] == 'HOLDING' and all(d['armed'] and d['altitude'] >= 8 for d in s['drones']))
                post('command', {'sessionId': session_id, 'action': 'startMission'})
                snapshot = wait(session_id, lambda s: s['status'] == 'RUNNING' and all(
                    d['armed'] and d['altitude'] >= 8 and metres(d['position'], d['homePosition']) > 2 for d in s['drones']))
            else:
                snapshot = wait(session_id, lambda s: s['status'] == 'TAKING_OFF' and any(
                    d['armed'] and d['altitude'] > 1 for d in s['drones']))
            groups = {v.process.pid for v in runtime.vehicles}
            groups.update(v.monitor_process.pid for v in runtime.vehicles if v.monitor_process)
            assert runtime.gazebo is not None
            groups.add(runtime.gazebo.pid)
            groups = owned_groups(groups)
            worker = runtime._worker
            processes = [v.process for v in runtime.vehicles] + [runtime.gazebo]
            transports = [v.transport for v in runtime.vehicles]
            report = {'scenario': scenario, 'sessionId': session_id, 'before': snapshot,
                      'processGroups': sorted(groups), 'processesBefore': group_members(groups)}
            (directory / f'{scenario}-before.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
            print(f"Aborting {snapshot['status']}: " + str([(d['droneId'], d['armed'], d['altitude']) for d in snapshot['drones']]), flush=True)
            started = time.monotonic()
            result = post('abort-simulation', {'sessionId': session_id, 'confirmed': True})
            report.update(abort=result, elapsedSeconds=round(time.monotonic() - started, 3))
            deadline = time.monotonic() + 5
            while group_members(groups) and time.monotonic() < deadline:
                time.sleep(.1)
            report.update(remainingProcesses=group_members(groups), health=client.get('/api/swarm/health').json(),
                          workerAlive=bool(worker and worker.is_alive()), returnCodes=[p.poll() for p in processes])
            report['portsReleased'] = all(runtime._port_available(16960 + i * 20, True)
                                         and runtime._port_available(19402 + i * 10, False) for i in range(2))
            report['transportThreadsStopped'] = all(not t._thread or not t._thread.is_alive() for t in transports)
            reports.append(report)
            (directory / 'report.json').write_text(json.dumps(reports, ensure_ascii=False, indent=2))
            assert result == {'aborted': True, 'landed': False}
            assert report['remainingProcesses'] == [], report
            assert all(code is not None for code in report['returnCodes'])
            assert not report['workerAlive'] and report['transportThreadsStopped']
            assert report['portsReleased'] and not runtime.vehicles
            assert report['health']['sessionId'] is None and report['health']['gazebo'] is False
            assert client.get('/api/swarm/status', params={'sessionId': session_id}).status_code == 409
            post('abort-simulation', {'sessionId': session_id, 'confirmed': True})
            print(f"PASS {scenario}: reclaimed in {report['elapsedSeconds']}s; processes gone, ports free, repeat abort OK", flush=True)
            previous_session = session_id
    print('PASS: both real airborne reclaim scenarios and reinitialization', flush=True)


if __name__ == '__main__':
    main()
