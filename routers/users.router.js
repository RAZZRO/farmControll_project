const express = require('express');
const router = express.Router();
const userController = require('../controllers/users.controller');


router.post('/login', userController.login);
router.post('/edit_device', userController.edit_device);
router.get('/all_topics', userController.all_topics);
//router.post('/refresh_token', userController.refreshToken); 

// const express = require('express');
// const router = express.Router();
// const auth = require('../middleware/auth');

// router.get('/dashboard', auth, (req, res) => {
//   res.json({ message: `خوش آمدید ${req.user.first_name}` });
// });




module.exports = router;
