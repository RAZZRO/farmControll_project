require('dotenv').config();
const mqtt = require('mqtt');

const connectMqtt = ({ username, password }) => {
  const client = mqtt.connect(process.env.MQTT_URL, {
    username,
    password,
    keepalive: 60,
    reconnectPeriod: 1000,
  });

  return client;
};

module.exports = connectMqtt;
