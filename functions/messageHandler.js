const { default: handle } = require("mqtt/lib/handlers/index");


class MessageHandler {
    constructor(db) {
        this.db = db;
    }

    async handle(user_id, topic, rawMessage) {
        let message;
        try {
            message = JSON.parse(rawMessage.toString());
        } catch (err) {
            console.error("JSON parse error:", err);
            return;
        }

        const { sender, type } = message;
        if (sender === "hardWare" && type === "data") {
            return await this.handleHardwareData(user_id, topic, message);
        }

        // سایر شرایط
        if (sender === "hardWare" && type === "status") {
            return await this.handleHardwareStatus(user_id, topic, message);
        }

        console.warn(`No handler for sender=${sender}, type=${type}`);
    }

    async handleHardwareData(user_id, topic, message) {
        const { payload, timeStamp } = message;
        const { date, clock } = timeStamp;
        const timestamp = new Date(`${date}T${clock}`);

        const client = await this.db.connect();

        try {
            await client.query('BEGIN');

            for (const [rtuKey, data] of Object.entries(payload)) {
                const rtu_id = parseInt(rtuKey.replace("rtu", ""));

                const query = `
                INSERT INTO rtu_data (
                    device_id, rtu_id, humidity, airtemperature, moisture, ph, ec, co2, soiltemperature, timestamp
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`;

                const mqttValues = [
                    topic,
                    rtu_id,
                    data.humidity,
                    data.airTemperature,
                    data.moisture,
                    data.ph,
                    data.EC,
                    data.co2,
                    data.soilTemperature,
                    timestamp, // زمان کامل به عنوان TIMESTAMP

                ];

                await client.query(query, mqttValues);
            }

            await client.query('COMMIT');
            console.log(`All sensor data saved successfully for topic ${topic}`);
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(`Error inserting sensor data for topic ${topic}:`, err);
        } finally {
            client.release();
        }
    }
    async handleHardwareStatus(user_id, topic, message) {
        // ذخیره وضعیت سخت‌افزار یا به‌روزرسانی آن در دیتابیس
    }
}

module.exports = MessageHandler;
