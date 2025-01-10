import { DeviceCreatorSettings, ScryptedInterface, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { RtspProvider } from '../../scrypted/plugins/rtsp/src/rtsp';
import MqttClient from './mqtt-client';
import NeolinkCamera from './camera';

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
