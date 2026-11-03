import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { ApiSwarmService } from '../src/services/api/ApiSwarmService';
import type { SwarmSnapshot } from '../src/types/swarm';

type Reply = { data: unknown; status: number; statusText: string; headers: Record<string, string>; config: InternalAxiosRequestConfig };

const groundedSnapshot = (connected = true, armed = false, altitude = 0.1): SwarmSnapshot => ({
  status: 'COMPLETED', elapsed: 0, events: [], coverage: 100,
  drones: [{ droneId: 'uav-1', connected, armed, altitude } as SwarmSnapshot['drones'][number]],
});

const withAdapter = async (
  respond: (config: InternalAxiosRequestConfig) => unknown,
  run: (service: ApiSwarmService, requests: string[]) => Promise<void>,
) => {
  const service = new ApiSwarmService();
  const client = (service as unknown as { client: AxiosInstance }).client;
  const requests: string[] = [];
  client.defaults.adapter = async config => {
    requests.push(`${config.method?.toUpperCase()} ${config.url}`);
    const data = await respond(config);
    const reply: Reply = { data, status: 200, statusText: 'OK', headers: {}, config };
    return reply;
  };
  try { await run(service, requests); }
  finally { service.dispose(); }
};

test('stale local session with no backend session clears locally without shutdown request', async () => {
  await withAdapter(config => config.url === '/health' ? { sessionId: null } : null, async (service, requests) => {
    await service.shutdown('expired-session');
    assert.deepEqual(requests, ['GET /health']);
  });
});

test('session mismatch closes backend session only after confirming whole fleet grounded', async () => {
  await withAdapter(config => {
    if (config.url === '/health') return { sessionId: 'active-session' };
    if (config.url === '/status') return groundedSnapshot();
    return { stopped: true };
  }, async (_service, requests) => {
    await _service.shutdown('expired-session');
    assert.deepEqual(requests, ['GET /health', 'GET /status', 'POST /shutdown']);
  });
});

test('session mismatch never shuts down when telemetry cannot confirm a grounded fleet', async () => {
  await withAdapter(config => {
    if (config.url === '/health') return { sessionId: 'active-session' };
    if (config.url === '/status') return groundedSnapshot(false, false, 0.1);
    return { stopped: true };
  }, async (service, requests) => {
    await assert.rejects(service.shutdown('expired-session'), /无法确认全部飞控在线、上锁并落地/);
    assert.deepEqual(requests, ['GET /health', 'GET /status']);
  });
});

test('explicit simulation abort only calls the SITL abort endpoint for the active backend session', async () => {
  await withAdapter(config => config.url === '/health' ? { sessionId: 'active-session' } : { aborted: true, landed: false }, async (service, requests) => {
    await service.abortSimulation('stale-local-session');
    assert.deepEqual(requests, ['GET /health', 'POST /abort-simulation']);
  });
});


test('abort reconciles a lost response only when health confirms the session and Gazebo stopped', async () => {
  let reads = 0;
  await withAdapter(config => {
    if (config.url === '/health') return ++reads === 1 ? { sessionId: 'active' } : { sessionId: null, gazebo: false };
    throw new Error('response lost');
  }, async (service, requests) => {
    await service.abortSimulation('active');
    assert.deepEqual(requests, ['GET /health', 'POST /abort-simulation', 'GET /health']);
  });
});

for (const health of [{ sessionId: 'active', gazebo: true }, { sessionId: 'replacement', gazebo: true }, { sessionId: null, gazebo: true }]) {
  test(`abort preserves failure when cleanup is not confirmed: ${JSON.stringify(health)}`, async () => {
    let reads = 0;
    await withAdapter(config => {
      if (config.url === '/health') return ++reads === 1 ? { sessionId: 'active' } : health;
      throw new Error('worker still stopping');
    }, async (service, requests) => {
      await assert.rejects(service.abortSimulation('active'), /worker still stopping/);
      assert.equal(requests.filter(item => item === 'POST /abort-simulation').length, 1);
    });
  });
}

test('intentional telemetry close during abort produces no false failure and clears stale local session', async () => {
  const original = globalThis.WebSocket;
  class Socket {
    static latest: Socket;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() { Socket.latest = this; }
    close() { this.onclose?.({ code: 1008 }); }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  const received: SwarmSnapshot[] = [];
  try {
    await withAdapter(config => {
      if (config.url === '/configure') return { ...groundedSnapshot(), runtime: { sessionId: 'local', connected: true, mode: 'sitl', label: 'SITL' } };
      if (config.url === '/health') return { sessionId: 'backend' };
      Socket.latest.onmessage?.({ data: JSON.stringify({ ...groundedSnapshot(), status: 'ABORTED', runtime: { sessionId: 'backend', error: 'operator aborted' } }) });
      Socket.latest.onerror?.();
      Socket.latest.close();
      return { aborted: true, landed: false };
    }, async service => {
      service.subscribeTelemetry(snapshot => received.push(snapshot));
      await service.initialize({ count: 2, altitude: 30, speed: 7, spacing: 12, safety: 3, sceneId: 'campus-training', simulationMode: 'sitl', worldFrame: 'ENU', sceneOrigin: [116.3268, 40.0098] });
      await service.abortSimulation('stale');
      assert.equal(received.length, 1);
      const internals = service as unknown as { sessionId: string | null; socket: unknown };
      assert.equal(internals.sessionId, null);
      assert.equal(internals.socket, null);
    });
  } finally { globalThis.WebSocket = original; }
});

test('实验二 Store：新建清理、并行 RTL 收尾和手动回收失败均保留正确进度', async (t) => {
  const { services } = await import('../src/services/serviceRegistry');
  const { MockSwarmRuntime } = await import('../src/services/mock/MockSwarmRuntime');
  const values = new Map<string, string>();
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  const originalService = services.swarm;
  const service = new ApiSwarmService();
  services.swarm = service;
  const { useSwarmStore } = await import('../src/stores/swarmStore');
  const client = (service as unknown as { client: AxiosInstance }).client;
  const requests: string[] = [];
  let failing = false;
  let backendSession: string | null = 'store-session';
  client.defaults.adapter = async config => {
    requests.push(`${config.method?.toUpperCase()} ${config.url}`);
    if (failing) throw new Error('test backend unavailable');
    const data = config.url === '/health' ? { sessionId: backendSession }
      : config.url === '/command' ? { ...service.getStatus(), status: 'RETURNING' }
      : { ok: true };
    if (config.url === '/abort-simulation' || config.url === '/shutdown') backendSession = null;
    return { config, data, status: 200, statusText: 'OK', headers: {} };
  };
  const createRun = () => {
    useSwarmStore.setState({ busy: false, error: null, run: null, savedDrafts: [] });
    useSwarmStore.getState().newRun();
    const run = useSwarmStore.getState().run!;
    const mock = new MockSwarmRuntime();
    const snapshot = mock.initialize(run.config);
    mock.dispose();
    return { ...run, config: { ...run.config, simulationMode: 'sitl' as const }, step: 5,
      snapshot: { ...snapshot, status: 'HOLDING' as const,
        runtime: { sessionId: 'store-session', mode: 'sitl' as const, label: 'test SITL', connected: true },
        drones: snapshot.drones.map(drone => ({ ...drone, connected: true, armed: true, altitude: 30, state: 'HOLDING' as const })) } };
  };
  try {
    await t.test('新建前回收，仅归档未完成的实验为中断记录', async () => {
      const run = createRun();
      useSwarmStore.setState({ run });
      requests.length = 0; backendSession = 'store-session';
      await useSwarmStore.getState().abortRuntimeAndNewRun();
      assert.deepEqual(requests, ['GET /health', 'POST /abort-simulation']);
      assert.notEqual(useSwarmStore.getState().run!.id, run.id);
      assert.equal(useSwarmStore.getState().run!.step, 1);
      assert.equal(useSwarmStore.getState().savedDrafts[0]!.snapshot!.interrupted, true);
    });
    await t.test('回收失败不创建新实验，原进度可再次手动回收', async () => {
      const run = createRun(); useSwarmStore.setState({ run });
      failing = true;
      await useSwarmStore.getState().abortRuntimeAndNewRun();
      assert.equal(useSwarmStore.getState().run!.id, run.id);
      assert.equal(useSwarmStore.getState().busy, false);
      assert.match(useSwarmStore.getState().error!, /原实验进度已保留/);
      failing = false;
    });
    await t.test('结束实验先下发一次集群 RTL，未落地不关闭环境', async () => {
      const run = createRun(); useSwarmStore.setState({ run });
      // Establish only the API session, without starting a socket or simulator.
      (service as unknown as { sessionId: string | null }).sessionId = 'store-session';
      requests.length = 0; backendSession = 'store-session';
      await useSwarmStore.getState().finish();
      await new Promise(resolve => setTimeout(resolve, 0));
      assert.deepEqual(requests, ['POST /command']);
      assert.equal(useSwarmStore.getState().run!.result, null);
    });
    await t.test('确认落地后清理且只生成一次结果，保留最终轨迹', async () => {
      const run = createRun();
      run.snapshot.status = 'COMPLETED';
      run.snapshot.drones = run.snapshot.drones.map(drone => ({ ...drone, armed: false, altitude: 0, state: 'LANDED' }));
      useSwarmStore.setState({ run });
      requests.length = 0; backendSession = 'store-session';
      await useSwarmStore.getState().finish();
      await useSwarmStore.getState().finish();
      assert.deepEqual(requests, ['GET /health', 'POST /shutdown']);
      const finished = useSwarmStore.getState().run!;
      assert.ok(finished.result);
      assert.deepEqual(finished.snapshot!.drones, run.snapshot.drones);
      assert.equal(finished.snapshot!.runtime!.sessionId, null);
      assert.equal(finished.snapshot!.runtime!.connected, false);
      assert.equal(useSwarmStore.getState().busy, false);
    });
    await t.test('收尾清理失败保留结果并提示手动回收', async () => {
      const run = createRun();
      run.snapshot.status = 'COMPLETED';
      run.snapshot.drones = run.snapshot.drones.map(drone => ({ ...drone, armed: false, altitude: 0, state: 'LANDED' }));
      useSwarmStore.setState({ run }); failing = true;
      await useSwarmStore.getState().finish();
      assert.ok(useSwarmStore.getState().run!.result);
      assert.match(useSwarmStore.getState().error!, /中止并回收 SITL/);
      assert.equal(useSwarmStore.getState().busy, false);
      failing = false;
    });
  } finally {
    service.dispose(); services.swarm = originalService;
    if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
