import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlannedRouteLayer } from '../src/experiments/collaboration/components/PlannedRouteLayer';
import type { AircraftRoute } from '../src/types/collaboration';

const p = (x: number, y: number) => ({ x, y, z: 18 });
const route: AircraftRoute = {
  droneId: 'uav101', role: '领航机', workStart: 1, length: 300, estimatedSeconds: 60, stationSeconds: 0, order: 0,
  // Home, then a two-lane serpentine.
  waypoints: [p(-10, 5), p(-60, 0), p(60, 0), p(60, 20), p(-60, 20)],
};
const render = (over: Partial<Parameters<typeof PlannedRouteLayer>[0]> = {}) => renderToStaticMarkup(
  <svg><PlannedRouteLayer route={route} color="#4dc7ff" selected={false} opacity={1} unit={.1} showRoute showPoints labelEvery={1} {...over} /></svg>);

test('a planned sortie draws entry, work and return legs, each with its own geometry', () => {
  const html = render();
  assert.match(html, /data-route-leg="entry"[^>]*points="-10,-5 -60,0"/);
  assert.match(html, /data-route-leg="work"[^>]*points="-60,0 60,0 60,-20 -60,-20"/);
  // Return runs from the last work waypoint straight back to Home.
  assert.match(html, /data-route-leg="return"[^>]*points="-60,-20 -10,-5"/);
  assert.equal(/data-planned-return="uav101"/.test(html), true);
});
test('work legs carry direction arrows; every work waypoint is numbered when labelEvery is 1', () => {
  const html = render();
  assert.ok((html.match(/<polygon/g) ?? []).length >= 3, 'arrowheads on entry, work and return legs');
  assert.equal((html.match(/data-generated-waypoint="uav101"/g) ?? []).length, 4);
  for (const n of ['>1<', '>2<', '>3<', '>4<']) assert.ok(html.includes(n), `label ${n}`);
});
test('hiding routes keeps waypoints, and hiding waypoints keeps routes', () => {
  assert.equal(render({ showRoute: false }).includes('data-route-leg'), false);
  assert.equal(render({ showRoute: false }).includes('data-generated-waypoint'), true);
  assert.equal(render({ showPoints: false }).includes('data-generated-waypoint'), false);
  assert.equal(render({ showPoints: false }).includes('data-route-leg="work"'), true);
});
test('a degenerate route renders nothing instead of throwing', () => {
  assert.equal(renderToStaticMarkup(<svg><PlannedRouteLayer route={{ ...route, waypoints: [p(0, 0)] }} color="#fff" selected opacity={1} unit={.1} showRoute showPoints labelEvery={1} /></svg>), '<svg></svg>');
});
