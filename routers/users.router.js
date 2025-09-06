const express = require('express');
const router = express.Router();
const userController = require('../controllers/users.controller');
const auth = require('../functions/auth');


router.post('/login', userController.login);
router.post('/edit_user',auth, userController.edit_user);
router.post('/change_password',auth, userController.change_password);
router.post('/edit_device',auth, userController.edit_device);
router.post('/device_information', auth,userController.device_information);
router.post('/rtu_information', userController.rtu_information);
//router.post('/device_information', userController.device_information);

router.get('/all_topics',auth, userController.all_topics);
router.get('/user_information',auth, userController.user_information);
//router.post('/refresh_token', userController.refreshToken); 

// const express = require('express');
// const router = express.Router();

// router.get('/dashboard', auth, (req, res) => {
//   res.json({ message: `خوش آمدید ${req.user.first_name}` });
// });




module.exports = router;
