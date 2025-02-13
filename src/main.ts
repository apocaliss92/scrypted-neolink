import sdk, { DeviceCreatorSettings, ScryptedInterface, Setting, Settings, SettingValue } from "@scrypted/sdk";
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { RtspProvider } from '../../scrypted/plugins/rtsp/src/rtsp';
import NeolinkCamera from './camera';
import MqttClient from '../../scrypted-apocaliss-base/src/mqtt-client';
import { getMqttBasicClient } from '../../scrypted-apocaliss-base/src/basePlugin';
import { getNeolinkRelease, neolinkReleases, runCommand, System } from "./utils";
import fs from 'fs';
import AdmZip from 'adm-zip';
import { execSync } from "child_process";

class NeolinkProvider extends RtspProvider implements Settings {
    mqttClient: MqttClient;
    currentMixins = new Set<NeolinkCamera>();

    storageSettings = new StorageSettings(this, {
        spinServer: {
            title: 'Spin up a Neolink server',
            type: 'boolean',
            defaultValue: false,
            immediate: true,
            onPut: async (_, isActive) => await this.toggleServerNeolink(isActive)
        },
        neolinkServerVersion: {
            title: 'Neolink version',
            choices: neolinkReleases,
            defaultValue: neolinkReleases[0],
            type: 'string',
            group: 'Neolink server',
            onPut: async (_, ver) => await this.spinNeolinkServer(ver)
        },
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

    constructor() {
        super();
        this.toggleServerNeolink(this.storageSettings.values.spinServer).catch(this.console.log);
    }

    async toggleServerNeolink(isActive: boolean) {
        this.storageSettings.settings.neolinkServerIp.hide = isActive;
        this.storageSettings.settings.neolinkServerPort.hide = isActive;
        this.storageSettings.settings.rtspUsername.hide = isActive;
        this.storageSettings.settings.rtspPassword.hide = isActive;
        this.storageSettings.settings.neolinkServerVersion.hide = !isActive;

        if (isActive) {
            await this.spinNeolinkServer(this.storageSettings.values.neolinkServerVersion);
        } else {
            await this.stopNeolinkServer();
        }
    }

    async stopNeolinkServer() { }

    async spinNeolinkServer(version: string) {
        const { downloadUrl, system, filename } = getNeolinkRelease(version);
        const folder = process.env.SCRYPTED_PLUGIN_VOLUME;
        const installationFolder = `${folder}/neolinkServer`;
        const zipPath = `${installationFolder}/neolink.zip`;
        const scriptPath = `${installationFolder}/${filename}/neolink`;
        if ([System.MacM1, System.MacIntel].includes(system)) {
            try {
                if (fs.existsSync(installationFolder)) {
                    fs.rmSync(installationFolder, { recursive: true, force: true });
                }
                fs.mkdirSync(installationFolder, { recursive: true })

                this.console.log(`Downloading the neolink package`);
                await runCommand('curl', [
                    '-L', downloadUrl,
                    '-o', zipPath
                ], this.console);

                console.log('Extracting NeoLink...');
                const zip = new AdmZip(zipPath);
                zip.extractAllTo(installationFolder, true);

                this.console.log(`Downloading required libraries`);
                if (system === System.MacM1) {
                    await runCommand('arch', [
                        '-arm64', 'brew',
                        'install', 'gstreamer',
                        'gst-plugins-base', 'gst-plugins-good',
                        'gst-plugins-bad', 'gst-plugins-ugly',
                        'gst-libav'
                    ], this.console);
                } else {
                    await runCommand('brew', [
                        'install', 'gstreamer',
                        'gst-plugins-base', 'gst-plugins-good',
                        'gst-plugins-bad', 'gst-plugins-ugly',
                        'gst-libav'
                    ], this.console);
                }

                await runCommand(`chmod`, ['+x', scriptPath], this.console);

                this.console.log(`Starting neolink`);
                await runCommand(`${scriptPath}`, [
                    'mqtt-rtsp', '--config=neolink.toml'
                ], this.console);

            } catch (e) {
                this.console.log('Error during installation script', e);
            }
        }
    }

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
