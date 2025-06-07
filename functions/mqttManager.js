const pool = require('../config/db');
const connectMqtt = require('../config/mqtt');
const getTodayJalali = require('../config/getDate');
const { exec } = require('child_process');

const MessageHandler = require('./messageHandler');
const handler = new MessageHandler(pool);

const mqttClients = {};

/** 
 * Publish a message to a topic for a given user.
 */
function publishMessage(user_id, topic, message) {
    const userClient = mqttClients[user_id];
    if (!userClient) {
        console.error(`No MQTT client found for user ${user_id}`);
        return false;
    }
    if (!userClient.topics.includes(topic)) {
        console.warn(`User ${user_id} is not allowed to publish to topic ${topic}`);
        return false;
    }
    return new Promise((resolve) => {
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


/**
 * Helper: subscribe client to a list of topics.
 */
async function subscribeTopics(client, user_id, topics = []) {
    const subscribePromises = topics.map(topic => {
        return new Promise((resolve, reject) => {
            client.subscribe(topic, (err) => {
                if (err) {
                    console.error(`Failed to subscribe ${user_id} to ${topic}`, err);
                    resolve(false);
                } else {
                    console.log(`[${user_id}] Subscribed to ${topic}`);
                    resolve(true);
                }
            });
        });
    });

    const results = await Promise.all(subscribePromises);
    return results;
}


/**
 * Add MQTT user to Mosquitto passwd file and reload service.
 */
function addMQTTUser(username, password) {
    return new Promise((resolve) => {
        console.log(`Adding MQTT user ${username}`);

        const cmd = `sudo /usr/bin/mosquitto_passwd -b /etc/mosquitto/passwd ${username} ${password}`;

        exec(cmd, (error) => {
            if (error) {
                console.error(`Error adding MQTT user ${username}:`, error.message);
                return resolve(false);
            }
            console.log(`MQTT user ${username} added.`);

            // Reload Mosquitto config
            exec('kill -HUP $(pidof mosquitto)', (restartError) => {
                if (restartError) {
                    console.error(`Error restarting Mosquitto: ${restartError.message}`);
                    return resolve(false);
                }
                console.log(`Mosquitto reloaded after adding user ${username}`);
                resolve(true);
            });
        });
    });
}

/**
 * Remove MQTT user from passwd and reload Mosquitto.
 */
function removeMQTTUser(username) {
    return new Promise((resolve) => {
        const cmd = `sudo /usr/bin/mosquitto_passwd -D /etc/mosquitto/passwd ${username}`;
        exec(cmd, (error) => {
            if (error) {
                console.error(`Error removing MQTT user ${username}:`, error.message);
                return resolve(false);
            }
            console.log(`Removed MQTT user ${username} from passwd.`);

            exec('kill -HUP $(pidof mosquitto)', (restartError) => {
                if (restartError) {
                    console.error(`Error restarting Mosquitto: ${restartError.message}`);
                    return resolve(false);
                }
                console.log(`Mosquitto reloaded after removing user ${username}`);
                resolve(true);
            });
        });
    });
}


/**
 * Create a new MQTT client for a user with given topics.
 */
async function createMqttClientForNewUser(user_id, password, identifiers = []) {

    if (mqttClients[user_id]) {
        console.log(`MQTT client already exists for user ${user_id}`);
        return false;
    }

    const added = await addMQTTUser(user_id, password);
    if (!added) {
        console.error(`Failed to add MQTT user ${user_id}`);
        return false;
    }


    const client = connectMqtt({ username: user_id, password });
    mqttClients[user_id] = { client, topics: [], listenerAdded: false };

    client.on('connect', async () => {
        console.log(`MQTT connected for user ${user_id}`);

        const results = await subscribeTopics(client, user_id, identifiers);

        mqttClients[user_id].topics = identifiers.filter((_, index) => results[index]);


        if (!mqttClients[user_id].listenerAdded) {
            client.on('message', async (topic, messageBuffer) => {
                const jsonString = messageBuffer.toString(); // تبدیل Buffer به رشته
                console.log("json string is : ",jsonString);
                
                const data = JSON.parse(jsonString);   // تبدیل رشته به JSON
                console.log(data);
                console.log("Received message:", messageBuffer);

                await handler.handle(user_id, topic, messageBuffer);
            });
            mqttClients[user_id].listenerAdded = true;
        }
    });

    client.on('error', (err) => {
        console.error(`MQTT error for ${user_id}:`, err.message);
    });

    return true;
}

/**
 * Create MQTT client for an existing user without adding to passwd.
 */
async function createMqttClientForAllUsers(user_id, password, identifiers = []) {

    if (mqttClients[user_id]) {
        console.log(`MQTT client already exists for user ${user_id}`);
        return false;
    }

    const client = connectMqtt({ username: user_id, password });
    mqttClients[user_id] = { client, topics: [], listenerAdded: false };

    client.on('connect', async () => {
        console.log(`MQTT connected for user ${user_id}`);

        const results = await subscribeTopics(client, user_id, identifiers);
        results.forEach((success, idx) => {
            if (success) mqttClients[user_id].topics.push(identifiers[idx]);
        });

    });

    if (!mqttClients[user_id].listenerAdded) {
        client.on('message', async (topic, messageBuffer) => {
            console.log("Received message:", messageBuffer);
            await handler.handle(user_id, topic, messageBuffer);
        });
        mqttClients[user_id].listenerAdded = true;
    }

    client.on('error', (err) => {
        console.error(`MQTT error for ${user_id}:`, err.message);
    });
    return true;
}

/**
 * Initialize MQTT clients for all users based on DB info.
 */
async function initAllUserMqttClients() {
    try {
        const res = await pool.query(`
        SELECT u.id AS user_id, u.mqtt_pass, m.identifier
        FROM users u
        JOIN devices m ON u.id = m.user_id
      `);


        const userMap = new Map();

        for (const { user_id, mqtt_pass, identifier } of res.rows) {
            if (!userMap.has(user_id)) {
                userMap.set(user_id, { user_id, mqtt_pass, identifiers: [] });
            }
            userMap.get(user_id).identifiers.push(identifier);
        }


        for (const { user_id, mqtt_pass, identifiers } of userMap.values()) {
            console.log(`Creating MQTT client for user ${user_id}`);
            await createMqttClientForAllUsers(user_id, mqtt_pass, identifiers);
        }

    } catch (err) {
        console.error('Error initializing MQTT clients:', err);
    }
}

/**
 * Add a new topic to an existing MQTT client.
 */
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

    return new Promise((resolve) => {
        userClient.client.subscribe(newIdentifier, (err) => {
            if (err) {
                console.error(`Failed to subscribe ${user_id} to ${newIdentifier}`, err);
                return resolve(false);
            }
            userClient.topics.push(newIdentifier);
            console.log(`[${user_id}] Subscribed to new topic ${newIdentifier}`);

            if (!userClient.listenerAdded) {
                userClient.client.on('message', async (topic, messageBuffer) => {
                    console.log("Received message:", messageBuffer);

                    await handler.handle(user_id, topic, messageBuffer);
                });
                userClient.listenerAdded = true;
            }
            resolve(true);
        });
    });
}

/**
 * Remove a user's MQTT client, unsubscribe from topics, disconnect client and remove credentials.
 */

async function removeUserMqttClient(user_id) {
    const userClient = mqttClients[user_id];
    if (!userClient) {
        console.error(`MQTT client not found for user ${user_id}`);
        return false;
    }

    const unsubscribeFromTopics = () => Promise.allSettled(
        userClient.topics.map(topic => new Promise((resolve, reject) => {
            userClient.client.unsubscribe(topic, (err) => {
                if (err) {
                    console.error(`Error unsubscribing ${user_id} from ${topic}:`, err);
                    return reject(err);
                }
                resolve();
            });
        }))
    );

    const endClientConnection = () => new Promise((resolve) => {
        userClient.client.end(true, () => {
            console.log(`MQTT connection closed for user ${user_id}`);
            resolve();
        });
    });

    if (userClient.client.connected) {
        await unsubscribeFromTopics();
        await endClientConnection();
    } else {
        console.warn(`Client already disconnected for user ${user_id}, skipping unsubscribe and end.`);
    }

    delete mqttClients[user_id];
    console.log(`Removed ${user_id} from mqttClients`);

    removeFromPasswd(user_id);

    return true;
}



/**
 * Remove a topic subscription from an MQTT client.
 */
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



