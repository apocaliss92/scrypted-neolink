import { connect, Client } from 'mqtt';

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
    const sirenControlTopic = `neolink/${cameraName}/control/siren`;

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
        sirenControlTopic,
    }
}

export default class MqttClient {
    public mqttClient: Client;
    mqttPathmame: string;
    host: string;
    username: string;
    password: string;
    console: Console;
    topicLastValue: Record<string, any> = {};
    cameraName: string;

    constructor(host: string, username: string, password: string, cameraName: string) {
        this.host = host;
        this.username = username;
        this.password = password;
        this.cameraName = cameraName;
    }

    async disconnect() {
        if (this.mqttClient) {
            try {
                this.mqttClient.end(true);
            } catch (e) {
                this.console.log('Error closing MQTT connection', e);
            }
        }
    }

    async getMqttClient(console: Console, forceReconnect?: boolean): Promise<Client> {
        return new Promise((res, rej) => {
            const _connect = async () => {
                const client = connect(this.mqttPathmame, {
                    rejectUnauthorized: false,
                    username: this.username,
                    password: this.password,
                });
                client.setMaxListeners(Infinity);

                client.on('connect', data => {
                    console.log('Connected to mqtt', JSON.stringify(data));
                    this.mqttClient = client;
                    res(client);
                });

                client.on('error', data => {
                    console.log('Error connecting to mqtt', data);
                    this.mqttClient = undefined;
                    rej();
                });
            }

            if (!this.mqttClient || forceReconnect) {
                if (this.mqttClient) {
                    try {
                        this.mqttClient.end();
                    } catch (e) { }
                }
                const url = this.host;
                const urlWithoutPath = new URL(url);
                urlWithoutPath.pathname = '';

                this.mqttPathmame = urlWithoutPath.toString();
                if (!this.mqttPathmame.endsWith('/')) {
                    this.mqttPathmame = `${this.mqttPathmame}/`;
                }
                console.log('Starting MQTT connection', this.host, this.username, this.mqttPathmame);

                _connect();
            } else if (!this.mqttClient.connected) {
                console.log('MQTT disconnected. Reconnecting', this.host, this.username, this.mqttPathmame);

                _connect();
            } else {
                res(this.mqttClient);
            }
        })
    }

    async publish(console: Console, topic: string, inputValue: any, retain = true) {
        let value;
        try {
            if (typeof inputValue === 'object')
                value = JSON.stringify(inputValue);
            if (inputValue.constructor.name !== Buffer.name)
                value = inputValue.toString();
        } catch (e) {
            console.log(`Error parsing publish values: ${JSON.stringify({ topic, value })}`, e);
            return;
        }

        if (retain && this.topicLastValue[topic] === value) {
            console.debug(`Skipping publish, same as previous value: ${JSON.stringify({ topic, value, previousValue: this.topicLastValue[topic] })}`);

            return;
        }

        console.debug(`Publishing ${JSON.stringify({ topic, value })}`);
        const client = await this.getMqttClient(console);
        try {
            client.publish(topic, value, { retain });
        } catch (e) {
            console.log(`Error publishing to MQTT. Reconnecting. ${JSON.stringify({ topic, value })}`, e);
            await this.getMqttClient(console, true);
            client.publish(topic, value, { retain });
        } finally {
            if (retain) {
                this.topicLastValue[topic] = value;
            }
        }
    }

    async subscribeToNeolinkTopics(neolinkName: string, console: Console, cb: (batteryLevel?: number, preview?: string, presets?: string) => void) {
        const client = await this.getMqttClient(console);
        const batteryTopic = `neolink/${neolinkName}/status/battery_level`;
        const previewTopic = `neolink/${neolinkName}/status/preview`;
        const presetsTopic = `neolink/${neolinkName}/status/ptz/preset`;

        client.unsubscribe([batteryTopic, previewTopic, presetsTopic]);
        client.subscribe([batteryTopic, previewTopic, presetsTopic]);

        client.on('message', (messageTopic, message) => {
            const messageString = message.toString();
            if (messageTopic === batteryTopic) {
                cb(messageString !== 'null' ? JSON.parse(messageString) : undefined, undefined), undefined;
            }
            if (messageTopic === previewTopic) {
                cb(undefined, messageString, undefined);
            }
            if (messageTopic === presetsTopic) {
                this.console.log(messageTopic, messageString);
                cb(undefined, undefined, messageString);
            }
        })
    }

    async subscribeToNeolinkTopic(topic: string, console: Console, cb: (value?: any) => void) {
        const client = await this.getMqttClient(console);

        client.unsubscribe([topic]);
        client.subscribe([topic]);

        client.on('message', (messageTopic, message) => {
            const messageString = message.toString();
            if (messageTopic === topic) {
                cb(messageString);
            }
        })
    }

    async unsubscribeFromNeolinkTopic(topic: string, console: Console) {
        const client = await this.getMqttClient(console);

        client.unsubscribe(topic);
    }
}
