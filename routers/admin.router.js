const express = require('express');
const router = express.Router();
const controller = require('../controllers/admin.controller');


router.post('/new_user', controller.new_user);
router.post('/edit_user', controller.edit_user);
router.post('/edit_device', controller.edit_device);
router.post('/reset_password', controller.reset_password);
router.post('/delete_user', controller.delete_user);
router.post('/delete_device', controller.delete_device);
router.post('/new_topic', controller.new_topic);
router.get('/all_users', controller.all_users);
router.post('/all_topics', controller.all_topics);


//router.get('/', adminController.getAdmin);

module.exports = router;