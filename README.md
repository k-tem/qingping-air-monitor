# Homebridge Qingping Air Monitor 2 (CGS2)

Homebridge plugin for Qingping Air Monitor Gen 2 / CGS2. It reads the monitor's latest data from the official Qingping Cloud API and publishes it as an external HomeKit accessory.

## Setup

Install the plugin, then open its settings in Homebridge. The form contains only:

- **Device name** - a label for this Qingping device in Homebridge.
- **Name in Apple Home** - the accessory name shown when pairing with HomeKit.
- **Device MAC address** - the MAC address from Qingping+; `58:2D:34:70:56:C8` and `582D347056C8` both work.
- **Qingping+ App Key** and **App Secret** - API credentials created in the [Qingping Developer Platform](https://developer.qingping.co/). The Qingping+ account that owns the monitor must authorize this application.
- **Measurements** - select which sensor values to expose.

The plugin polls Qingping Cloud once per minute. No local MQTT broker, topic, or device-side MQTT setup is needed.

## Supported measurements

- Temperature
- Relative humidity
- CO2
- PM2.5
- PM10
- VOC index / eTVOC
- Noise
- Battery

These are all measurement fields exposed for CGS2 by the Qingping Cloud API. Temperature, humidity, CO2, PM2.5, PM10, VOC index/eTVOC, and battery are enabled by default. Noise is opt-in because HomeKit has no standard decibel characteristic.

## Apple Home

After saving the configuration and restarting Homebridge, locate the **Name in Apple Home** external accessory in the Homebridge UI. Scan its HomeKit QR code, or enter its setup code, in Apple Home to pair it directly.

PM2.5, PM10, and VOC are characteristics of HomeKit's Air Quality service. Apple Home shows the resulting air-quality state; apps such as Eve or Controller for HomeKit can show each individual value. Noise uses a custom characteristic and may likewise require a third-party HomeKit app.

### Choosing HomeKit ports

The external HomeKit accessory is assigned a local listening port by Homebridge. To restrict it to your own port range, configure the global Homebridge `ports` range (not a plugin setting):

```json
{
  "ports": {
    "start": 52100,
    "end": 52150
  }
}
```

Homebridge assigns the next free port in that range to each external accessory, including this plugin. Open the selected range in the local firewall if required.

## Installation from source

Requirements:

- Node.js 18+
- Homebridge

```bash
git clone https://github.com/YOUR_USER/homebridge-qingping-cgs2.git
cd homebridge-qingping-cgs2
npm install
npm link
```

Restart Homebridge after installation. The platform is named `Qingping CGS2`.

## License

MIT
