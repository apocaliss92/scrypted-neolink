import { sleep } from "../../scrypted/common/src/sleep";
import sdk, { Camera, PanTiltZoom, MediaObject, PanTiltZoomCommand, ScryptedDeviceType, ScryptedInterface, RequestPictureOptions, Setting, Settings, Device, ScryptedDeviceBase, OnOff } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { UrlMediaStreamOptions } from '../../scrypted/plugins/ffmpeg-camera/src/common';
import { Destroyable, RtspSmartCamera, createRtspMediaStreamOptions } from '../../scrypted/plugins/rtsp/src/rtsp';
import MqttClient, { getMqttTopics } from "./mqtt-client";
import NeolinkProvider from "./main";
import EventEmitter from "events";

enum Ability {
    Battery = 'Battery',
    Floodlight = 'Floodlight',
    Siren = 'Siren',
}

enum PtzAction {
    Pan = 'Pan',
    Tilt = 'Tilt',
    Zoom = 'Zoom',
}

class NeolinkCameraSiren extends ScryptedDeviceBase implements OnOff {
    sirenTimeout: NodeJS.Timeout;

    constructor(public camera: NeolinkCamera, nativeId: string) {
        super(nativeId);
        this.on = false;
    }

    async turnOff() {
        this.on = false;
        await this.setSiren(false);
    }

    async turnOn() {
        this.on = true;
        await this.setSiren(true);
    }

    private async setSiren(on: boolean) {
        const mqttClient = await this.camera.getMqttClient();
        const { cameraName } = this.camera.storageSettings.values;
        const { sirenControlTopic } = getMqttTopics(cameraName);

        await mqttClient.publish(this.console, sirenControlTopic, on ? 'on' : 'off');
    }
}

class NeolinkCameraFloodlight extends ScryptedDeviceBase implements OnOff {
    constructor(public camera: NeolinkCamera, nativeId: string) {
        super(nativeId);
        this.on = false;
    }

    async turnOff() {
        this.on = false;
        await this.setFloodlight(false);
    }

    async turnOn() {
        this.on = true;
        await this.setFloodlight(true);
    }

    private async setFloodlight(on?: boolean, brightness?: number) {
        const mqttClient = await this.camera.getMqttClient();
        const { cameraName } = this.camera.storageSettings.values;
        const { floodlightControlTopic } = getMqttTopics(cameraName);

        await mqttClient.publish(this.console, floodlightControlTopic, on ? 'on' : 'off');
    }
}


class NeolinkCamera extends RtspSmartCamera implements Camera, PanTiltZoom {
    mqttClient: MqttClient;
    videoStreamOptions: Promise<UrlMediaStreamOptions[]>;
    motionTimeout: NodeJS.Timeout;
    siren: NeolinkCameraSiren;
    floodlight: NeolinkCameraFloodlight;
    batteryTimeout: NodeJS.Timeout;
    lastMqttConnect: number;
    lastPreview?: string;

    storageSettings = new StorageSettings(this, {
        cameraName: {
            title: 'Camera neolink name',
            type: 'string',
        },
        motionTimeout: {
            title: 'Motion Timeout',
            defaultValue: 20,
            type: 'number',
        },
        ptz: {
            title: 'PTZ Capabilities',
            choices: [
                PtzAction.Pan,
                PtzAction.Tilt,
                PtzAction.Zoom
            ],
            multiple: true,
            onPut: async () => {
                await this.updateDevice();
                this.updatePtzCaps();
            },
        },
        abilities: {
            title: 'Abilities',
            choices: [
                Ability.Battery,
                Ability.Siren,
                Ability.Floodlight,
            ],
            multiple: true,
            onPut: async () => {
                await this.updateDevice();
                await this.reportDevices();
            },
        },
        // presets: {
        //     title: 'Presets',
        //     description: 'PTZ Presets in the format "id=name". Where id is the PTZ Preset identifier and name is a friendly name.',
        //     multiple: true,
        //     defaultValue: [],
        //     combobox: true,
        //     onPut: async (ov, presets: string[]) => {
        //         const caps = {
        //             ...this.ptzCapabilities,
        //             presets: {},
        //         };
        //         for (const preset of presets) {
        //             const [key, name] = preset.split('=');
        //             caps.presets[key] = name;
        //         }
        //         this.ptzCapabilities = caps;
        //     },
        //     mapGet: () => {
        //         const presets = this.ptzCapabilities?.presets || {};
        //         return Object.entries(presets).map(([key, name]) => key + '=' + name);
        //     },
        // },
        // cachedPresets: {
        //     multiple: true,
        //     hide: true,
        //     json: true,
        //     defaultValue: [],
        // },
    });

    constructor(nativeId: string, public provider: NeolinkProvider) {
        super(nativeId, provider);

        // this.storageSettings.settings.presets.onGet = async () => {
        //     const choices = this.storageSettings.values.cachedPresets.map((preset) => preset.id + '=' + preset.name);
        //     return {
        //         choices,
        //     };
        // };

        (async () => {
            this.updatePtzCaps();
            // try {
            //     await this.getPresets();
            // } catch (e) {
            //     this.console.log('Fail fetching presets', e);
            // }
            await this.updateDevice();
            await this.reportDevices();
        })()
            .catch(e => {
                this.console.log('device refresh failed', e);
            });
    }

    updatePtzCaps() {
        const { ptz } = this.storageSettings.values;
        this.ptzCapabilities = {
            ...this.ptzCapabilities,
            pan: ptz?.includes(PtzAction.Pan),
            tilt: ptz?.includes(PtzAction.Tilt),
            zoom: ptz?.includes(PtzAction.Zoom),
        }
    }

    // async getPresets() {
    //     const client = this.getClient();
    //     const ptzPresets = await client.getPtzPresets();
    //     this.console.log(`Presets: ${JSON.stringify(ptzPresets)}`)
    //     this.storageSettings.values.cachedPresets = ptzPresets;
    // }

    async ptzCommand(command: PanTiltZoomCommand): Promise<void> {
        const mqttClient = await this.getMqttClient();
        const { cameraName } = this.storageSettings.values;

        // if (command.preset && !Number.isNaN(Number(command.preset))) {
        //     await this.presetOp(1, Number(command.preset));
        //     return;
        // }

        let op = '';
        if (command.pan < 0)
            op += 'left';
        else if (command.pan > 0)
            op += 'right'
        else if (command.tilt < 0)
            op += 'down';
        else if (command.tilt > 0)
            op += 'up';
        else if (command.zoom < 0)
            op = 'out';
        else if (command.zoom > 0)
            op = 'in';

        if (op) {
            const { ptzControlTopic } = getMqttTopics(cameraName);
            await mqttClient.publish(this.console, ptzControlTopic, `${op} 15.0`, false);
        }
    }

    hasSiren() {
        return this.storageSettings.values.abilities?.includes(Ability.Siren);
    }

    hasFloodlight() {
        return this.storageSettings.values.abilities?.includes(Ability.Floodlight);
    }

    hasBattery() {
        return this.storageSettings.values.abilities?.includes(Ability.Battery);
    }

    async updateDevice() {
        const interfaces = this.provider.getInterfaces();
        let name = 'Neolink Camera';

        if (this.storageSettings.values.ptz?.length) {
            interfaces.push(ScryptedInterface.PanTiltZoom);
        }
        if (this.hasFloodlight() || this.hasSiren())
            interfaces.push(ScryptedInterface.DeviceProvider);
        if (this.hasBattery()) {
            interfaces.push(ScryptedInterface.Battery);
            this.startBatteryCheckInterval();
        }
        this.startMqttListeners();

        await this.provider.updateDevice(this.nativeId, this.name ?? name, interfaces, ScryptedDeviceType.Camera);
    }

    async listenEvents(): Promise<Destroyable> {
        const { cameraName, motionTimeout } = this.storageSettings.values;
        const { motionStatusTopic } = getMqttTopics(cameraName);
        const events = new EventEmitter();
        const ret: Destroyable = {
            on: function (eventName: string | symbol, listener: (...args: any[]) => void): void {
                events.on(eventName, listener);
            },
            destroy: async () => {
                const mqttClient = await this.getMqttClient();
                await mqttClient.unsubscribeFromNeolinkTopic(motionStatusTopic, this.console)
            },
            emit: function (eventName: string | symbol, ...args: any[]): boolean {
                return events.emit(eventName, ...args);
            }
        };

        const mqttClient = await this.getMqttClient();
        await mqttClient.subscribeToNeolinkTopic(motionStatusTopic, this.console, (motion: 'on' | 'off') => {
            if (motion === 'on') {
                this.motionDetected = true;
                clearTimeout(this.motionTimeout);
                this.motionTimeout = setTimeout(() => this.motionDetected = false, motionTimeout * 1000);
            } else if (motion === 'off') {
                this.motionDetected = false;
                clearTimeout(this.motionTimeout);
            }
        })

        return ret;
    }

    async getMqttClient() {
        const now = new Date().getTime();
        const shouldRenew = this.mqttClient && (!this.lastMqttConnect || (now - this.lastMqttConnect) >= 1000 * 60 * 30);

        if (shouldRenew) {
            await this.mqttClient.disconnect();
            this.mqttClient = undefined;
        }

        if (!this.mqttClient) {
            const mqttDevice = sdk.systemManager.getDeviceByName('MQTT') as unknown as Settings;
            const mqttSettings = await mqttDevice.getSettings();

            const mqttHost = mqttSettings.find(setting => setting.key === 'externalBroker')?.value as string;
            const mqttUsename = mqttSettings.find(setting => setting.key === 'username')?.value as string;
            const mqttPassword = mqttSettings.find(setting => setting.key === 'password')?.value as string;

            try {
                this.mqttClient = new MqttClient(
                    mqttHost,
                    mqttUsename,
                    mqttPassword,
                    this.storageSettings.values.cameraName
                );
                this.lastMqttConnect = new Date().getTime();
            } catch (e) {
                this.console.log('Error setting up MQTT client', e);
            }
        }

        return this.mqttClient;
    }

    async startMqttListeners() {
        const { cameraName } = this.storageSettings.values;

        const mqttClient = await this.getMqttClient();
        const { previewStatusTopic } = getMqttTopics(cameraName);

        mqttClient.subscribeToNeolinkTopic(previewStatusTopic, this.console, (preview: string) => {
            this.lastPreview = preview;
        });
    }

    async startBatteryCheckInterval() {
        const { cameraName } = this.storageSettings.values;
        if (this.batteryTimeout) {
            clearInterval(this.batteryTimeout);
        }
        const mqttClient = await this.getMqttClient();

        const { batteryQueryTopic, batteryStatusTopic, previewQueryTopic } = getMqttTopics(cameraName);

        mqttClient.subscribeToNeolinkTopic(batteryStatusTopic, this.console, (batteryLevel: string) => {
            this.batteryLevel = JSON.parse(batteryLevel);
        });

        this.batteryTimeout = setInterval(async () => {
            mqttClient.publish(this.console, batteryQueryTopic, '', false);
            mqttClient.publish(this.console, previewQueryTopic, '', false);
        }, 1000 * 60 * 60);
    }

    async takeSmartCameraPicture(options?: RequestPictureOptions): Promise<MediaObject> {
        const { cameraName } = this.storageSettings.values;

        const mqttClient = await this.getMqttClient();

        if (!this.hasBattery()) {
            const { previewQueryTopic } = getMqttTopics(cameraName);
            mqttClient.publish(this.console, previewQueryTopic, '', false);
            await sleep(2000);
        }

        if (this.lastPreview) {
            const base64Data = this.lastPreview.replace(/^data:image\/\w+;base64,/, "");
            const imageBuffer = Buffer.from(base64Data, 'base64');
            if (imageBuffer) {
                return await sdk.mediaManager.createMediaObject(imageBuffer, 'image/jpeg');
            }
        }
    }

    showHttpPortOverride() {
        return false;
    }

    createRtspMediaStreamOptions(url: string, index: number) {
        const ret = createRtspMediaStreamOptions(url, index);
        ret.tool = 'scrypted';
        return ret;
    }

    addRtspCredentials(rtspUrl: string) {
        const url = new URL(rtspUrl);
        url.username = this.provider.storageSettings.getItem('rtspUsername');
        url.password = this.provider.storageSettings.getItem('rtspPassword');
        return url.toString();
    }

    // async createVideoStream(vso: UrlMediaStreamOptions): Promise<MediaObject> {
    //     return super.createVideoStream(vso);
    // }

    async getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        const { cameraName } = this.storageSettings.values;

        const rtspAddress = `${this.provider.storageSettings.getItem('neolinkServerIp')}:${this.provider.storageSettings.getItem('neolinkServerPort')}`;

        const streams: UrlMediaStreamOptions[] = [
            {
                name: 'Main',
                id: 'main',
                container: 'rtsp',
                url: `rtsp://${rtspAddress}/${cameraName}/main`
            },
            {
                name: 'Sub',
                id: 'sub',
                container: 'rtsp',
                url: `rtsp://${rtspAddress}/${cameraName}/sub`
            },
            {
                name: 'Ext',
                id: 'ext',
                container: 'rtsp',
                url: `rtsp://${rtspAddress}/${cameraName}/extern`
            },
        ];

        this.videoStreamOptions = new Promise(r => r(streams));

        return this.videoStreamOptions;
    }

    async putSetting(key: string, value: string) {
        if (this.storageSettings.keys[key]) {
            await this.storageSettings.putSetting(key, value);
        }
        else {
            await super.putSetting(key, value);
        }
        this.updateDevice();
    }

    showRtspUrlOverride() {
        return false;
    }

    async getSettings(): Promise<Setting[]> {
        return await this.storageSettings.getSettings();
    }

    async reportDevices() {
        const hasSiren = this.hasSiren();
        const hasFloodlight = this.hasFloodlight();

        const devices: Device[] = [];

        if (hasSiren) {
            const sirenNativeId = `${this.nativeId}-siren`;
            const sirenDevice: Device = {
                providerNativeId: this.nativeId,
                name: `${this.name} Siren`,
                nativeId: sirenNativeId,
                info: {
                    ...this.info,
                },
                interfaces: [
                    ScryptedInterface.OnOff
                ],
                type: ScryptedDeviceType.Siren,
            };

            devices.push(sirenDevice);
        }

        if (hasFloodlight) {
            const floodlightNativeId = `${this.nativeId}-floodlight`;
            const floodlightDevice: Device = {
                providerNativeId: this.nativeId,
                name: `${this.name} Floodlight`,
                nativeId: floodlightNativeId,
                info: {
                    ...this.info,
                },
                interfaces: [
                    ScryptedInterface.OnOff
                ],
                type: ScryptedDeviceType.Light,
            };

            devices.push(floodlightDevice);
        }

        sdk.deviceManager.onDevicesChanged({
            providerNativeId: this.nativeId,
            devices
        });
    }

    async getDevice(nativeId: string): Promise<any> {
        if (nativeId.endsWith('-siren')) {
            this.siren ||= new NeolinkCameraSiren(this, nativeId);
            return this.siren;
        } else if (nativeId.endsWith('-floodlight')) {
            this.floodlight ||= new NeolinkCameraFloodlight(this, nativeId);
            return this.floodlight;
        }
    }

    async releaseDevice(id: string, nativeId: string) {
        if (nativeId.endsWith('-siren')) {
            delete this.siren;
        } else if (nativeId.endsWith('-floodlight')) {
            delete this.floodlight;
        }
    }
}

export default NeolinkCamera;