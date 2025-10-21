const { default: handle } = require("mqtt/lib/handlers/index");
const moment = require('jalali-moment');
const mqttManager = require('./mqttManager');




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
        console.log(sender);

        if (sender === "hardWare") {
            switch (type) {
                case "data":
                    await this.logMessage('rtu data received', message, topic);
                    await this.handleHardwareData(user_id, topic, message);
                    break;
                case "irrigation":
                    await this.logMessage('irrigation data received', message, topic);
                    await this.handleHardwareIrrigation(user_id, topic, message);
                    break;

                case "relay":
                    await this.logMessage('Relay data received', message, topic);
                    await this.handleHardwareRelay(user_id, topic, message);
                    break;

                case "centralData":
                    await this.logMessage('Central and stack data received', message, topic);
                    await this.handleHardwareCentralData(user_id, topic, message);
                    break;

                case "alarm":
                    await this.logMessage('Alarm data received and received', message, topic);
                    await this.handleHardwareAlarm(user_id, topic, message);
                    break;

                case "synchronization":
                    console.log("synchronization");

                    await this.handlesynchronization(user_id, topic);
                    break;

                default:
                    await this.logMessage(client, 'error', topic, `No handler for sender=${sender}, type=${type}`, message, topic);

                    console.warn(`No handler for sender=${sender}, type=${type}`);
                    break;
            }
        }

        // if (sender === "hardWare" && type === "data") {
        // }

        // // سایر شرایط
        // if (sender === "hardWare" && type === "status") {
        //     return await this.handleHardwareStatus(user_id, topic, message);
        // }

    }

    async logMessage(messageText, data, topic) {
        const client = await this.db.connect();

        try {
            await client.query(`
            INSERT INTO logs (
                log_type, 
                source, 
                message, 
                data, 
                device_id
            ) VALUES ($1, $2, $3, $4, $5)
        `, [
                "message",       // log_type
                "hardWare",      // source
                messageText,     // message
                JSON.stringify(data),            // data (JSON)
                topic            // device_id 
            ]);
        } catch (err) {
            console.error("Error inserting log:", err);
        } finally {
            client.release();
        }
    }

    async handleHardwareData(user_id, topic, message) {
        console.log(message);

        let { payload, timeStamp } = message;

        timeStamp = timeStamp
            ? new Date(timeStamp.replace(/\//g, '-'))
            : null;


        const client = await this.db.connect();

        try {
            await client.query('BEGIN');

            for (const [rtuKey, rawData] of Object.entries(payload)) {
                const rtu_id = parseInt(rtuKey.replace("rtu", ""));

                const data = JSON.parse(rawData);

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
                    timeStamp, // زمان کامل به عنوان TIMESTAMP

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

    async handleHardwareIrrigation(user_id, topic, message) {
        console.log(message);

        let { payload, timeStamp } = message;
        const global = payload.global;
        const global_mode = global?.mode;

        timeStamp = timeStamp
            ? new Date(timeStamp.replace(/\//g, '-'))
            : null;

        const client = await this.db.connect();

        try {
            await client.query('BEGIN');

            if (global_mode !== "off") {
                const data = global;


                const query = `
                INSERT INTO irrigation_data (
                    device_id, rtu_id, mode, status, start_date, stop_date, duration, timestamp
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`;

                const Values = [
                    topic,
                    null,
                    global_mode,
                    data.status,
                    data.start_date || null,
                    data.stop_date || null,
                    data.duration || null,
                    timeStamp,
                ];
                await client.query(query, Values);
                await client.query('COMMIT');
                console.log(`All sensor data saved successfully for topic ${topic}`);

            }
            else {
                const status = payload.status;

                for (const [rtuKey, rawData] of Object.entries(payload)) {
                    if (rtuKey === "status" || rtuKey === "global") continue;

                    const rtu_id = parseInt(rtuKey.replace("rtu", ""));

                    const data = rawData;

                    const query = `
                INSERT INTO irrigation_data (
                    device_id, rtu_id, mode, status, start_date, stop_date, duration, timestamp
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`;

                    const Values = [
                        topic,
                        rtu_id,
                        data.mode,
                        status,
                        data.start_date || null,
                        data.stop_date || null,
                        data.duration || null,
                        timeStamp,

                    ];

                    await client.query(query, Values);
                }

                await client.query('COMMIT');
                console.log(`All Irrigation data saved successfully for topic ${topic}`);
            }
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(`Error inserting Irrigation data for topic ${topic}:`, err);
        } finally {
            client.release();
        }
    }

    async handleHardwareRelay(user_id, topic, message) {
        console.log(message);

        let { payload, timeStamp } = message;
        timeStamp = timeStamp
            ? new Date(timeStamp.replace(/\//g, '-'))
            : null;
        const messageStatus = payload.status;

        const client = await this.db.connect();

        try {
            await client.query('BEGIN');

            for (const [key, value] of Object.entries(payload)) {
                if (key === "status") continue;
                const relay_id = key;
                const relay_state = value;
                const query = `
                INSERT INTO relay_data (
                    device_id, relay_id, relay_state, timestamp, message_status
                ) VALUES ($1, $2, $3, $4, $5)
            `;

                const Values = [
                    topic,
                    relay_id,
                    relay_state || false,
                    timeStamp,
                    messageStatus

                ];

                await client.query(query, Values);
            }

            await client.query('COMMIT');
            console.log(`Relay data saved successfully for topic ${topic}`);
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(`Error inserting relay data for topic ${topic}:`, err);
        } finally {
            client.release();
        }
    }

    async handleHardwareCentralData(user_id, topic, message) {
        console.log(message);

        let { payload, timeStamp } = message;
        timeStamp = timeStamp
            ? new Date(timeStamp.replace(/\//g, '-'))
            : {};

        const client = await this.db.connect();

        try {
            await client.query('BEGIN');

            const query =
                `SELECT insert_all_central_data($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`;

            const mqttValues = [
                topic,                          // device_id
                payload.battery_charge ?? null,
                payload.sim_charge ?? null,
                payload.Internet ?? null,
                payload.rain ?? null,
                payload.wind_direction ?? null,
                timeStamp,

                payload.W1 ?? null,            // tank1: water level
                payload.EC1 ?? null,           // tank1: EC
                payload.PH1 ?? null,           // tank1: pH

                payload.W2 ?? null,            // tank2: water level
                payload.EC2 ?? null,           // tank2: EC
                payload.PH2 ?? null
            ];

            await client.query(query, mqttValues);

            await client.query('COMMIT');
            console.log(`centralData and stackData saved for topic ${topic}`);
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(`Error handling central/stack data for topic ${topic}:`, err);
        } finally {
            client.release();
        }
    }


    async handleHardwareAlarm(user_id, topic, message) {
        console.log(message);

        let { payload, timeStamp } = message;
        timeStamp = timeStamp
            ? new Date(timeStamp.replace(/\//g, '-'))
            : {};

        const client = await this.db.connect();

        try {
            await client.query('BEGIN');


            const query = `
            INSERT INTO alarm_data (
                device_id,
                message,
                alarm_date,
                timestamp
            ) VALUES ($1, $2, $3, $4)
        `;

            const values = [
                topic,                   // device_id
                payload.message || '',
                payload.alarm_date || null,
                timeStamp
            ];

            await client.query(query, values);


            await client.query('COMMIT');
            console.log(`Alarm message saved successfully for topic ${topic}`);
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(`Error inserting Alarm message for topic ${topic}:`, err);
        } finally {
            client.release();
        }
    }

    async handlesynchronization(user_id, topic) {
        console.log("start");


        const miladiDate = moment().format('YYYY-MM-DD');
        const shamsiClock = moment().locale('fa').utcOffset(3.5 * 60).format('HH:mm:ss');
        const message = {
            "date": miladiDate,
            "clock": shamsiClock
        };

        await this.logMessage('synchronization received and received', message, topic);
        console.log("log saved");


        try {

            const body = {
                "sender": "backend",
                "type": "synchronization",
                "payload": {},
                "timeStamp": {
                    "date": miladiDate,
                    "clock": shamsiClock
                }
            };

            const result = await mqttManager.publishMessage(user_id, topic, JSON.stringify(body));
            console.log(result);


            // if (result.rowCount > 0) {
            //     await createLog({
            //         logType: 'device information',
            //         source: 'UserController',
            //         message: `device information send succesfully`,
            //         data: { data: result.rows[0] },
            //         deviceId: data.identifier
            //     });

            //     res.status(200).json(result.rows[0]);

            // } else {
            //     await createLog({
            //         logType: 'device information',
            //         source: 'UserController',
            //         message: `data not found`,
            //         deviceId: data.identifier
            //     });

            //     res.status(400).json({ message: 'data not found' });
            // }
        } catch (err) {
            console.error(' Database error:', err);
            // await createLog({
            //     logType: 'device information',
            //     source: 'UserController',
            //     message: `Internal Server Error`,
            //     data: { error: err.message },
            //     deviceId: data.identifier
            // });
            //res.status(500).json({ message: 'Internal Server Error' });

        }
    }


}



module.exports = MessageHandler;





// const alarmDate = timeStamp
//     ? new Date(timeStamp.replace(/\//g, '-'))
//     : new Date();