const pool = require('../config/db');
const connectMqtt = require('../config/mqtt');
const getTodayJalali = require('../config/getDate');
const { exec } = require('child_process');




const mqttClients = {};

function publishMessage(user_id, topic, message) {
    return new Promise((resolve, reject) => {
        const userClient = mqttClients[user_id];
        if (!userClient) {
            console.error(`No MQTT client found for user ${user_id}`);
            return resolve(false);
        }

        if (!userClient.topics.includes(topic)) {
            console.warn(`User ${user_id} is not allowed to publish to topic ${topic}`);
            return resolve(false);
        }

        userClient.client.publish(topic, message, (err) => {
            if (err) {
                console.error(`Failed to publish message to ${topic}:`, err);
                return resolve(false);
            } else {
                console.log(`Published to ${topic}: ${message}`);
                return resolve(true);
            }
        });
    });
}



async function createMqttClientForNewUser(user_id, password, identifiers = []) {
    console.log(user_id, password, identifiers);

    if (mqttClients[user_id]) {
        console.log(`MQTT client already exists for user ${user_id}`);
        return false;
    }

    const result = await addMQTTUser(user_id, password);

    if (!result) {
        console.error(`Failed to add MQTT user for user ${user_id}`);
        return false;
    }

    const client = connectMqtt({ username: user_id, password });
    mqttClients[user_id] = { client, topics: [] };

    client.on('connect', () => {
        console.log(`MQTT connected for user ${user_id}`);

        for (const identifier of identifiers) {
            client.subscribe(identifier, (err) => {
                if (err) {
                    console.error(`Failed to subscribe ${user_id} to ${identifier}`, err);
                } else {
                    console.log(`[${user_id}] Subscribed to ${identifier}`);
                    mqttClients[user_id].topics.push(identifier);
                }
            });
        }
    });

    client.on('message', async (topic, message) => {
        const text = message.toString();
        const timestamp = getTodayJalali().join(' ');
        try {
            await pool.query(
                `INSERT INTO messages (user_id, identifier, message, timestamp) VALUES ($1, $2, $3, $4)`,
                [user_id, topic, text, timestamp]
            );
            console.log(`[${user_id}] ${topic}: ${text}`);
        } catch (err) {
            console.error(`Error saving message for ${user_id}:`, err.message);
        }
    });

    client.on('error', (err) => {
        console.error(`MQTT error for ${user_id}:`, err.message);
    });

    return true;
}


function removeUserMqttClient(user_id) {
    const userClient = mqttClients[user_id];
    if (!userClient) {
        console.error(`MQTT client not found for user ${user_id}`);
        return false;
    }

    const unsubscribeFromTopics = () => {
        const promises = userClient.topics.map(topic => {
            return new Promise((resolve, reject) => {
                userClient.client.unsubscribe(topic, (err) => {
                    if (err) {
                        console.error(`Error unsubscribing ${user_id} from ${topic}:`, err);
                        return reject(err);
                    }
                    resolve();
                });
            });
        });

        return Promise.allSettled(promises);
    };

    const endClientConnection = () => {
        return new Promise((resolve) => {
            userClient.client.end(true, () => {
                console.log(`MQTT connection closed for user ${user_id}`);
                resolve();
            });
        });
    };

    const removeFromPasswd = () => {
        const cmd = `sudo /usr/bin/mosquitto_passwd -D /etc/mosquitto/passwd ${user_id}`;
        exec(cmd, (error) => {
            if (error) {
                console.error(`Error removing MQTT user ${user_id}:`, error.message);
            } else {
                console.log(`Removed MQTT user ${user_id} from passwd`);
                const restartCmd = 'kill -HUP $(pidof mosquitto)';
                exec(restartCmd, (restartError) => {
                    if (restartError) {
                        console.error(`Error restarting Mosquitto: ${restartError.message}`);
                    } else {
                        console.log(`Mosquitto restarted after user removal`);
                    }
                });
            }
        });
    };

    (async () => {
        if (userClient.client.connected) {
            await unsubscribeFromTopics();
            await endClientConnection();
        } else {
            console.warn(`Client already disconnected for user ${user_id}, skipping unsubscribe and end.`);
        }

        delete mqttClients[user_id];
        console.log(`Removed ${user_id} from mqttClients`);

        removeFromPasswd();
    })();

    return true;
}




function addMQTTUser(username, password) {
    return new Promise((resolve, reject) => {
        console.log(`Adding MQTT user ${username} with password ${password}`);

        const cmd = `sudo /usr/bin/mosquitto_passwd -b /etc/mosquitto/passwd ${username} ${password}`;

        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error: ${error.message}`);
                return resolve(false); // prevent crash, do not reject
            }
            console.log(`Output: ${stdout}`);

            // Restart Mosquitto service to apply changes
            const restartCmd = 'kill -HUP $(pidof mosquitto)';
            exec(restartCmd, (restartError, restartStdout, restartStderr) => {
                if (restartError) {
                    console.error(`Error restarting Mosquitto: ${restartError.message}`);
                    return resolve(false);
                }
                console.log(`Mosquitto restarted successfully: ${restartStdout}`);
                resolve(true);
            });
        });
    });
}


async function createMqttClientForAllUsers(user_id, password, identifiers = []) {
    console.log(user_id, password, identifiers);

    if (mqttClients[user_id]) {
        console.log(`MQTT client already exists for user ${user_id}`);
        return false;
    }

    const client = connectMqtt({ username: user_id, password });
    mqttClients[user_id] = { client, topics: [] };

    client.on('connect', () => {
        console.log(`MQTT connected for user ${user_id}`);

        for (const identifier of identifiers) {
            client.subscribe(identifier, (err) => {
                if (err) {
                    console.error(`Failed to subscribe ${user_id} to ${identifier}`, err);
                } else {
                    console.log(`[${user_id}] Subscribed to ${identifier}`);
                    mqttClients[user_id].topics.push(identifier);
                }
            });
        }
    });

    client.on('message', async (topic, message) => {
        const text = message.toString();
        const timestamp = getTodayJalali().join(' ');
        try {
            await pool.query(
                `INSERT INTO messages (user_id, identifier, message, timestamp) VALUES ($1, $2, $3, $4)`,
                [user_id, topic, text, timestamp]
            );
            console.log(`[${user_id}] ${topic}: ${text}`);
        } catch (err) {
            console.error(`Error saving message for ${user_id}:`, err.message);
        }
    });

    client.on('error', (err) => {
        console.error(`MQTT error for ${user_id}:`, err.message);
    });

    return true;
}


async function initAllUserMqttClients() {
    try {
        const res = await pool.query(`
        SELECT u.id AS user_id, u.mqtt_pass, m.identifier
        FROM users u
        JOIN mqtt m ON u.id = m.user_id
      `);
        //   SELECT u.id AS user_id, u.mqtt_pass AS password, m.identifier
        //   FROM users u
        //   JOIN mqtt m ON u.id = m.user_id

        const userMap = new Map();

        for (const row of res.rows) {
            const { user_id, mqtt_pass, identifier } = row;
            console.log("mqtt_pass is :");
            console.log("++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++");
            console.log(res.rows);



            console.log(mqtt_pass);

            if (!userMap.has(user_id)) {
                userMap.set(user_id, {
                    user_id,
                    mqtt_pass,
                    identifiers: [],
                });
            }
            userMap.get(user_id).identifiers.push(identifier);
        }

        for (const userData of userMap.values()) {
            console.log(`Creating MQTT client for user ${userData.user_id} with mqtt_pass ${userData.mqtt_pass}`);

            await createMqttClientForAllUsers(userData.user_id, userData.mqtt_pass, userData.identifiers);
        }

    } catch (err) {
        console.error('Error initializing MQTT clients:', err);
    }
}

async function addTopicToExistingMqttClient(user_id, newIdentifier) {
    const userClient = mqttClients[user_id];
    if (!userClient) {
        console.error(`MQTT client not found for user ${user_id}`);
        return false;
    }

    if (userClient.topics.includes(newIdentifier)) {
        console.log(`User ${user_id} already subscribed to ${newIdentifier}`);
        return true;
    }

    userClient.client.subscribe(newIdentifier, (err) => {
        if (err) {
            console.error(`Failed to subscribe ${user_id} to ${newIdentifier}`, err);
        } else {
            userClient.topics.push(newIdentifier);
            console.log(`[${user_id}] Subscribed to new topic ${newIdentifier}`);
        }
    });

    return true;
}

function removeTopicFromMqttClient(user_id, identifier) {
    const userClient = mqttClients[user_id];
    if (!userClient) {
        console.error(`MQTT client not found for user ${user_id}`);
        return false;
    }

    if (!userClient.topics.includes(identifier)) {
        console.log(`User ${user_id} is not subscribed to ${identifier}`);
        return true;
    }

    userClient.client.unsubscribe(identifier, (err) => {
        if (err) {
            console.error(`Failed to unsubscribe ${user_id} from ${identifier}`, err);
        } else {
            userClient.topics = userClient.topics.filter(topic => topic !== identifier);
            console.log(`[${user_id}] Unsubscribed from topic ${identifier}`);
        }
    });

    return true;
}





module.exports = {
    initAllUserMqttClients,
    createMqttClientForNewUser,
    removeUserMqttClient,
    addTopicToExistingMqttClient,
    removeTopicFromMqttClient,
    publishMessage,
    mqttClients
};



