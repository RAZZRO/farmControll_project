
const pool = require('../config/db');
const getTodayJalali = require('../config/getDate');
const client = require('../config/mqtt');
const bcrypt = require('bcrypt');

//const jwt = require('jsonwebtoken');
//const bcrypt = require('bcrypt');
//const secretKey = 'secretKey';

const controller = {};



controller.new_user = async (req, res) => {
    const data = req.body;
    const [todayJalali, time] = getTodayJalali();

    try {
        const password = Math.random().toString(36).slice(-10);
        const hashedPassword = await bcrypt.hash(password, 10);

        const sql = 'SELECT * FROM create_user_with_device($1, $2, $3, $4, $5, $6, $7)';
        const values = [
            data.nationalCode,
            data.phone,
            data.firstName,
            data.lastName,
            todayJalali,
            hashedPassword,
            data.deviceName,
        ];
        console.log(values);


        const result = await pool.query(sql, values);

        if (result.rows.length > 0) {

            const username = data.nationalCode
            //console.log("Username:", username);
            return res.status(200).json({ username, password });
        } else {
            console.log("User not inserted");
            return res.status(400).json({ message: 'User registration failed' });
        }
    } catch (err) {
        if (err.message.includes('User already exists')) {
            return res.status(400).json({ message: 'User already exists' });
        }
        console.error(err.stack);
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

}
controller.edit_device = async (req, res) => {
    const data = req.body;

    try {

        let text = 'UPDATE mqtt SET  device_name = $2  WHERE username = $1 RETURNING username';

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

}

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

}

controller.delete_user = async (req, res) => {
    const data = req.body;

    try {

        let text = 'SELECT delete_user_and_mqtt($1) AS message';

        let values = [data.nationalCode];
        console.log('Query:', text);
        console.log('Values:', values);

        const result = await pool.query(text, values);
        console.log(result.rows[0].message);
        res.status(200).json({ message: 'delete done succesfully' });


    } catch (err) {
        console.error('error in deleting', err);
        res.json({ message: err })
    }

}
controller.delete_device = async (req, res) => {
    const data = req.body;

    try {

        let text = 'SELECT delete_device($1) AS message';

        let values = [data.identifier];
        console.log('Query:', text);
        console.log('Values:', values);

        const result = await pool.query(text, values);
        console.log(result.rows[0].message);
        res.status(200).json({ message: 'delete done succesfully' });


    } catch (err) {
        console.error('error in deleting', err);
        res.status(500).json({ message: err })
    }

}


controller.new_topic = async (req, res) => {
    const data = req.body;

    try {

        let text = 'SELECT * FROM users WHERE id = $1';
        let values = [
            data.nationalCode,
        ];

        const result = await pool.query(text, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'کد ملی در سیستم ثبت نشده است' });
        }
        console.log(result.rowCount);
        const [todayJalali, time] = getTodayJalali();

        const query = 'INSERT INTO mqtt (user_id, start_date,device_name) VALUES ($1,$2,$3) RETURNING username';
        const mqttValues = [
            data.nationalCode,
            `${todayJalali}`,
            data.deviceName
        ];

        const result2 = await pool.query(query, mqttValues);
        if (result2.rowCount > 0) {
            const username = result2.rows[0].username;
            console.log("Username:", username);
            res.json({ username });
        } else {
            console.log("MQTT Record Not Inserted");
            res.status(400).json({ message: 'MQTT registration failed' });
        }
    } catch (err) {
        console.error(err.stack);
        res.status(500).json({ message: 'Internal Server Error' });
    }
};

controller.all_users = async (req, res) => {
    try {
        const result = await pool.query('SELECT id, phone, first_name, last_name, start_date FROM users');
        res.json(result.rows
        );
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

    let text = 'SELECT * FROM mqtt WHERE user_id = $1';
    let values = [
        data.nationalCode,
    ];

    const result = await pool.query(text, values);
    res.json(result.rows);

}

module.exports = controller;

