const pool = require('../config/db');
const connectMqtt = require('../config/mqtt');
const getTodayJalali = require('../config/getDate');
const { exec } = require('child_process');




const mqttClients = {};

function publishMessage(user_id, topic, message) {

    const userClient = mqttClients[user_id];
    if (!userClient) {
        console.error(`No MQTT client found for user ${user_id}`);
        return;
    }

    userClient.client.publish(topic, message, (err) => {
        if (err) {
            console.error(`Failed to publish message to ${topic}:`, err);
        } else {
            console.log(`Published to ${topic}: ${message}`);
        }
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

function addMQTTUser(username, password) {
    return new Promise((resolve, reject) => {
        console.log(`Adding MQTT user ${username} with password ${password}`);
        
      const cmd = `sudo /usr/bin/mosquitto_passwd -b /etc/mosquitto/passwd ${username} ${password}`;
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          console.error(`خطا: ${error.message}`);
          return resolve(false); // reject نکن تا جلوی crash رو بگیری
        }
        console.log(`خروجی: ${stdout}`);
        resolve(true);
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
        SELECT u.id AS user_id,u.mqtt_pass, m.identifier
        FROM users u
        JOIN mqtt m ON u.id = m.user_id
      `);

        const userMap = new Map();

        for (const row of res.rows) {
            const { user_id, password, identifier } = row;
            if (!userMap.has(user_id)) {
                userMap.set(user_id, {
                    user_id,
                    password,
                    identifiers: [],
                });
            }
            userMap.get(user_id).identifiers.push(identifier);
        }

        for (const userData of userMap.values()) {
            await createMqttClientForAllUsers(userData.user_id, userData.password, userData.identifiers);
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




module.exports = {
    initAllUserMqttClients,
    createMqttClientForNewUser,
    addTopicToExistingMqttClient,
    publishMessage,
    mqttClients
};



