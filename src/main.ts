import sdk, { DeviceCreatorSettings, ScryptedInterface, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { RtspProvider } from '../../scrypted/plugins/rtsp/src/rtsp';
import NeolinkCamera from './camera';
import MqttClient from '../../scrypted-apocaliss-base/src/mqtt-client';
import { getMqttBasicClient } from '../../scrypted-apocaliss-base/src/basePlugin';

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
        useMqttPluginCredentials: {
            title: 'Use MQTT plugin credentials',
            type: 'boolean',
            immediate: true,
            group: 'MQTT',
        },
        mqttHost: {
            title: 'Host',
            description: 'Specify the mqtt address.',
            placeholder: 'mqtt://192.168.1.100',
            group: 'MQTT',
        },
        mqttUsename: {
            title: 'Username',
            description: 'Specify the mqtt username.',
            group: 'MQTT',
        },
        mqttPassword: {
            title: 'Password',
            description: 'Specify the mqtt password.',
            type: 'password',
            group: 'MQTT',
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

    private async setupMqttClient() {
        const logger = this.console;

        if (this.mqttClient) {
            this.mqttClient.disconnect();
            this.mqttClient = undefined;
        }

        try {
            this.mqttClient = await getMqttBasicClient({
                logger,
                useMqttPluginCredentials: this.storageSettings.getItem('useMqttPluginCredentials'),
                mqttHost: this.storageSettings.getItem('mqttHost'),
                mqttUsename: this.storageSettings.getItem('mqttUsename'),
                mqttPassword: this.storageSettings.getItem('mqttPassword'),
            });
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
}

export default NeolinkProvider;
