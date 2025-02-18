import { sleep } from "../../scrypted/common/src/sleep";
import sdk, { Camera, PanTiltZoom, MediaObject, PanTiltZoomCommand, ScryptedDeviceType, ScryptedInterface, RequestPictureOptions, Setting, Settings, Device, ScryptedDeviceBase, OnOff } from "@scrypted/sdk";
import { StorageSettings } from "@scrypted/sdk/storage-settings";
import { UrlMediaStreamOptions } from '../../scrypted/plugins/ffmpeg-camera/src/common';
import { Destroyable, RtspSmartCamera, createRtspMediaStreamOptions } from '../../scrypted/plugins/rtsp/src/rtsp';
import NeolinkProvider from "./main";
import EventEmitter from "events";
import MqttClient from '../../scrypted-apocaliss-base/src/mqtt-client';
import { getMqttTopics, subscribeToNeolinkTopic, unsubscribeFromNeolinkTopic } from "./utils";
import { getMqttBasicClient } from "../../scrypted-apocaliss-base/src/basePlugin";

export enum Ability {
    Battery = 'Battery',
    Floodlight = 'Floodlight',
    FloodlightTasks = 'FloodlightTasks',
    Siren = 'Siren',
    Pir = 'Pir',
}

enum PtzAction {
    Pan = 'Pan',
    Tilt = 'Tilt',
    Zoom = 'Zoom',
}

const floodlightSuffix = `floodlight`;
const floodlightTasksSuffix = `floodlightTasks`;
const sirenSuffix = `siren`;
const pirSuffix = `pir`;

class NeolinkCameraSiren extends ScryptedDeviceBase implements OnOff {
    sirenTimeout: NodeJS.Timeout;

    constructor(public camera: NeolinkCamera, nativeId: string) {
        super(nativeId);
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
        const mqttClient = await this.camera.provider.getMqttClient();
        const { cameraName } = this.camera.storageSettings.values;
        const { sirenControlTopic } = getMqttTopics(cameraName);

        await mqttClient.publish(sirenControlTopic, on ? 'on' : 'off');
    }
}

class NeolinkCameraFloodlight extends ScryptedDeviceBase implements OnOff {
    constructor(public camera: NeolinkCamera, nativeId: string) {
        super(nativeId);
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
        const mqttClient = await this.camera.provider.getMqttClient();
        const { cameraName } = this.camera.storageSettings.values;
        const { floodlightControlTopic } = getMqttTopics(cameraName);

        await mqttClient.publish(floodlightControlTopic, on ? 'on' : 'off');
    }
}

class NeolinkCameraFloodlightTasks extends ScryptedDeviceBase implements OnOff {
    constructor(public camera: NeolinkCamera, nativeId: string) {
        super(nativeId);
    }

    async turnOff() {
        this.on = false;
        await this.setFloodlightTasks(false);
    }

    async turnOn() {
        this.on = true;
        await this.setFloodlightTasks(true);
    }

    private async setFloodlightTasks(on?: boolean) {
        const mqttClient = await this.camera.provider.getMqttClient();
        const { cameraName } = this.camera.storageSettings.values;
        const { floodlightTasksControlTopic } = getMqttTopics(cameraName);

        await mqttClient.publish(floodlightTasksControlTopic, on ? 'on' : 'off');
    }
}

class NeolinkCameraPir extends ScryptedDeviceBase implements OnOff {
    constructor(public camera: NeolinkCamera, nativeId: string) {
        super(nativeId);
    }

    async turnOff() {
        this.on = false;
        await this.setPir(false);
    }

    async turnOn() {
        this.on = true;
        await this.setPir(true);
    }

    private async setPir(on: boolean) {
        const mqttClient = await this.camera.provider.getMqttClient();
        const { cameraName } = this.camera.storageSettings.values;
        const { pirControlTopic } = getMqttTopics(cameraName);

        await mqttClient.publish(pirControlTopic, on ? 'on' : 'off');
    }
}


class NeolinkCamera extends RtspSmartCamera implements Camera, PanTiltZoom {
    mqttClient: MqttClient;
    videoStreamOptions: Promise<UrlMediaStreamOptions[]>;
    motionTimeout: NodeJS.Timeout;
    siren: NeolinkCameraSiren;
    floodlight: NeolinkCameraFloodlight;
    floodlightTasks: NeolinkCameraFloodlightTasks;
    pir: NeolinkCameraPir;
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
                Ability.FloodlightTasks,
                Ability.Pir,
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

        setTimeout(async () => {
            this.updatePtzCaps();
            // try {
            //     await this.getPresets();
            // } catch (e) {
            //     this.console.log('Fail fetching presets', e);
            // }
            await this.updateDevice();
            await this.reportDevices();
        }, 2000);
    }

    private async setupMqttClient() {
        const logger = this.console;

        if (this.mqttClient) {
            await this.mqttClient.disconnect();
            this.mqttClient = undefined;
        }

        try {
            this.mqttClient = await this.provider.setupMqttClientInternal(logger);
        } catch (e) {
            this.console.log('Error setting up MQTT client', e);
        }
    }

    async getMqttClient() {
        if (!this.mqttClient) {
            await this.setupMqttClient();
        }

        return this.mqttClient;
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
            await mqttClient.publish(ptzControlTopic, `${op} 15.0`, false);
        }
    }

    hasSiren() {
        return this.storageSettings.values.abilities?.includes(Ability.Siren);
    }

    hasFloodlight() {
        return this.storageSettings.values.abilities?.includes(Ability.Floodlight);
    }

    hasFloodlightTasks() {
        return this.storageSettings.values.abilities?.includes(Ability.FloodlightTasks);
    }

    hasPir() {
        return this.storageSettings.values.abilities?.includes(Ability.Pir);
    }

    hasBattery() {
        return this.storageSettings.values.abilities?.includes(Ability.Battery);
    }

    async updateDevice() {
        await this.setupMqttClient();

        const interfaces = this.provider.getInterfaces();
        let name = 'Neolink Camera';

        if (this.storageSettings.values.ptz?.length) {
            interfaces.push(ScryptedInterface.PanTiltZoom);
        }
        if (this.hasFloodlight() || this.hasSiren() || this.hasFloodlightTasks() || this.hasPir())
            interfaces.push(ScryptedInterface.DeviceProvider);

        if (this.hasBattery()) {
            interfaces.push(ScryptedInterface.Battery, ScryptedInterface.Sleep);
            this.startBatteryCheckInterval();
        }

        await this.startMqttListeners();

        await this.provider.updateDevice(this.nativeId, this.name ?? name, interfaces, ScryptedDeviceType.Camera);
    }

    async listenEvents(): Promise<Destroyable> {
        const { cameraName } = this.storageSettings.values;
        const { motionStatusTopic } = getMqttTopics(cameraName);
        const events = new EventEmitter();
        const ret: Destroyable = {
            on: function (eventName: string | symbol, listener: (...args: any[]) => void): void {
                events.on(eventName, listener);
            },
            destroy: async () => {
                const mqttClient = await this.getMqttClient();
                await unsubscribeFromNeolinkTopic(mqttClient, motionStatusTopic, this.console)
            },
            emit: function (eventName: string | symbol, ...args: any[]): boolean {
                return events.emit(eventName, ...args);
            }
        };

        return ret;
    }

    async startMqttListeners() {
        const { cameraName, motionTimeout } = this.storageSettings.values;

        const mqttClient = await this.getMqttClient();
        const { previewStatusTopic, statusTopic, motionStatusTopic } = getMqttTopics(cameraName);

        await subscribeToNeolinkTopic(mqttClient, previewStatusTopic, this.console, (preview: string) => {
            this.console.log(`New snapshot received: ${preview.substring(0, 20)}...`);
            this.lastPreview = preview;
        });
        await subscribeToNeolinkTopic(mqttClient, statusTopic, this.console, (status: string) => {
            this.console.log(`Connection status: ${status}`);
            if (status === 'connected') {
                this.sleeping = false;
            } else if (status === 'disconnected') {
                this.sleeping = true;
            }
        });

        await subscribeToNeolinkTopic(mqttClient, motionStatusTopic, this.console, (motion: 'on' | 'off') => {
            this.console.log(`Motion received: ${motion}`);
            if (motion === 'on') {
                this.motionDetected = true;
                clearTimeout(this.motionTimeout);
                this.motionTimeout = setTimeout(() => this.motionDetected = false, motionTimeout * 1000);
            } else if (motion === 'off') {
                this.motionDetected = false;
                clearTimeout(this.motionTimeout);
            }
        })

    }

    async startBatteryCheckInterval() {
        const { cameraName } = this.storageSettings.values;
        if (this.batteryTimeout) {
            clearInterval(this.batteryTimeout);
        }
        const mqttClient = await this.getMqttClient();

        const { batteryQueryTopic, batteryStatusTopic, previewQueryTopic } = getMqttTopics(cameraName);

        subscribeToNeolinkTopic(mqttClient, batteryStatusTopic, this.console, (batteryLevel: string) => {
            this.console.log(`Battery level received: ${batteryLevel}`);
            this.batteryLevel = JSON.parse(batteryLevel);
        });

        this.batteryTimeout = setInterval(async () => {
            mqttClient.publish(batteryQueryTopic, '', false);
            mqttClient.publish(previewQueryTopic, '', false);
        }, 1000 * 60 * 60);
    }

    async takeSmartCameraPicture(options?: RequestPictureOptions): Promise<MediaObject> {
        const { cameraName } = this.storageSettings.values;

        const mqttClient = await this.getMqttClient();

        if (!this.hasBattery()) {
            const { previewQueryTopic } = getMqttTopics(cameraName);
            mqttClient.publish(previewQueryTopic, '', false);
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
        const hasFloodlightTasks = this.hasFloodlightTasks();
        const hasPir = this.hasPir();

        const devices: Device[] = [];

        if (hasSiren) {
            const sirenNativeId = `${this.nativeId}-${sirenSuffix}`;
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
            const floodlightNativeId = `${this.nativeId}-${floodlightSuffix}`;
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

        if (hasFloodlightTasks) {
            const floodlightTasksNativeId = `${this.nativeId}-${floodlightTasksSuffix}`;
            const floodlightTaksDevice: Device = {
                providerNativeId: this.nativeId,
                name: `${this.name} Floodlight tasks`,
                nativeId: floodlightTasksNativeId,
                info: {
                    ...this.info,
                },
                interfaces: [
                    ScryptedInterface.OnOff
                ],
                type: ScryptedDeviceType.Light,
            };

            devices.push(floodlightTaksDevice);
        }

        if (hasPir) {
            const pirNativeId = `${this.nativeId}-${pirSuffix}`;
            const pirDevice: Device = {
                providerNativeId: this.nativeId,
                name: `${this.name} PIR`,
                nativeId: pirNativeId,
                info: {
                    ...this.info,
                },
                interfaces: [
                    ScryptedInterface.OnOff
                ],
                type: ScryptedDeviceType.Sensor,
            };

            devices.push(pirDevice);
        }

        sdk.deviceManager.onDevicesChanged({
            providerNativeId: this.nativeId,
            devices
        });
    }

    async getDevice(nativeId: string): Promise<any> {
        if (nativeId.endsWith(`-${sirenSuffix}`)) {
            this.siren ||= new NeolinkCameraSiren(this, nativeId);
            return this.siren;
        } else if (nativeId.endsWith(`-${floodlightSuffix}`)) {
            this.floodlight ||= new NeolinkCameraFloodlight(this, nativeId);
            return this.floodlight;
        } else if (nativeId.endsWith(`-${floodlightTasksSuffix}`)) {
            this.floodlightTasks ||= new NeolinkCameraFloodlightTasks(this, nativeId);
            return this.floodlightTasks;
        } else if (nativeId.endsWith(`-${pirSuffix}`)) {
            this.pir ||= new NeolinkCameraPir(this, nativeId);
            return this.pir;
        }
    }

    async releaseDevice(id: string, nativeId: string) {
        if (nativeId.endsWith(`-${sirenSuffix}`)) {
            delete this.siren;
        } else if (nativeId.endsWith(`-${floodlightSuffix}`)) {
            delete this.floodlight;
        } else if (nativeId.endsWith(`-${floodlightTasksSuffix}`)) {
            delete this.floodlightTasks;
        } else if (nativeId.endsWith(`-${pirSuffix}`)) {
            delete this.pir;
        }
    }
}

export default NeolinkCamera;