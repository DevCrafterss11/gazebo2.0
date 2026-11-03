import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attackLabels, defaultAttackConfig, parseBasicAttackConfig, parseWaypoints, resolveDroneAttackConfig, validateAttackConfig } from '../src/domain/basicAttackConfig';
import type { AttackType } from '../src/types/security';

test('all five configurations round-trip and reject invalid persisted types', () => {
  for (const type of Object.keys(attackLabels) as AttackType[]) {
    const config = defaultAttackConfig(type);
    assert.deepEqual(validateAttackConfig(config), {});
    assert.deepEqual(parseBasicAttackConfig(JSON.parse(JSON.stringify(config))), config);
    assert.equal(parseBasicAttackConfig({ ...config, values: { ...config.values, duration: '60' } }), null);
  }
  assert.equal(parseBasicAttackConfig({ attackType: '__proto__' }), null);
  assert.equal(parseBasicAttackConfig(null), null);
});
test('GPS path and bounds validation catches malformed points and invalid constraints', () => {
  for (const value of ['1,2,3', '0,0,0\n,1,2', '0,0,0\nNaN,1,2', '0,0,0\n1,Infinity,2', '0,0,0\n20000,0,0']) assert.equal(parseWaypoints(value), null);
  assert.deepEqual(parseWaypoints('0,0,0\n25,10,5'), [[0, 0, 0], [25, 10, 5]]);
  const config = defaultAttackConfig('GPS_SPOOFING');
  config.values = { ...config.values, mode: 'path', waypoints: '0,0,0\n300,0,0' };
  assert.ok(validateAttackConfig(config).waypoints);
  config.values = { ...config.values, mode: 'gradual', ramp: 90, latitude: 91, maxAltitude: 10 };
  const errors = validateAttackConfig(config);
  assert.ok(errors.ramp && errors.latitude && errors.altitude);
  config.values.mode = 'static';
  assert.equal(validateAttackConfig(config).ramp, undefined);
});
test('blank numeric values, invalid targets and battery thresholds cannot be saved', () => {
  const config = defaultAttackConfig('BATTERY_DRAIN');
  config.values = { ...config.values, duration: NaN, stopBattery: 40, seed: 1.5 };
  config.targetDroneIds = ['uav999'];
  const errors = validateAttackConfig(config, ['uav101']);
  assert.ok(errors.duration && errors.stopBattery && errors.seed && errors.targets);
});
test('creating or editing one config cannot mutate another config or its defaults', () => {
  const a = defaultAttackConfig('GPS_SPOOFING');
  const b = defaultAttackConfig('GPS_SPOOFING');
  a.values.offsetX = 99; a.targetDroneIds.push('uav101');
  assert.equal(b.values.offsetX, 10); assert.deepEqual(b.targetDroneIds, []);
  const parsed = parseBasicAttackConfig(a);
  assert.ok(parsed);
  parsed.values.offsetX = 50; parsed.targetDroneIds.push('uav102');
  assert.equal(a.values.offsetX, 99); assert.deepEqual(a.targetDroneIds, ['uav101']);
});


test('per-drone parameters round-trip independently and legacy presets keep their values', () => {
  const config = defaultAttackConfig('GPS_SPOOFING');
  config.targetDroneIds = ['uav101', 'uav104'];
  config.values.offsetX = 33;
  assert.equal(resolveDroneAttackConfig(parseBasicAttackConfig(config)!, 'uav104').values.offsetX, 33);
  config.droneConfigs = {
    uav101: { severity: 'high', values: { ...config.values, offsetX: -20, duration: 8 } },
    uav104: { severity: 'low', values: { ...config.values, mode: 'gradual', offsetX: 40, ramp: 3, delay: 4 } },
  };
  const parsed = parseBasicAttackConfig(JSON.parse(JSON.stringify(config)))!;
  assert.deepEqual(parsed, config);
  const first = resolveDroneAttackConfig(parsed, 'uav101');
  assert.equal(first.values.offsetX, -20); assert.equal(first.severity, 'high');
  assert.deepEqual(first.targetDroneIds, ['uav101']); assert.equal(first.droneConfigs, undefined);
  first.values.offsetX = 99;
  assert.equal(parsed.droneConfigs!.uav101!.values.offsetX, -20);
  assert.equal(resolveDroneAttackConfig(parsed, 'uav104').values.offsetX, 40);
});

test('invalid parameters on any selected drone block the entire configuration', () => {
  const config = defaultAttackConfig('GPS_SPOOFING');
  config.targetDroneIds = ['uav101', 'uav104'];
  config.droneConfigs = { uav104: { severity: 'high', values: { ...config.values, mode: 'gradual', ramp: 90 } } };
  assert.ok(validateAttackConfig(config)['drone:uav104:ramp']);
  assert.equal(parseBasicAttackConfig(config), null);
  config.droneConfigs.uav104!.values.ramp = 5;
  assert.deepEqual(validateAttackConfig(config), {});
  assert.equal(parseBasicAttackConfig({ ...config, droneConfigs: { uav104: { severity: 'extreme', values: config.values } } }), null);
  assert.equal(parseBasicAttackConfig({ ...config, droneConfigs: [] }), null);
  config.targetDroneIds = ['uav101'];
  assert.deepEqual(parseBasicAttackConfig(config)!.droneConfigs, {});
  config.targetDroneIds = Array.from({ length: 120 }, (_, i) => `uav${i}`);
  assert.equal(parseBasicAttackConfig(config)!.targetDroneIds.length, 120);
});
