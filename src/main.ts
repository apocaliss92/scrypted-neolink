import sdk, { Brightness, Camera, Device, DeviceCreatorSettings, DeviceInformation, DeviceProvider, Intercom, MediaObject, ObjectDetectionTypes, ObjectDetector, ObjectsDetected, OnOff, PanTiltZoom, PanTiltZoomCommand, Reboot, RequestPictureOptions, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { RtspProvider } from '../../scrypted/plugins/rtsp/src/rtsp';
import MqttClient, { getMqttTopics } from './mqtt-client';
import NeolinkCamera from './camera';

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

class NeolinkProvider extends RtspProvider implements Settings {
    mqttClient: MqttClient;
    storageSettings = new StorageSettings(this, {
        neolinkServerIp: {
            title: 'Neolink server IP',
            type: 'string',
        },
        neolinkServerPort: {
            title: 'Neolink server port',
            type: 'string',
            defaultValue: '8554',
            placeholder: '8554',
        },
        rtspUsername: {
            key: 'username',
            title: 'RTSP Username',
        },
        rtspPassword: {
            key: 'password',
            title: 'RTSP Password',
            type: 'password',
        },
    });

    async getSettings(): Promise<Setting[]> {
        return await this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue) {
        await this.storageSettings.putSetting(key, value);
    }

    getScryptedDeviceCreator(): string {
        return 'Neolink Camera';
    }

    getAdditionalInterfaces() {
        return [
            ScryptedInterface.VideoCameraConfiguration,
            ScryptedInterface.Camera,
            ScryptedInterface.MotionSensor,
        ];
    }

    async createDevice(settings: DeviceCreatorSettings, nativeId?: string): Promise<string> {
        const username = this.storageSettings.values.rtspUsername;
        const password = this.storageSettings.values.rtspPassword;
        const cameraName = settings.cameraName as string;
        const rtspPort = settings.rtspPort?.toString() ?? '8554';
        const ip = this.storageSettings.values.neolinkServerIp;

        if (!cameraName || !ip) {
            this.console.log('Camera name and IP are required');
            return;
        }
        settings.newCamera = cameraName.toString().match(/[A-Z][a-z]+/g).join(' ');
        nativeId = await super.createDevice(settings, nativeId);

        const device = await this.getDevice(nativeId) as NeolinkCamera;
        device.putSetting('username', username);
        device.putSetting('password', password);
        device.putSetting('rtspPort', rtspPort);
        device.putSetting('cameraName', cameraName);
        device.setIPAddress(ip?.toString());

        return nativeId;
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'cameraName',
                title: 'Camera neolink name',
                type: 'string',
            }
        ]
    }

    createCamera(nativeId: string) {
        return new NeolinkCamera(nativeId, this);
    }
}

export default NeolinkProvider;
