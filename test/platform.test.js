'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { QingpingPlatform } = require('../src/platform');

function platform(config = {}) {
  const instance = Object.create(QingpingPlatform.prototype);
  instance.config = config;
  instance.services = new Map();
  instance.log = { debug() {} };
  return instance;
}

test('enables standard measurements when configuration omits their flags', () => {
  const instance = platform();

  assert.equal(instance.isMeasurementEnabled('temperature'), true);
  assert.equal(instance.isMeasurementEnabled('humidity'), true);
  assert.equal(instance.isMeasurementEnabled('co2'), true);
  assert.equal(instance.isMeasurementEnabled('pm25'), true);
  assert.equal(instance.isMeasurementEnabled('pm10'), true);
  assert.equal(instance.isMeasurementEnabled('tvoc'), true);
  assert.equal(instance.isMeasurementEnabled('battery'), true);
  assert.equal(instance.isMeasurementEnabled('noise'), false);
});

test('honors explicitly disabled measurements', () => {
  const instance = platform({ temperature: false, pm25: false });

  assert.equal(instance.isMeasurementEnabled('temperature'), false);
  assert.equal(instance.isMeasurementEnabled('pm25'), false);
});

test('accepts valid zero-valued readings', () => {
  const instance = platform();
  let received;

  instance.updateNumber('noise', { value: 0, status: 0 }, (value) => {
    received = value;
  });

  assert.equal(received, undefined);

  instance.config.noise = true;
  instance.updateNumber('noise', { value: 0, status: 0 }, (value) => {
    received = value;
  });

  assert.equal(received, 0);
});

test('matches MAC addresses regardless of separators or case', () => {
  const instance = platform();

  assert.equal(instance.normalizeMac('58:2d:34-70 56:c8'), '582D347056C8');
  assert.equal(instance.maskMac('58:2d:34-70 56:c8'), '****56C8');
});

test('caches a Qingping Cloud OAuth token until it expires', async (t) => {
  const instance = platform({ appKey: 'app-key', appSecret: 'app-secret' });
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      text: async () => JSON.stringify({ access_token: 'token', expires_in: 7200 }),
    };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  assert.equal(await instance.getAccessToken(), 'token');
  assert.equal(await instance.getAccessToken(), 'token');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.headers.Authorization, 'Basic YXBwLWtleTphcHAtc2VjcmV0');
});

test('uses the HAP Battery service available in Homebridge', () => {
  const source = require('node:fs').readFileSync(
    require.resolve('../src/platform'),
    'utf8'
  );

  assert.match(source, /Service\.Battery/);
  assert.doesNotMatch(source, /Service\.BatteryService/);
});
