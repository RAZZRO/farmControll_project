const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
// Routes
const userRoutes = require('./routers/users.router');
const adminRoutes = require('./routers/admin.router');
const mqttManager = require('./functions/mqttManager');
//const dataRoutes = require('./routes/data');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());



app.use('/user', userRoutes);
app.use('/admin', adminRoutes);
//app.use('/data', dataRoutes);
mqttManager.initAllUserMqttClients();

app.listen(port,'0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
