'use strict'

const PLUGIN_NAME = 'homebridge-qingping-cgs2';
const MANUFACTURER = 'Qingping';
const MODEL = 'CGS2';
const OAUTH_URL = 'https://oauth.cleargrass.com/oauth2/token';
const DEVICES_URL = 'https://apis.cleargrass.com/v1/apis/devices';
const MEASUREMENT_DEFAULTS = Object.freeze({
  temperature: true,
  humidity: true,
  co2: true,
  pm25: true,
  pm10: true,
  tvoc: true,
  noise: false,
  battery: true,
});

class QingpingPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.accessories = [];
    this.services = new Map();
    this.accessToken = undefined;
    this.accessTokenExpiresAt = 0;
    this.pollTimer = undefined;

    this.api.on('didFinishLaunching', () => {
      this.discoverDevice();
    });

    this.api.on('shutdown', () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
      }
    });
  }

  configureAccessory(accessory) {
    this.accessories.push(accessory);
  }

  discoverDevice() {
    const name = this.config.homeKitName || this.config.name || 'Qingping Air Monitor 2';

    let accessory = this.accessories.find((a) => a.displayName === name);

    if (!accessory) {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${name}`);
      accessory = new this.api.platformAccessory(name, uuid);
      this.log.info(`Adding ${name}`);
    } else {
      this.log.info(`Restoring ${name}`);
    }

    this.mainAccessory = accessory;
    this.setupInformationService(accessory);
    this.setupMeasurementServices(accessory);
    this.startPolling();

    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
  }

  setupInformationService(accessory) {
    const { Service, Characteristic } = this.api.hap;

    const info =
      accessory.getService(Service.AccessoryInformation) ||
      accessory.addService(Service.AccessoryInformation);

    info.setCharacteristic(Characteristic.Manufacturer, MANUFACTURER);
    info.setCharacteristic(Characteristic.Model, MODEL);
    info.setCharacteristic(Characteristic.Name, accessory.displayName);
  }

  setupMeasurementServices(accessory) {
    const { Service, Characteristic, UUID } = this.api.hap;
    this.services.clear();

    if (this.isMeasurementEnabled('temperature')) {
      const service =
        accessory.getService(Service.TemperatureSensor) ||
        accessory.addService(Service.TemperatureSensor, 'Temperature', 'temperature');

      service.setCharacteristic(Characteristic.Name, 'Temperature');
      this.services.set('temperature', service);
    } else {
      this.removeService(accessory, Service.TemperatureSensor);
    }

    if (this.isMeasurementEnabled('humidity')) {
      const service =
        accessory.getService(Service.HumiditySensor) ||
        accessory.addService(Service.HumiditySensor, 'Humidity', 'humidity');

      service.setCharacteristic(Characteristic.Name, 'Humidity');
      this.services.set('humidity', service);
    } else {
      this.removeService(accessory, Service.HumiditySensor);
    }

    if (this.isMeasurementEnabled('co2')) {
      const service =
        accessory.getService(Service.CarbonDioxideSensor) ||
        accessory.addService(Service.CarbonDioxideSensor, 'CO₂', 'co2');

      service.setCharacteristic(Characteristic.Name, 'CO₂');
      this.services.set('co2', service);
    } else {
      this.removeService(accessory, Service.CarbonDioxideSensor);
    }

    if (
      this.isMeasurementEnabled('pm25') ||
      this.isMeasurementEnabled('pm10') ||
      this.isMeasurementEnabled('tvoc')
    ) {
      const service =
        accessory.getService(Service.AirQualitySensor) ||
        accessory.addService(Service.AirQualitySensor, 'Air Quality', 'air_quality');

      service.setCharacteristic(Characteristic.Name, 'Air Quality');

      this.services.set('air_quality', service);
    } else {
      this.removeService(accessory, Service.AirQualitySensor);
    }

    if (this.isMeasurementEnabled('battery')) {
      const service =
        accessory.getService(Service.Battery) ||
        accessory.addService(Service.Battery, 'Battery', 'battery');

      service.setCharacteristic(Characteristic.Name, 'Battery');
      this.services.set('battery', service);
    } else {
      this.removeService(accessory, Service.Battery);
    }

    if (this.isMeasurementEnabled('noise')) {
      this.addNoiseService(accessory);
    } else {
      this.removeService(accessory, UUID.generate(`${PLUGIN_NAME}:NoiseService`));
    }

  }

  isMeasurementEnabled(key) {
    return this.config[key] === undefined
      ? MEASUREMENT_DEFAULTS[key]
      : this.config[key] !== false;
  }

  removeService(accessory, serviceType) {
    const service = accessory.getService(serviceType);

    if (service) {
      accessory.removeService(service);
    }
  }

  addNoiseService(accessory) {
    const { Service, Characteristic, UUID } = this.api.hap;

    const noiseServiceUUID = UUID.generate(`${PLUGIN_NAME}:NoiseService`);
    const noiseCharacteristicUUID = UUID.generate(`${PLUGIN_NAME}:NoiseLevel`);

    class NoiseLevelCharacteristic extends Characteristic {
      constructor() {
        super('Noise', noiseCharacteristicUUID);
        this.setProps({
          format: Characteristic.Formats.UINT16,
          unit: 'dB',
          minValue: 0,
          maxValue: 150,
          minStep: 1,
          perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
        });
        this.value = this.getDefaultValue();
      }
    }

    class NoiseService extends Service {
      constructor(displayName, subtype) {
        super(displayName, noiseServiceUUID, subtype);
        this.addOptionalCharacteristic(Characteristic.Name);
        this.addCharacteristic(NoiseLevelCharacteristic);
      }
    }

    const service =
      accessory.getService(noiseServiceUUID) ||
      accessory.addService(NoiseService, 'Noise', 'noise');

    this.services.set('noise', service);

    this.log.warn(
      'Noise uses a custom HomeKit characteristic. Apple Home may not display it; third-party HomeKit apps may.'
    );
  }

  startPolling() {
    if (!this.config.mac || !this.config.appKey || !this.config.appSecret) {
      this.log.error('Qingping Cloud requires mac, appKey, and appSecret.');
      return;
    }

    this.pollDevice();
    this.pollTimer = setInterval(() => this.pollDevice(), 60_000);
    this.pollTimer.unref();
  }

  async pollDevice() {
    try {
      const token = await this.getAccessToken();
      const timestamp = Date.now().toString();
      const response = await fetch(
        `${DEVICES_URL}?${new URLSearchParams({ timestamp, offset: '0', limit: '50' })}`,
        { headers: { Authorization: token } }
      );
      const data = await this.parseResponse(response, 'Qingping device query');
      const configuredMac = this.normalizeMac(this.config.mac);
      const device = data.devices?.find(
        (candidate) => this.normalizeMac(candidate.info?.mac) === configuredMac
      );

      if (!device) {
        this.log.error(`Qingping device ${this.maskMac(configuredMac)} was not found in this account.`);
        return;
      }

      if (device.info?.status?.offline) {
        this.log.warn(`Qingping device ${this.maskMac(configuredMac)} is offline.`);
      }

      this.updateMeasurements(device.data, device.info?.version);
    } catch (err) {
      this.log.error(`Qingping Cloud update failed: ${err.message}`);
    }
  }

  async getAccessToken() {
    if (this.accessToken && Date.now() < this.accessTokenExpiresAt) {
      return this.accessToken;
    }

    const credentials = Buffer.from(
      `${this.config.appKey}:${this.config.appSecret}`,
      'utf8'
    ).toString('base64');
    const response = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials&scope=device_full_access',
    });
    const data = await this.parseResponse(response, 'Qingping OAuth');

    if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in)) {
      throw new Error('Qingping OAuth response does not contain a usable access token.');
    }

    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = Date.now() + Math.max(1, data.expires_in - 60) * 1000;
    return this.accessToken;
  }

  async parseResponse(response, operation) {
    const body = await response.text();
    let data;

    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`${operation} returned invalid JSON (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      const detail = data.error_description || data.message || data.error || 'unknown error';
      throw new Error(`${operation} failed (HTTP ${response.status}): ${detail}`);
    }

    return data;
  }

  updateMeasurements(sample, firmwareVersion) {
    if (!sample) {
      this.log.warn('Qingping device response has no data.');
      return;
    }

    this.updateNumber('temperature', sample.temperature, (value) => this.setTemperature(value));
    this.updateNumber('humidity', sample.humidity, (value) => this.setHumidity(value));
    this.updateNumber('co2', sample.co2, (value) => this.setCo2(value));
    this.updateNumber('pm25', sample.pm25, (value) => this.setPm25(value));
    this.updateNumber('pm10', sample.pm10, (value) => this.setPm10(value));
    this.updateNumber('tvoc', sample.tvoc_index, (value) => this.setTvoc(value));
    this.updateNumber('noise', sample.noise, (value) => this.setNoise(value));
    this.updateNumber('battery', sample.battery, (value) => this.setBattery(value));

    if (firmwareVersion) {
      this.mainAccessory
        .getService(this.api.hap.Service.AccessoryInformation)
        .updateCharacteristic(this.api.hap.Characteristic.FirmwareRevision, firmwareVersion);
    }
  }

  normalizeMac(mac) {
    return String(mac || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase();
  }

  maskMac(mac) {
    const normalized = this.normalizeMac(mac);
    return normalized.length > 4 ? `****${normalized.slice(-4)}` : '****';
  }

  updateNumber(key, sensor, callback) {
    if (!this.isMeasurementEnabled(key) || !sensor || !Number.isFinite(sensor.value)) {
      return;
    }

    if (
      sensor.status !== undefined &&
      sensor.status !== 0 &&
      key !== 'battery'
    ) {
      this.log.debug(`${key} status=${sensor.status}; value ignored`);
      return;
    }

    callback(sensor.value);
  }

  setTemperature(value) {
    const service = this.services.get('temperature');
    if (!service) return;

    service.updateCharacteristic(
      this.api.hap.Characteristic.CurrentTemperature,
      this.clamp(value, -100, 100)
    );
  }

  setHumidity(value) {
    const service = this.services.get('humidity');
    if (!service) return;

    service.updateCharacteristic(
      this.api.hap.Characteristic.CurrentRelativeHumidity,
      this.clamp(value, 0, 100)
    );
  }

  setCo2(value) {
    const { Characteristic } = this.api.hap;
    const service = this.services.get('co2');
    if (!service) return;

    service.updateCharacteristic(
      Characteristic.CarbonDioxideLevel,
      Math.max(0, value)
    );

    service.updateCharacteristic(
      Characteristic.CarbonDioxideDetected,
      value >= 1000
        ? Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL
        : Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL
    );
  }

  setPm25(value) {
    const service = this.services.get('air_quality');
    if (!service || !this.isMeasurementEnabled('pm25')) return;

    service.updateCharacteristic(
      this.api.hap.Characteristic.PM2_5Density,
      Math.max(0, value)
    );

    this.updateAirQuality(service);
  }

  setPm10(value) {
    const service = this.services.get('air_quality');
    if (!service || !this.isMeasurementEnabled('pm10')) return;

    service.updateCharacteristic(
      this.api.hap.Characteristic.PM10Density,
      Math.max(0, value)
    );

    this.updateAirQuality(service);
  }

  setTvoc(value) {
    const service = this.services.get('air_quality');
    if (!service || !this.isMeasurementEnabled('tvoc')) return;

    const vocCharacteristic = this.api.hap.Characteristic.VOCDensity;

    if (vocCharacteristic) {
      service.updateCharacteristic(
        vocCharacteristic,
        Math.max(0, value)
      );
    }

    this.updateAirQuality(service);
  }

  updateAirQuality(service) {
    const { Characteristic } = this.api.hap;
    const values = [];

    if (this.isMeasurementEnabled('pm25')) {
      const pm25 = service.getCharacteristic(Characteristic.PM2_5Density).value;
      if (typeof pm25 === 'number' && pm25 > 0) values.push(pm25);
    }

    if (this.isMeasurementEnabled('pm10')) {
      const pm10 = service.getCharacteristic(Characteristic.PM10Density).value;
      if (typeof pm10 === 'number' && pm10 > 0) values.push(pm10);
    }

    if (!values.length) {
      return;
    }

    const worst = Math.max(...values);
    let airQuality = Characteristic.AirQuality.UNKNOWN;

    if (worst <= 12) {
      airQuality = Characteristic.AirQuality.EXCELLENT;
    } else if (worst <= 35) {
      airQuality = Characteristic.AirQuality.GOOD;
    } else if (worst <= 55) {
      airQuality = Characteristic.AirQuality.FAIR;
    } else if (worst <= 150) {
      airQuality = Characteristic.AirQuality.INFERIOR;
    } else {
      airQuality = Characteristic.AirQuality.POOR;
    }

    service.updateCharacteristic(Characteristic.AirQuality, airQuality);
  }

  setNoise(value) {
    const service = this.services.get('noise');
    if (!service) return;

    const characteristic = service.characteristics.find(
      (c) => c.displayName === 'Noise'
    );

    if (characteristic) {
      characteristic.updateValue(Math.max(0, Math.round(value)));
    }
  }

  setBattery(value) {
    const { Characteristic } = this.api.hap;
    const service = this.services.get('battery');
    if (!service) return;

    const level = this.clamp(value, 0, 100);

    service.updateCharacteristic(Characteristic.BatteryLevel, level);
    service.updateCharacteristic(
      Characteristic.ChargingState,
      Characteristic.ChargingState.NOT_CHARGING
    );
    service.updateCharacteristic(
      Characteristic.StatusLowBattery,
      level <= 20
        ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
        : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
    );
  }

  clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
}

module.exports = { QingpingPlatform };
