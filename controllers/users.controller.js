const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const moment = require('jalali-moment');
const { createLog } = require('../functions/createLog');


//const jwt = require('jsonwebtoken');
//require('dotenv').config();

// const secretKey = process.env.JWT_SECRET;
// const refreshSecretKey = process.env.JWT_REFRESH_SECRET_KEY;

// const generateTokens = (user) => {
//     const accessToken = jwt.sign(
//         { id: user.id },
//         secretKey,
//         { expiresIn: '1d' } // توکن دسترسی برای 1 ساعت معتبر است
//     );

//     const refreshToken = jwt.sign(
//         { id: user.id },
//         refreshSecretKey,
//         { expiresIn: '30d' } // توکن رفرش برای 7 روز معتبر است
//     );

//     return { accessToken, refreshToken };
// };

// const getNationalCodeFromToken = async (token) => {
//     const text = 'SELECT id FROM users WHERE auth_token = $1';
//     const values = [token];

//     const result = await pool.query(text, values);

//     if (result.rows.length === 0) {
//         throw new Error('Invalid token');
//     }
//     console.log(result.rows[0].id);


//     return result.rows[0].id;
// };






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



}

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

}

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
            return res.status(401).json({ success: false, message: 'wrong password' });
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

}



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

            res.status(200).json({ success: 'true', data: result.rows[0] });

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



// middleware/auth.js
// const pool = require('../db');

// async function authMiddleware(req, res, next) {
//   const token = req.headers['authorization']?.split(' ')[1];

//   if (!token) {
//     return res.status(401).json({ message: 'توکن وجود ندارد' });
//   }

//   const result = await pool.query('SELECT * FROM users WHERE auth_token = $1', [token]);

//   if (result.rows.length === 0) {
//     return res.status(401).json({ message: 'توکن نامعتبر است' });
//   }

//   req.user = result.rows[0]; // می‌تونی user رو به ریکوئست اضافه کنی
//   next();
// }

// module.exports = authMiddleware;


// controller.refreshToken = async (req, res) => {
//     const { refreshToken } = req.body;

//     if (!refreshToken) {
//         return res.status(400).send('Refresh token is required');
//     }

//     try {
//         // بررسی صحت refresh token
//         jwt.verify(refreshToken, refreshSecretKey, async (err, decoded) => {
//             if (err) {
//                 return res.status(403).send('Invalid or expired refresh token');
//             }

//             // اگر refresh token معتبر بود، توکن جدید ایجاد کن
//             const { id } = decoded;
//             const text = 'SELECT * FROM users WHERE id = $1';
//             const result = await pool.query(text, [id]);

//             if (result.rows.length > 0) {
//                 const user = result.rows[0];
//                 const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

//                 // ذخیره refresh token جدید در دیتابیس (اگر نیاز باشد)
//                 await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [newRefreshToken, user.id]);

//                 return res.json({ accessToken, refreshToken: newRefreshToken });
//             } else {
//                 return res.status(404).send('User not found');
//             }
//         });
//     } catch (err) {
//         console.error(err);
//         return res.status(500).send('Internal Server Error');
//     }
// };



// app.post('/login', async (req, res) => {
//     const { username, password } = req.body;
//     try {
//         const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
//         if (result.rows.length > 0) {
//             const user = result.rows[0];
//             const isMatch = await bcrypt.compare(password, user.password);

//             if (isMatch) {
//                 const token = jwt.sign({ id: user.id }, secretKey, { expiresIn: '1h' });
//                 res.json({ message: `Welcome ${user.first_name}`, token });
//             } else {
//                 res.status(401).send('Invalid credentials');
//             }
//         } else {
//             res.status(401).send('Invalid credentials');
//         }
//     } catch (err) {
//         console.error(err);
//         res.status(500).send('Server error');
//     }
// });

module.exports = controller;
