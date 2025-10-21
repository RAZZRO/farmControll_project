const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const moment = require('jalali-moment');
const { createLog } = require('../functions/createLog');
const mqttManager = require('../functions/mqttManager');

const controller = {};

controller.login = async (req, res) => {
    const { nationalCode, password } = req.body;

    try {
        const text = 'SELECT * FROM users WHERE id = $1';
        const values = [nationalCode];

        const result = await pool.query(text, values);

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        const token = uuidv4();

        await pool.query('UPDATE users SET auth_token = $1 WHERE id = $2', [token, user.id]);

        await createLog({
            logType: 'Login',
            source: 'UserController',
            message: `User loged In`,
            data: { nationalCode: user.id },
        });

        res.json({
            success: true,
            message: `Welcome ${user.first_name}`,
            token,
            user: {
                id: user.id,
                firstName: user.first_name,
                lastName: user.last_name,
                phone: user.phone,
                startDate: user.start_date,
            }
        });

    } catch (err) {
        console.error(err);
        await createLog({
            logType: 'Login',
            source: 'UserController',
            message: `Internal server error`,
            data: { nationalCode: user.id, error: err.message },
        });
        res.status(500).json({ success: false, message: 'Internal server error' });
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
        const result = await pool.query(text, values);

        if (result.rowCount === 0) {
            console.log('device not found');
            await createLog({
                logType: 'edit device',
                source: 'UserController',
                message: `device not found`,
                data: { identifier: data.identifier, device_name: data.deviceName },
                deviceId: data.identifier
            });
            res.status(404).json({ success: false, message: "device not found" });
        } else {
            console.log('edit done succesfully');
            await createLog({
                logType: 'edit device',
                source: 'UserController',
                message: `edit done succesfully`,
                data: { identifier: data.identifier, device_name: data.deviceName },
                deviceId: data.identifier
            });
            res.status(200).json({ success: true, message: 'edit done succesfully' });


        }
    } catch (err) {
        console.error(err);
        await createLog({
            logType: 'edit device',
            source: 'UserController',
            message: `Internal Server Error`,
            data: { identifier: data.identifier, device_name: data.deviceName, "error": err.message },
            deviceId: data.identifier
        });
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }



};

controller.edit_user = async (req, res) => {
    const data = req.body;
    console.log(data);


    try {
        const user = req.user;
        console.log(user);


        let text = 'UPDATE users SET  phone = $2 , first_name = $3 , last_name =  $4  WHERE id = $1 RETURNING id';

        let values = [
            user.id,
            data.phone,
            data.firstName,
            data.lastName

        ];
        console.log('Query:', text);
        console.log('Values:', values);


        const result = await pool.query(text, values);
        console.log(result);
        if (result.rowCount > 0) {
            await createLog({
                logType: 'edit user',
                source: 'UserController',
                message: `edit done succesfully`,
                data: { nationalCode: user.id, firstName: data.first_name, last_name: data.lastName, phone: data.phone }
            });
            res.status(200).json({ success: true, message: 'edit done succesfully' });
        } else {
            await createLog({
                logType: 'edit user',
                source: 'UserController',
                message: `nathonalCode not found`,
                data: { nationalCode: user.id, firstName: data.first_name, last_name: data.lastName, phone: data.phone }
            });
            res.statu(400).json({ success: false, message: "nathonalCode not found" });
        }

    } catch (err) {
        await createLog({
            logType: 'edit user',
            source: 'UserController',
            message: `Internal Server Error`,
            data: { error: err.message }
        });
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }

};

controller.change_password = async (req, res) => {
    const data = req.body;

    try {
        console.log("start changing password");

        const user = req.user;
        const passText = 'SELECT password FROM users WHERE id = $1';
        const passValues = [user.id];

        const getPass = await pool.query(passText, passValues);


        const password = getPass.rows[0].password;
        console.log(getPass.rows[0].password);


        const isMatch = await bcrypt.compare(data.oldPassword, password);
        console.log(isMatch);


        if (!isMatch) {
            await createLog({
                logType: 'change password',
                source: 'UserController',
                message: `wrong password`,
                data: { nationalCode: user.id }
            });
            return res.status(402).json({ success: false, message: 'wrong password' });
        }
        console.log(data.newPassword);

        const hashedPassword = await bcrypt.hash(data.newPassword, 10);
        console.log(hashedPassword);

        let text = 'UPDATE users SET  password = $2   WHERE id = $1 RETURNING id';

        let values = [
            user.id,
            hashedPassword
        ];
        console.log('Query:', text);
        console.log('Values:', values);


        const result = await pool.query(text, values);
        console.log(result);
        if (result.rowCount > 0) {
            await createLog({
                logType: 'change password',
                source: 'UserController',
                message: `edit done succesfully`,
                data: { nationalCode: user.id }
            });
            res.status(200).json({ success: true, message: 'edit done succesfully' });
        } else {
            await createLog({
                logType: 'change password',
                source: 'UserController',
                message: `nathonalCode not found`,
                data: { nationalCode: user.id }
            });
            res.statu(400).json({ success: false, message: "nathonalCode not found" });
        }

    } catch (err) {
        await createLog({
            logType: 'change password',
            source: 'UserController',
            message: `Internal Server Error`,
            data: { error: err.message }
        });
        res.status(500).json({ message: 'Internal Server Error' });
    }

};

controller.user_information = async (req, res) => {

    try {
        const user = req.user;

        const text = 'SELECT id,first_name,last_name,start_date,phone FROM users WHERE id = $1 ';
        const values = [user.id];
        const result = await pool.query(text, values);

        if (result.rowCount > 0) {
            await createLog({
                logType: 'user information',
                source: 'UserController',
                message: `user information send succesfully`,
                data: { data: result.rows[0] },
            });

            res.status(200).json({ success: true, data: result.rows[0] });

        } else {
            await createLog({
                logType: 'user information',
                source: 'UserController',
                message: `data not found`,
            });

            res.status(400).json({ message: 'data not found' });
        }
    } catch (err) {
        console.error(' Database error:', err);
        await createLog({
            logType: 'user information',
            source: 'UserController',
            message: `Internal Server Error`,
            data: { error: err.message },
        });
        res.status(500).json({ message: 'Internal Server Error' });

    }
};

controller.device_information = async (req, res) => {

    const data = req.body;



    try {

        const query = 'SELECT * FROM get_latest_device_data($1) AS message';
        const mqttValues = [
            data.identifier
        ];

        const result = await pool.query(query, mqttValues);


        if (result.rowCount > 0) {
            await createLog({
                logType: 'device information',
                source: 'UserController',
                message: `device information send succesfully`,
                data: { data: result.rows[0] },
                deviceId: data.identifier
            });

            res.status(200).json(result.rows[0]);

        } else {
            await createLog({
                logType: 'device information',
                source: 'UserController',
                message: `data not found`,
                deviceId: data.identifier
            });

            res.status(400).json({ message: 'data not found' });
        }
    } catch (err) {
        console.error(' Database error:', err);
        await createLog({
            logType: 'device information',
            source: 'UserController',
            message: `Internal Server Error`,
            data: { error: err.message },
            deviceId: data.identifier
        });
        res.status(500).json({ message: 'Internal Server Error' });

    }
};

controller.rtu_information = async (req, res) => {

    const data = req.body;



    try {

        const query = 'SELECT * FROM get_latest_rtu_irrigation_data($1) AS message';
        const mqttValues = [
            data.deviceId
        ];
        const result = await pool.query(query, mqttValues);


        const convertedRows = result.rows.map(device => {
            return {
                ...device,
                irrigation_start_date: device.irrigation_start_date
                    ? moment(device.irrigation_start_date).locale('fa').format('jYYYY/jMM/jDD HH:mm')
                    : null,
                irrigation_stop_date: device.irrigation_stop_date
                    ? moment(device.irrigation_stop_date).locale('fa').format('jYYYY/jMM/jDD HH:mm')
                    : null,
                irrigation_timestamp: device.irrigation_timestamp
                    ? moment(device.irrigation_timestamp).locale('fa').format('jYYYY/jMM/jDD HH:mm')
                    : null,
                rtu_timestamp: device.rtu_timestamp
                    ? moment(device.rtu_timestamp).locale('fa').format('jYYYY/jMM/jDD HH:mm')
                    : null
            };
        });


        console.log(result.rows);
        res.status(200).json(convertedRows);




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
        res.status(500).json({ message: 'Internal Server Error' });

    }
};

controller.stack_information = async (req, res) => {
    const data = req.body;

    try {

        const query = 'SELECT * FROM get_latest_stack_relay_data($1) AS message';
        const mqttValues = [
            data.deviceId
        ];
        const result = await pool.query(query, mqttValues);
        console.log(result.rows);

        const convertedRows = result.rows.map(device => {
            return {
                ...device,
                stack_stack_id: device.stack_stack_id
                    ? device.stack_stack_id.replace(/[^0-9]/g, '') || null
                    : null,
                relay_relay_id: device.relay_relay_id
                    ? device.relay_relay_id.replace(/[^0-9]/g, '') || null
                    : null,
                stack_timestamp: device.stack_timestamp
                    ? moment(device.stack_timestamp).locale('fa').format('jYYYY/jMM/jDD HH:mm')
                    : null,
                relay_timestamp: device.relay_timestamp
                    ? moment(device.relay_timestamp).locale('fa').format('jYYYY/jMM/jDD HH:mm')
                    : null,
            };
        });

        console.log(convertedRows);

        res.status(200).json(convertedRows);

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
        res.status(500).json({ message: 'Internal Server Error' });

    }
};

controller.set_irrigation = async (req, res) => {
    const data = req.body;
    const user = req.user;


    try {
        let message;
        const date = moment.from(data.date, 'fa', 'YYYY/MM/DD').format('YYYY-MM-DD');
        const timeStampDate = moment.from(data.timeStampDate, 'fa', 'YYYY/MM/DD').format('YYYY-MM-DD');
        //const miladiDate = moment.from(shamsiDate, 'fa', 'YYYY/MM/DD').format('YYYY-MM-DD');


        if (data.rule == 'single') {
            message = {
                "sender": "backend",
                "type": "irrigation",
                "payload": {
                    "mode": "set",
                    "rule": "single",
                    "rtu": data.rtu,
                    "date": date,
                    "clock": data.clock,
                    "duration": data.duration
                },
                "timeStamp": {
                    "date": timeStampDate,
                    "clock": data.timeStampClock
                }
            };
        } else {
            message = {
                "sender": "backend",
                "type": "irrigation",
                "payload": {
                    "mode": "set",
                    "rule": "global",
                    "date": date,
                    "clock": data.clock,
                    "duration": data.duration
                },
                "timeStamp": {
                    "date": timeStampDate,
                    "clock": data.timeStampClock
                }
            };
        }

        const result = await mqttManager.publishMessage(user.id, data.deviceId, JSON.stringify(message));
        console.log(result);
        



        // const query = 'SELECT * FROM get_latest_stack_relay_data($1) AS message';
        // const mqttValues = [
        //     message
        // ];
        // const result2 = await pool.query(query, mqttValues);
        // console.log(result.rows);

        // const convertedRows = result.rows.map(device => {
        //     return {
        //         ...device,
        //         stack_stack_id: device.stack_stack_id
        //             ? device.stack_stack_id.replace(/[^0-9]/g, '') || null
        //             : null,
        //         relay_relay_id: device.relay_relay_id
        //             ? device.relay_relay_id.replace(/[^0-9]/g, '') || null
        //             : null,
        //         stack_timestamp: device.stack_timestamp
        //             ? moment(device.stack_timestamp).locale('fa').format('jYYYY/jMM/jDD HH:mm')
        //             : null,
        //         relay_timestamp: device.relay_timestamp
        //             ? moment(device.relay_timestamp).locale('fa').format('jYYYY/jMM/jDD HH:mm')
        //             : null,
        //     };
        // });

        // console.log(convertedRows);

        res.status(200).json(result);

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
        res.status(500).json({ message: 'Internal Server Error' });

    }
};

controller.all_topics = async (req, res) => {
    try {

        const user = req.user;

        const text = 'SELECT * FROM devices WHERE user_id = $1 ORDER BY start_date ASC';
        const values = [user.id];
        const result = await pool.query(text, values);

        const convertedRows = result.rows.map(device => {
            return {
                ...device,
                start_date: moment(device.start_date)
                    .locale('fa')
                    .format('YYYY/MM/DD')
            };
        });

        res.json(
            convertedRows
        );

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

module.exports = controller;
