
import MqttClient from '../../scrypted-apocaliss-base/src/mqtt-client';
import os from 'os';
import fs from 'fs';
import https from 'https';
import { spawn } from 'child_process';

export const getMqttTopics = (cameraName: string) => {
    const batteryStatusTopic = `neolink/${cameraName}/status/battery_level`;
    const motionStatusTopic = `neolink/${cameraName}/status/motion`;
    const disconnecteStatusdTopic = `neolink/${cameraName}/status/disconnected`;
    const previewStatusTopic = `neolink/${cameraName}/status/preview`;
    const ptzPresetsStatusTopic = `neolink/${cameraName}/status/ptz/preset`;

    const batteryQueryTopic = `neolink/${cameraName}/query/battery`;
    const previewQueryTopic = `neolink/${cameraName}/query/preview`;
    const ptzPreviewQueryTopic = `neolink/${cameraName}/query/ptz/preset`;

    const ptzControlTopic = `neolink/${cameraName}/control/ptz`;
    const ptzPresetControlTopic = `neolink/${cameraName}/control/preset`;
    const floodlightControlTopic = `neolink/${cameraName}/control/floodlight`;
    const floodlightTasksControlTopic = `neolink/${cameraName}/control/floodlight_tasks`;
    const sirenControlTopic = `neolink/${cameraName}/control/siren`;
    const rebootControlTopic = `neolink/${cameraName}/control/reboot`;
    const ledControlTopic = `neolink/${cameraName}/control/led`;
    const irControlTopic = `neolink/${cameraName}/control/ir`;
    const pirControlTopic = `neolink/${cameraName}/control/pir`;

    return {
        batteryStatusTopic,
        motionStatusTopic,
        disconnecteStatusdTopic,
        ptzPresetsStatusTopic,
        previewStatusTopic,
        batteryQueryTopic,
        previewQueryTopic,
        ptzPreviewQueryTopic,
        ptzControlTopic,
        ptzPresetControlTopic,
        floodlightControlTopic,
        floodlightTasksControlTopic,
        sirenControlTopic,
        rebootControlTopic,
        ledControlTopic,
        irControlTopic,
        pirControlTopic,
    }
}

export const subscribeToNeolinkTopics = async (client: MqttClient, neolinkName: string, console: Console, cb: (batteryLevel?: number, preview?: string, presets?: string) => void) => {
    const batteryTopic = `neolink/${neolinkName}/status/battery_level`;
    const previewTopic = `neolink/${neolinkName}/status/preview`;
    const presetsTopic = `neolink/${neolinkName}/status/ptz/preset`;

    client.subscribe([batteryTopic, previewTopic, presetsTopic], async (messageTopic, message) => {
        const messageString = message.toString();
        if (messageTopic === batteryTopic) {
            cb(messageString !== 'null' ? JSON.parse(messageString) : undefined, undefined), undefined;
        }
        if (messageTopic === previewTopic) {
            cb(undefined, messageString, undefined);
        }
        if (messageTopic === presetsTopic) {
            console.log(messageTopic, messageString);
            cb(undefined, undefined, messageString);
        }
    });
}

export const subscribeToNeolinkTopic = async (client: MqttClient, topic: string, console: Console, cb: (value?: any) => void) => {
    client.subscribe([topic], async (messageTopic, message) => {
        const messageString = message.toString();
        if (messageTopic === topic) {
            cb(messageString);
        }
    });

}

export const unsubscribeFromNeolinkTopic = async (client: MqttClient, topic: string, console: Console) => {
    client.unsubscribe([topic]);
}

export const neolinkReleases: string[] = [
    '0.6.3.rc.2',
    '0.6.3.rc.1',
    '0.6.2',
    '0.6.1',
    '0.6.0',
]

export enum System {
    MacIntel = 'MacIntel',
    MacM1 = 'MacM1',
    Windows = 'Windows',
    LinuxArm64 = 'LinuxArm64',
    LinuxArmHf = 'LinuxArmHf',
    LinuxBookworm = 'LinuxBookworm',
    Ubuntu = 'Ubuntu',
}

export const getNeolinkRelease = (version: string) => {
    const system = identifyHost();
    const baseUrl = `https://github.com/QuantumEntangledAndy/neolink/releases/download/v${version}`;
    const systemMap: Record<System, string> = {
        [System.MacIntel]: `neolink_macos_intel`,
        [System.MacM1]: `neolink_macos_m1`,
        [System.LinuxArm64]: `neolink_linux_armhf`,
        [System.LinuxArmHf]: `neolink_linux_armhf`,
        [System.LinuxBookworm]: `neolink_linux_x86_64_bookworm`,
        [System.Ubuntu]: `neolink_linux_x86_64_ubuntu`,
        [System.Windows]: `neolink_windows`,
    }
    const filename = systemMap[system];

    return { downloadUrl: `${baseUrl}/${filename}.zip`, system, filename };
}

const identifyHost = (): System => {
    if (os.platform() === 'darwin') {
        const arch = os.arch(); // 'x64' per Intel, 'arm64' per M1+
        if (arch === 'x64') {
            return System.MacIntel;
        } else if (arch === 'arm64') {
            return System.MacM1;
        }
    } else if (os.platform() === 'linux') {
        const arch = os.arch(); // 'arm64', 'arm', 'x64', ecc.
        if (arch === 'arm64') {
            return System.LinuxArm64;
        } else if (arch === 'arm') {
            return System.LinuxArmHf;
        }

        try {
            const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
            if (osRelease.includes('bookworm')) {
                return System.LinuxBookworm;
            } else if (osRelease.includes('Ubuntu')) {
                return System.Ubuntu;
            }
        } catch (err) {
            console.error('Impossibile leggere /etc/os-release:', err.message);
        }
    }
}

export const runCommand = (command: string, args: string[], console: Console) => {
    return new Promise((resolve, reject) => {
        console.log(`Running command: ${command} ${args.join(' ')}`);

        const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'] });

        child.stdout.on('data', (data) => {
            console.log(data.toString());
            // process.stdout.write(data);
        });

        child.stderr.on('data', (data) => {
            console.log(data.toString());
            // process.stderr.write(data);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(`Command completed successfully with exit code: ${code}`);
            } else {
                reject(new Error(`Command failed with exit code: ${code}`));
            }
        });

        child.on('error', (error) => {
            reject(error);
        });
    });
}
