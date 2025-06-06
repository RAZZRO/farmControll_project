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

        try {
            for (const [rtuKey, data] of Object.entries(payload)) {
                // تبدیل rtu1 -> 1, rtu2 -> 2, ...
                const rtu_id = parseInt(rtuKey.replace("rtu", ""));

                await client.query(
                    `INSERT INTO rtu_data (
            device_id, rtu_id, humidity, airtemperature, moisture, ph, ec, co2, soiltemperature, date, clock
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
                    [
                        topic,
                        rtu_id,
                        data.humidity,
                        data.airTemperature,
                        data.moisture,
                        data.ph,
                        data.EC,
                        data.co2,
                        data.soilTemperature,
                        timeStamp.date,
                        timeStamp.clock
                    ]
                );
            }

            console.log(`Sensor data saved successfully for topic ${topic}`);
        } catch (err) {
            console.error("Error inserting sensor data:", err);
        } finally {
            client.release();
        }
    }
    async handleHardwareStatus(user_id, topic, message) {
        // ذخیره وضعیت سخت‌افزار یا به‌روزرسانی آن در دیتابیس
    }
}

module.exports = MessageHandler;
