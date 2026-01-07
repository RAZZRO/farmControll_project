const moment = require('jalali-moment');

class MessageHandler {
    constructor(db) {
        this.db = db;
    }

    /* ===================== ENTRY POINT ===================== */

    async handle(user_id, topic, rawMessage) {


        let message;

        try {
            const normalized = this.normalizeHardwareJson(rawMessage);
            message = JSON.parse(normalized);
        } catch (err) {
            console.error('Invalid hardware JSON:', err);
            return;
        }

        const { sender, type, payload, timeStamp } = message;
        console.log(timeStamp);


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
                //  await this.logMessage('refresh data received', message, topic);

                await this.handleRefresh(user_id, topic, payload, timeStamp);
                break;

            case "irrigation":
                //await this.logMessage('irrigation data received', message, topic);

                await this.handleIrrigation(topic, payload, timeStamp);
                break;

            case "relay":
                //    await this.logMessage('Relay data received', message, topic);

                await this.handleRelay(topic, payload, timeStamp);
                break;

            case "alarm":
                //  await this.logMessage('Alarm data received', message, topic);

                await this.handleAlarm(topic, payload, timeStamp);
                break;

            case "synchronization":
                //   await this.logMessage('Synchronization received', message, topic);

                await this.sendSynchronization(user_id, topic);
                break;

            default:
                //         await this.logMessage(client, 'error', topic, `No handler for sender=${sender}, type=${type}`, message, topic);

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
        const { global, status, command_id } = payload;
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
                        status,
                        ts,
                        command_id

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
                        status,
                        ts,
                        command_id
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

    async insertIrrigation(client, deviceId, rtu_id, data, status, ts, commandId) {
        console.log({
            deviceId,
            rtu_id,
            mode: data.mode,
            status,
            ts,
            commandId
        });

        await client.query(`
            INSERT INTO irrigation_data (
                device_id, rtu_id, mode, status,
                start_date, stop_date, duration, timestamp, command_id
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        `, [
            deviceId,
            rtu_id,
            data.mode,
            status,
            data.start_date || null,
            data.stop_date || null,
            data.duration || null,
            ts,
            commandId || null
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
        console.log(Date.now());
        console.log(ts.getTime());
        console.log("diff");
        console.log(diff >= 30 * 60 * 1000);

        return diff >= 30 * 60 * 1000;
    }

    async getDeviceRtus(deviceId, client) {
        const res = await client.query(
            'SELECT rtu_id FROM rtu_data WHERE device_id=$1',
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
        console.log(clock);


        const body = {
            sender: 'backend',
            type: 'synchronization',
            payload: {},
            timeStamp: { date, clock }
        };

        const { publishMessage } = require('./mqttManager');
        await publishMessage(user_id, topic, JSON.stringify(body));
    }


    normalizeHardwareJson(raw) {
        let str = raw.toString().trim();

        // اگر دوبار stringify شده باشد
        if (str.startsWith('"') && str.endsWith('"')) {
            str = str.slice(1, -1);
        }

        // اصلاح \" → "
        str = str.replace(/\\"/g, '"');

        // اصلاح \"
        str = str.replace(/\\+"/g, '"');

        // اصلاح موارد خاص stop_date":\"
        str = str.replace(/":\\+"/g, '":"');

        return str;
    }

    validateMessage(msg) {
        return msg.sender && msg.type && msg.payload;
    }


}


module.exports = MessageHandler;