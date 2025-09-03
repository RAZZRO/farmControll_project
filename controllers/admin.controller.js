
const pool = require('../config/db');
const getTodayJalali = require('../config/getDate');
const client = require('../config/mqtt');
const bcrypt = require('bcrypt');
const moment = require('jalali-moment');

const mqttManager = require('../functions/mqttManager');

const controller = {};

controller.send_message = async (req, res) => {
    const data = req.body;

    const success = await mqttManager.publishMessage(data.nationalCode, data.identifier, "test");
    if (!success) {
        return res.status(400).json({ message: 'Failed to publish message' });
    }

    return res.status(200).json({ message: 'Message published successfully' });
};

controller.new_user = async (req, res) => {
    const data = req.body;
    const [todayJalali, time] = getTodayJalali();

    const client = await pool.connect();

    try {
        const password = Math.random().toString(36).slice(-10);
        const hashedPassword = await bcrypt.hash(password, 10);
        const mqtt_pass = Math.random().toString(36).slice(-10).replace(/[^\w\s]/gi, '');

        await client.query('BEGIN');

        const sql = 'SELECT * FROM create_user_with_device($1, $2, $3, $4, $5, $6, $7, $8)';
        const values = [
            data.nationalCode,
            data.phone,
            data.firstName,
            data.lastName,
            todayJalali,
            hashedPassword,
            data.deviceName,
            mqtt_pass,
        ];

        const result = await client.query(sql, values);

        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: 'failed to create user' });
        }

        const nationalCode = data.nationalCode;
        const identifiers = [result.rows[0].identifier];

        const mqttCreated = await mqttManager.createMqttClientForNewUser(nationalCode, mqtt_pass, identifiers);

        if (!mqttCreated) {
            await client.query('ROLLBACK');
            return res.status(500).json({ message: 'failed to create MQTT client' });
        }

        await client.query('COMMIT');

        return res.status(201).json({success: true, data: {nationalCode, password}});

    } catch (err) {
        await client.query('ROLLBACK');
        if (err.message.includes('User already exists')) {
            return res.status(400).json({ message: 'User already exists' });
        }
        console.error('error in creating user:', err.message);
        return res.status(500).json({ message: 'server error' });
    } finally {
        client.release();
    }
};

controller.new_device = async (req, res) => {
    const data = req.body;
    try {
        let text = 'SELECT * FROM users WHERE id = $1';
        let values = [data.nationalCode];

        const result = await pool.query(text, values);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'کد ملی در سیستم ثبت نشده است' });
        }
        const [todayJalali, time] = getTodayJalali();

        const query = 'INSERT INTO devices (user_id, start_date,device_name) VALUES ($1,$2,$3) RETURNING *';
        const mqttValues = [
            data.nationalCode,
            `${todayJalali}`,
            data.deviceName
        ];

        const result2 = await pool.query(query, mqttValues);
        if (result2.rowCount > 0) {
            const identifier = result2.rows[0].identifier;
            const result = await mqttManager.addTopicToExistingMqttClient(data.nationalCode, identifier);

            if (result) {
                res.status(200).json({ identifier });
            } else {
                res.status(404).json({ error: 'MQTT client failed to add topic' });
            }
        } else {
            res.status(400).json({ message: 'MQTT registration failed' });
        }
    } catch (err) {
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

controller.edit_user = async (req, res) => {
    const data = req.body;

    try {

        let text = 'UPDATE users SET  phone = $2 , first_name = $3 , last_name =  $4  WHERE id = $1 RETURNING id';

        let values = [
            data.nationalCode,
            data.phone,
            data.firstName,
            data.lastName

        ];
        console.log('Query:', text);
        console.log('Values:', values);


        const result = await pool.query(text, values);
        console.log(result);
        if (result.rowCount === 0) {
            console.log('nathonalCode not found');
            res.json({ message: "nathonalCode not found" });
        } else {
            console.log('edit done succesfully');
            res.status(200).json({ message: 'edit done succesfully' });


        }
    } catch (err) {
        res.json({ message: err });
        console.error('error in editting', err);
    }

};

controller.edit_device = async (req, res) => {
    const data = req.body;

    try {

        let text = 'UPDATE devices SET  device_name = $2  WHERE identifier = $1 RETURNING identifier';

        let values = [
            data.identifier,
            data.deviceName,
        ];
        console.log('Query:', text);
        console.log('Values:', values);


        const result = await pool.query(text, values);
        console.log(result);
        if (result.rowCount === 0) {
            console.log('device not found');
            res.status(404).json({ message: "device not found" });
        } else {
            console.log('edit done succesfully');
            res.status(200).json({ message: 'edit done succesfully' });


        }
    } catch (err) {
        res.json({ message: err });
        console.error('error in editting', err);
    }

};

controller.reset_password = async (req, res) => {
    const data = req.body;

    try {
        const password = Math.random().toString(36).slice(-10);

        const hashedPassword = await bcrypt.hash(password, 10);

        let text = 'UPDATE users SET  password = $2   WHERE id = $1 RETURNING password';

        let values = [
            data.nationalCode,
            hashedPassword

        ];
        // console.log('Query:', text);
        // console.log('Values:', values);


        const result = await pool.query(text, values);
        console.log(result.rowCount);

        // console.log(result);
        //res.status(200).json({ message:"the new password is:", password });
        if (result.rowCount === 0) {
            console.log('nathonalCode not found');
            return res.status(404).json({ message: "nationalCode not found" });
        } else {
            console.log('edit done succesfully');
            return res.status(200).json({ message: "the new password is:", password });
        }
    } catch (err) {
        res.json({ message: err });
        console.error('error in resetting password', err);
        return res.status(500).json({ message: err.message });
    }

};

controller.delete_user = async (req, res) => {
    const { nationalCode } = req.body;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const mqttDeleted = await mqttManager.removeUserMqttClient(nationalCode);

        if (!mqttDeleted) {
            await client.query('ROLLBACK');
            return res.status(500).json({ error: 'Failed to delete MQTT client' });
        }

        const text = 'SELECT delete_user_and_mqtt($1) AS message';
        const values = [nationalCode];
        const result = await client.query(text, values);

        const message = result.rows[0].message;
        console.log(message);

        await client.query('COMMIT');
        return res.status(200).json({ message: 'User and MQTT client deleted successfully' });

    } catch (err) {
        console.error('failed to delete data from database:', err.message);

        await client.query('ROLLBACK');

       // await createMqttClientForNewUser(nationalCode, password, identifiers);

        return res.status(500).json({
            error: 'Failed to delete data from database, MQTT client recreated',
            detail: err.message
        });

    } finally {
        client.release();
    }
};

controller.delete_device = async (req, res) => {
    const data = req.body;

    try {

        let text = 'SELECT delete_device($1) AS message';
        let values = [data.identifier];
        const result = await pool.query(text, values);
        const resData = result.rows[0]?.message;

        if (resData.success) {
            const nationalCode = resData.user_id;
            const identifier = resData.identifier;
            const result2 = await mqttManager.removeTopicFromMqttClient(nationalCode, data.identifier);

            if (result2) {
                res.status(200).json({ identifier });
            } else {
                res.status(404).json({ error: 'MQTT client failed to add topic' });
            }
        }

    } catch (err) {
        console.error('error in deleting', err);
        res.status(500).json({ message: err })
    }

};

controller.all_users = async (req, res) => {
    console.log("request started!");
    try {
        const result = await pool.query('SELECT id, phone, first_name, last_name, start_date FROM users');
        res.json(result.rows);

        console.log("request copleted");

    } catch (err) {
        console.error(err.stack);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error'
        });
    }
};

controller.all_topics = async (req, res) => {


    const data = req.body;

    let text = 'SELECT * FROM devices WHERE user_id = $1';
    let values = [data.nationalCode];

    const result = await pool.query(text, values);

    // تبدیل تاریخ‌ها به شمسی
    const rows = result.rows.map(row => {
        if (row.start_date) {
            row.start_date = moment(row.start_date).locale('fa').format('YYYY/MM/DD'); // مثال: 1404/06/11
        }
        return row;
    });

    res.json(rows);



};

module.exports = controller;

