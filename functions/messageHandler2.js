const moment = require('jalali-moment');


class MessageHandler {
    constructor(db) {
        this.db = db;
    }

    /* ===================== ENTRY POINT ===================== */

    async handle(user_id, topic, rawMessage) {
        let message;

        try {
            message = JSON.parse(rawMessage.toString());
        } catch (err) {
            console.error("JSON parse error:", err);
            return;
        }
        const { sender, type, payload, timeStamp } = message;

        if (sender !== 'hardWare') {
            await this.logMessage(
                `message ignored (sender=${sender})`,
                message,
                topic
            );
            return;
        }
        if (!this.validateMessage(message)) return;


        const ts = this.parseTimestamp(timeStamp);

        if (!this.isMessageTimeValid(ts)) {
            await this.logMessage(
                'message rejected (timestamp)',
                message,
                topic
            );
            await this.sendSynchronization(user_id, topic);
            return;
        }
        await this.routeMessage(user_id, topic, type, payload, ts, sender);
    }

    /* ===================== ROUTER ===================== */

    async routeMessage(user_id, topic, type, payload, timeStamp, sender) {

        switch (type) {
            case "refresh":
                await this.logMessage('refresh data received', message, topic);

                await this.handleRefresh(user_id, topic, payload, timeStamp);
                break;

            case "irrigation":
                await this.logMessage('irrigation data received', message, topic);

                await this.handleIrrigation(topic, payload, timeStamp);
                break;

            case "relay":
                await this.logMessage('Relay data received', message, topic);

                await this.handleRelay(topic, payload, timeStamp);
                break;


            case "alarm":
                await this.logMessage('Alarm data received', message, topic);

                await this.handleAlarm(topic, payload, timeStamp);
                break;

            case "synchronization":
                await this.logMessage('Synchronization received', message, topic);

                await this.sendSynchronization(user_id, topic);
                break;

            default:
                await this.logMessage(client, 'error', topic, `No handler for sender=${sender}, type=${type}`, message, topic);

                console.warn(`No handler for sender=${sender}, type=${type}`);
                break;
        }


    }

    /* ===================== REFRESH ===================== */

    async handleRefresh(user_id, topic, payload, ts) {
        if (payload.data)
            await this.handleRTUData(topic, payload.data, ts);

        if (payload.irrigation)
            await this.handleIrrigation(topic, payload.irrigation, ts);

        if (payload.centralData)
            await this.handleCentral(topic, payload.centralData, ts);

        if (payload.relay)
            await this.handleRelay(topic, payload.relay, ts);
    }

    /* ===================== RTU DATA ===================== */
    async handleRTUData(deviceId, payload, ts) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');

            for (const [rtuKey, raw] of Object.entries(payload)) {
                const rtu_id = Number(rtuKey.replace('rtu', ''));
                const data = JSON.parse(raw);

                await client.query(`
                    INSERT INTO rtu_data (
                        device_id, rtu_id, humidity, airtemperature,
                        moisture, ph, ec, co2, soiltemperature, timestamp
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                `, [
                    deviceId,
                    rtu_id,
                    data.humidity,
                    data.airTemperature,
                    data.moisture,
                    data.ph,
                    data.EC,
                    data.co2,
                    data.soilTemperature,
                    ts
                ]);
            }

            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            console.error(e);
        } finally {
            client.release();
        }
    }

    /* ===================== IRRIGATION ===================== */
    async handleIrrigation(deviceId, payload, ts) {
        const client = await this.db.connect();
        const rtus = await this.getDeviceRtus(deviceId, client);
        const global = payload.global;
        const globalMode = global?.mode;

        try {
            await client.query('BEGIN');

            if (globalMode && globalMode !== 'off') {
                // global → all rtus
                for (const rtu of rtus) {
                    await this.insertIrrigation(
                        client,
                        deviceId,
                        rtu,
                        global,
                        payload.status,
                        ts
                    );
                }
            } else {
                // per rtu
                for (const [key, data] of Object.entries(payload)) {
                    if (!key.startsWith('rtu')) continue;
                    const rtu_id = Number(key.replace('rtu', ''));

                    await this.insertIrrigation(
                        client,
                        deviceId,
                        rtu_id,
                        data,
                        payload.status,
                        ts
                    );
                }
            }

            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            console.error(e);
        } finally {
            client.release();
        }
    }

    async insertIrrigation(client, deviceId, rtu_id, data, status, ts) {
        await client.query(`
            INSERT INTO irrigation_data (
                device_id, rtu_id, mode, status,
                start_date, stop_date, duration, timestamp, command_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        `, [
            deviceId,
            rtu_id,
            data.mode,
            status,
            data.start_date || null,
            data.stop_date || null,
            data.duration || null,
            ts,
            data.command_id || null
        ]);
    }

    /* ===================== RELAY ===================== */
    async handleRelay(deviceId, payload, ts) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');

            for (const [key, value] of Object.entries(payload)) {
                if (key === 'status') continue;

                await client.query(`
                    INSERT INTO relay_data (
                        device_id, relay_id, relay_state,
                        timestamp, message_status
                    ) VALUES ($1,$2,$3,$4,$5)
                `, [
                    deviceId,
                    key,
                    value,
                    ts,
                    payload.status
                ]);
            }

            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            console.error(e);
        } finally {
            client.release();
        }
    }

    /* ===================== CENTRAL + STACK ===================== */
    async handleCentral(deviceId, payload, ts) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');

            await client.query(`
                INSERT INTO central_data (
                    device_id, battery_charge, sim_charge,
                    internet, rain, wind_direction, timestamp
                ) VALUES ($1,$2,$3,$4,$5,$6,$7)
            `, [
                deviceId,
                payload.battery_charge,
                payload.sim_charge,
                payload.Internet,
                payload.rain,
                payload.wind_direction,
                ts
            ]);

            for (let i = 1; i <= 10; i++) {
                if (payload[`W${i}`] !== undefined) {
                    await client.query(`
                        INSERT INTO stack_data (
                            device_id, stack_id,
                            w_level, electricity_level,
                            ph_level, timestamp
                        ) VALUES ($1,$2,$3,$4,$5,$6)
                    `, [
                        deviceId,
                        `stack${i}`,
                        payload[`W${i}`],
                        payload[`EC${i}`],
                        payload[`PH${i}`],
                        ts
                    ]);
                }
            }

            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            console.error(e);
        } finally {
            client.release();
        }
    }

    /* ===================== ALARM ===================== */
    async handleAlarm(deviceId, payload, ts) {
        await this.db.query(`
            INSERT INTO alarm_data (
                device_id, message, alarm_date, timestamp
            ) VALUES ($1,$2,$3,$4)
        `, [
            deviceId,
            payload.message,
            payload.alarm_date,
            ts
        ]);
    }

    /* ===================== HELPERS ===================== */
    parseTimestamp(ts) {
        if (!ts) return new Date();
        return new Date(ts.replace(/\//g, '-'));
    }

    isMessageTimeValid(ts) {
        const diff = Math.abs(Date.now() - ts.getTime());
        return diff <= 30 * 60 * 1000;
    }

    async getDeviceRtus(deviceId, client) {
        const res = await client.query(
            'SELECT rtu_id FROM device_rtu WHERE device_id=$1',
            [deviceId]
        );
        return res.rows.map(r => r.rtu_id);
    }

    async logMessage(text, data, deviceId) {
        await this.db.query(`
            INSERT INTO logs (log_type, source, message, data, device_id)
            VALUES ('message','hardware',$1,$2,$3)
        `, [text, JSON.stringify(data), deviceId]);
    }

    async sendSynchronization(user_id, topic) {
        const date = moment().format('YYYY-MM-DD');
        const clock = moment().locale('fa').utcOffset(210).format('HH:mm:ss');

        const body = {
            sender: 'backend',
            type: 'synchronization',
            payload: {},
            timeStamp: { date, clock }
        };

        const { publishMessage } = require('./mqttManager');
        await publishMessage(user_id, topic, JSON.stringify(body));
    }

    validateMessage(msg) {
        return msg.sender && msg.type && msg.payload;
    }
}

module.exports = MessageHandler;












































const { default: handle } = require("mqtt/lib/handlers/index");
const moment = require('jalali-moment');
//const mqttManager = require('./mqttManager');




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

        const { sender, type, timeStamp } = message;

        const fullTimeStamp = timeStamp?.date && timeStamp?.clock
            ? `${timeStamp.date} ${timeStamp.clock}`
            : null;

        if (!this.isMessageTimeValid(fullTimeStamp)) {
            console.warn(`⛔ Message ignored due to invalid timestamp for topic ${topic}`);

            await this.logMessage(
                'message rejected due to timestamp difference',
                message,
                topic
            );

            await this.handlesynchronization(user_id, topic);
            return; // ⛔ پیام ذخیره نمی‌شود
        }

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
            const { publishMessage } = require('./mqttManager');
            // await publishMessage(user.id, deviceId, JSON.stringify(message));


            const result = await publishMessage(user_id, topic, JSON.stringify(body));
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

    isMessageTimeValid(timeStamp) {
        if (!timeStamp) return false;

        const messageTime = new Date(timeStamp.replace(/\//g, '-'));
        if (isNaN(messageTime.getTime())) return false;

        const now = new Date();
        const diffMs = Math.abs(now - messageTime);

        const THIRTY_MINUTES = 30 * 60 * 1000;
        return diffMs <= THIRTY_MINUTES;
    }



}



module.exports = MessageHandler;





// const alarmDate = timeStamp
//     ? new Date(timeStamp.replace(/\//g, '-'))
//     : new Date();